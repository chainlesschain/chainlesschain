package com.chainlesschain.android.feature.ai.data.voice

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * VoiceMode 编排器：录音 → ASR → REMOTE chat → TTS → 播放。
 *
 * 设计文档 §5.3 M3 D1：continuous 模式（TTS 播放完自动回到 Recording）
 * 由 [continuousMode] 控制。多轮上下文通过 [conversationId] 维持，桌面侧保存历史。
 *
 * 线程：所有公开方法是 suspend / 状态机维护在主协调器（呼叫者通常是 ViewModel 的 viewModelScope）。
 * 取消：调 [cancel] 撤掉录音 + 播放，state 回 Idle。
 *
 * 状态字段不可变：每次转移用 _state.value = ... 替换。Failed 不自动回 Idle，UI 显示后调 resetIdle()。
 */
@Singleton
class VoiceModeManager @Inject constructor(
    private val recorder: AudioRecorder,
    private val asr: AsrEngine,
    private val chatBridge: VoiceChatBridge,
    private val player: AudioPlayer,
) {
    private val _state = MutableStateFlow<VoiceModeState>(VoiceModeState.Idle)
    val state: StateFlow<VoiceModeState> = _state.asStateFlow()

    /** 是否启用连续语音模式：播放完成后自动重新录音 */
    @Volatile var continuousMode: Boolean = false

    private var conversationId: String? = null

    /**
     * 启动录音。只有 Idle / Done / Failed 状态下允许。
     * 返回 false 表示权限缺失或录音启动失败（state 已置为对应 Failed）。
     */
    fun startRecording(): Boolean {
        val current = _state.value
        if (current !is VoiceModeState.Idle &&
            current !is VoiceModeState.Done &&
            current !is VoiceModeState.Failed
        ) {
            Timber.w("VoiceModeManager.startRecording: ignored, current=$current")
            return false
        }
        if (!recorder.hasPermission()) {
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.PERMISSION,
                "缺少录音权限（RECORD_AUDIO）"
            )
            return false
        }
        val ok = recorder.start()
        if (!ok) {
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.RECORDING,
                "录音启动失败"
            )
            return false
        }
        _state.value = VoiceModeState.Recording
        return true
    }

    /**
     * 停止录音并跑完整 pipeline。仅在 Recording 状态生效。
     */
    suspend fun stopAndProcess() {
        if (_state.value !is VoiceModeState.Recording) {
            Timber.w("VoiceModeManager.stopAndProcess: ignored, current=${_state.value}")
            return
        }
        _state.value = VoiceModeState.Transcribing

        val wavFile: File? = try {
            recorder.stopAndWriteWav()
        } catch (e: Exception) {
            Timber.e(e, "VoiceModeManager: stopAndWriteWav threw")
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.RECORDING,
                e.message ?: "停止录音失败"
            )
            return
        }
        if (wavFile == null) {
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.RECORDING,
                "录音内容为空"
            )
            return
        }
        processAudio(wavFile)
    }

    /**
     * 跑 ASR → chat → TTS pipeline。可单独调用以便测试或重放历史音频。
     */
    suspend fun processAudio(audioFile: File) {
        val userText = try {
            asr.transcribe(audioFile)
        } catch (e: Exception) {
            Timber.e(e, "VoiceModeManager: ASR transcribe failed")
            audioFile.tryDelete()
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.TRANSCRIBE,
                e.message ?: "识别失败"
            )
            return
        }
        audioFile.tryDelete()
        if (userText.isBlank()) {
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.TRANSCRIBE,
                "识别结果为空"
            )
            return
        }
        _state.value = VoiceModeState.Thinking(userText)

        val chatResult = chatBridge.chat(userText, conversationId)
        val reply = chatResult.getOrNull()
        if (reply == null) {
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.CHAT,
                chatResult.exceptionOrNull()?.message ?: "对话失败"
            )
            return
        }
        conversationId = reply.conversationId
        if (reply.reply.isBlank()) {
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.CHAT,
                "对话回复为空"
            )
            return
        }
        _state.value = VoiceModeState.Speaking(userText, reply.reply)

        val ttsResult = chatBridge.synthesize(reply.reply)
        val audio = ttsResult.getOrNull()
        if (audio == null) {
            // TTS 失败不丢弃文字回复 — 用户至少能看到文字
            Timber.w("VoiceModeManager: TTS 失败但保留文字回复")
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.TTS,
                ttsResult.exceptionOrNull()?.message ?: "合成失败（文字回复已保留）"
            )
            return
        }

        val played = try {
            player.play(audio.bytes, audio.format)
        } catch (e: Exception) {
            Timber.e(e, "VoiceModeManager: AudioPlayer threw")
            false
        }
        if (!played) {
            _state.value = VoiceModeState.Failed(
                VoiceModeState.Failed.Stage.PLAY,
                "音频播放失败（文字回复已保留）"
            )
            return
        }

        _state.value = VoiceModeState.Done(userText, reply.reply)

        if (continuousMode) {
            // 连续模式：循环重启录音
            startRecording()
        }
    }

    /** 取消当前 pipeline（录音/播放都撤），state 回 Idle。 */
    fun cancel() {
        recorder.cancel()
        player.stop()
        _state.value = VoiceModeState.Idle
    }

    /** 从 Done/Failed 状态显式回 Idle（UI 显示完毕后调）。 */
    fun resetIdle() {
        val current = _state.value
        if (current is VoiceModeState.Done || current is VoiceModeState.Failed) {
            _state.value = VoiceModeState.Idle
        }
    }

    /** 清掉多轮上下文（开新会话）。 */
    fun resetConversation() {
        conversationId = null
    }

    private fun File.tryDelete() {
        try { this.delete() } catch (_: Exception) { /* best-effort */ }
    }
}
