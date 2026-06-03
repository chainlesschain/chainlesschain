package com.chainlesschain.android.presentation.screens

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.data.voice.VolcengineAsrClient
import com.chainlesschain.android.feature.ai.data.voice.VolcengineAsrException
import com.chainlesschain.android.feature.ai.data.voice.WavRecorder
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 首页轻量状态 VM —— 职责：
 *  - isLlmConfigured: 当前 LLM provider 是否配置了 key
 *  - 语音输入：录音 → SeedASR 识别 → 暴露 transcript
 */
@HiltViewModel
class HomeStatusViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val llmConfigManager: LLMConfigManager,
    private val asrClient: VolcengineAsrClient
) : ViewModel() {

    private val _isLlmConfigured = MutableStateFlow(false)
    val isLlmConfigured: StateFlow<Boolean> = _isLlmConfigured.asStateFlow()

    private val _voiceState = MutableStateFlow(VoiceState())
    val voiceState: StateFlow<VoiceState> = _voiceState.asStateFlow()

    private val recorder = WavRecorder(appContext)
    private var asrJob: Job? = null

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch(Dispatchers.IO) {
            llmConfigManager.load()
            _isLlmConfigured.value = computeConfigured()
            _voiceState.update { it.copy(asrConfigured = isAsrConfigured()) }
        }
    }

    private fun computeConfigured(): Boolean {
        val provider = llmConfigManager.getProvider()
        if (provider == LLMProvider.OLLAMA) return true
        return llmConfigManager.getApiKey(provider).isNotBlank()
    }

    private fun isAsrConfigured(): Boolean =
        llmConfigManager.getConfig().asrVolcengine.apiKey.isNotBlank()

    // ============ 语音输入流程 ============

    /** 开始录音；外层调用前应确认 RECORD_AUDIO 权限已授予 */
    fun startRecording() {
        if (_voiceState.value.phase != VoicePhase.Idle) return
        if (!isAsrConfigured()) {
            _voiceState.update {
                it.copy(
                    phase = VoicePhase.Error,
                    errorMessage = "未配置 SeedASR API Key（设置 → LLM 设置 → 语音识别）"
                )
            }
            return
        }
        val started = recorder.start()
        if (!started) {
            _voiceState.update {
                it.copy(
                    phase = VoicePhase.Error,
                    errorMessage = "无法启动录音 —— 麦克风可能被占用或未授权"
                )
            }
            return
        }
        _voiceState.update {
            it.copy(phase = VoicePhase.Recording, errorMessage = null, transcript = null)
        }
        Timber.tag("VoiceInput").i("recording started")
    }

    /** 用户点"完成"：结束录音 → 上传 → 轮询 → 返回文字到 transcript */
    fun stopAndTranscribe() {
        if (_voiceState.value.phase != VoicePhase.Recording) return
        asrJob?.cancel()
        asrJob = viewModelScope.launch(Dispatchers.IO) {
            _voiceState.update { it.copy(phase = VoicePhase.Transcribing) }
            val wav = try {
                recorder.stopAndWriteWav()
            } catch (e: Exception) {
                Timber.tag("VoiceInput").e(e, "stop wav failed")
                _voiceState.update {
                    it.copy(phase = VoicePhase.Error, errorMessage = "保存录音失败：${e.message}")
                }
                return@launch
            }
            if (wav == null) {
                _voiceState.update {
                    it.copy(phase = VoicePhase.Error, errorMessage = "录音为空，请重试")
                }
                return@launch
            }
            try {
                val text = asrClient.transcribe(wav)
                _voiceState.update {
                    it.copy(phase = VoicePhase.Done, transcript = text, errorMessage = null)
                }
                Timber.tag("VoiceInput").i("transcribed: ${text.take(40)}...")
            } catch (e: VolcengineAsrException) {
                Timber.tag("VoiceInput").w(e, "ASR failed status=${e.statusCode}")
                _voiceState.update {
                    it.copy(phase = VoicePhase.Error, errorMessage = e.message ?: "识别失败")
                }
            } catch (e: Exception) {
                Timber.tag("VoiceInput").e(e, "ASR unexpected exception")
                _voiceState.update {
                    it.copy(phase = VoicePhase.Error, errorMessage = "识别异常：${e.message}")
                }
            } finally {
                runCatching { wav.delete() }
            }
        }
    }

    /** 用户点"取消"：丢弃录音 + 不发请求 */
    fun cancelRecording() {
        asrJob?.cancel()
        asrJob = null
        recorder.cancel()
        _voiceState.update { VoiceState(asrConfigured = it.asrConfigured) }
    }

    /** 消费一次 transcript / error，clear 状态回到 Idle */
    fun clearVoiceResult() {
        _voiceState.update {
            it.copy(phase = VoicePhase.Idle, transcript = null, errorMessage = null)
        }
    }

    data class VoiceState(
        val phase: VoicePhase = VoicePhase.Idle,
        val transcript: String? = null,
        val errorMessage: String? = null,
        val asrConfigured: Boolean = false
    )

    enum class VoicePhase { Idle, Recording, Transcribing, Done, Error }
}
