package com.chainlesschain.android.feature.ai.data.voice

import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.1 issue #19 W4：Whisper local ASR 实装。
 *
 * **状态**:
 *   - ✅ W4 骨架 (391aa3cae)
 *   - ✅ W4a native build infra (378b09a1a)
 *   - ✅ W4b JNI 真接口 (576af4374) — [WhisperNative.initContext/transcribe/freeContext]
 *   - ✅ W4c WhisperModelDownloader (本 commit) — [isModelInstalled] 接真文件检测
 *   - 🟡 W4d WAV→16kHz PCM converter + transcribe() 真调 [WhisperNative]
 *   - 🟡 W4e 真机 bench
 *
 * 详 [docs/guides/Whisper_Local_ASR_Setup.md](../../../../../../../../docs/guides/Whisper_Local_ASR_Setup.md)。
 *
 * 用户在 Settings → ASR 引擎切换到 Whisper 后 transcribe 会抛
 * [WhisperNotInstalledException]（如模型未下载）。UI 应捕获并引导去 Settings
 * 下载模型 + 切回 Volcengine。VoiceMode 状态机的 Failed.Stage.TRANSCRIBE 路径
 * 自然显示该异常 message。
 */
@Singleton
class WhisperAsrEngine @Inject constructor(
    private val preferences: AsrEnginePreferences,
    private val downloader: WhisperModelDownloader,
) : AsrEngine {

    override suspend fun transcribe(audioFile: File): String {
        val model = preferences.whisperModel.value
        if (!isModelInstalled(model)) {
            Timber.w(
                "WhisperAsrEngine.transcribe: model %s not installed → throw",
                model.name,
            )
            throw WhisperNotInstalledException(model)
        }
        // W4d: 真 transcribe 路径将走 WhisperNative.initContext + transcribe + freeContext。
        // W4c 阶段 isModelInstalled 真实判断，但 transcribe body 仍 stub —— 防止
        // 用户下载模型后没 WAV→PCM 转换链路时 native 调失败崩 app。
        Timber.w(
            "WhisperAsrEngine.transcribe (W4c): model %s installed but transcribe path待 W4d (WAV→PCM converter)",
            model.name,
        )
        throw WhisperNotInstalledException(model)
    }

    /**
     * 检查 [model] ggml 文件是否已下载到 internal storage 且大小合理。
     * 委托 [WhisperModelDownloader.isModelInstalled]。
     */
    fun isModelInstalled(model: WhisperModel = preferences.whisperModel.value): Boolean =
        downloader.isModelInstalled(model)
}

/**
 * Whisper 未安装专用异常。VoiceMode UI 通过 `is WhisperNotInstalledException` 区分
 * "用户选了 Whisper 但模型未下载" 与 "ASR 真崩溃"两种 case；前者引导去 Settings 切回
 * Volcengine 或安装 Whisper，后者按 transcribe 失败处理。
 */
class WhisperNotInstalledException(
    val model: WhisperModel,
) : Exception(
    "Whisper 模型 ${model.displayName} 未下载或 transcribe 路径未接通。" +
        "请在 Settings → ASR 引擎 下载 ${model.ggmlFilename} (${model.sizeMB} MB)，或切回火山豆包。" +
        "详见 docs/guides/Whisper_Local_ASR_Setup.md。"
)
