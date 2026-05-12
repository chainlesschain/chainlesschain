package com.chainlesschain.android.feature.ai.data.voice

import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.1 issue #19 W4：Whisper local ASR **stub** 实装。
 *
 * **状态**: 🟡 stub — 接口骨架就位，真集成（whisper.cpp NDK + JNI binding + ggml 模型
 * 下载）推 v1.2。详见 [docs/guides/Whisper_Local_ASR_Setup.md](../../../../../../../../docs/guides/Whisper_Local_ASR_Setup.md)。
 *
 * 用户在 Settings → ASR 引擎切换到 Whisper 后调用 transcribe 会抛
 * [WhisperNotInstalledException]，UI 应捕获并提示用户安装步骤。VoiceMode 状态机的
 * Failed.Stage.TRANSCRIBE 路径自然显示该异常 message。
 *
 * v1.2 真集成时只需把 transcribe() body 换成实际 JNI 调用，本类签名不动；
 * AsrEngineRouter / Settings UI / VoiceMode 全链路 zero change。
 */
@Singleton
class WhisperAsrEngine @Inject constructor(
    private val preferences: AsrEnginePreferences,
) : AsrEngine {

    override suspend fun transcribe(audioFile: File): String {
        val model = preferences.whisperModel.value
        Timber.w(
            "WhisperAsrEngine.transcribe called with stub impl (model=%s, audio=%s)",
            model.name, audioFile.name,
        )
        throw WhisperNotInstalledException(model)
    }

    /**
     * v1.2 真集成 entry-point — 检查 ggml 模型文件是否已下载到 internal storage。
     * v1.1 stub 永远返 false。
     */
    fun isModelInstalled(model: WhisperModel = preferences.whisperModel.value): Boolean = false
}

/**
 * Whisper 未安装专用异常。VoiceMode UI 通过 `is WhisperNotInstalledException` 区分
 * "用户选了 Whisper 但模型未下载" 与 "ASR 真崩溃"两种 case；前者引导去 Settings 切回
 * Volcengine 或安装 Whisper，后者按 transcribe 失败处理。
 */
class WhisperNotInstalledException(
    val model: WhisperModel,
) : Exception(
    "Whisper local ASR 未集成（v1.1 stub）。模型 ${model.displayName} 待安装。" +
        "v1.2 路线：whisper.cpp NDK build + ggml 模型下载。当前请在 Settings → ASR 引擎切回火山豆包。" +
        "详见 docs/guides/Whisper_Local_ASR_Setup.md。"
)
