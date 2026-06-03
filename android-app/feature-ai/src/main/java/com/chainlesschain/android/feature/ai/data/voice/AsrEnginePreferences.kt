package com.chainlesschain.android.feature.ai.data.voice

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.1 issue #19 W4：ASR 引擎选择 + Whisper 模型偏好。
 *
 * 用 SharedPreferences 持久化（相同模式 [com.chainlesschain.android.config.TurnServerPreferences]）。
 *
 * 默认：[AsrEngineChoice.Volcengine]（v1.0 行为兼容）。用户在 Settings → ASR 引擎切到
 * Whisper 时，[AsrEngineRouter] 会路由到 [WhisperAsrEngine]（v1.1 stub）；真集成完成后
 * 透明切换。
 */
@Singleton
class AsrEnginePreferences @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREF_NAME,
        Context.MODE_PRIVATE,
    )

    private val _engine = MutableStateFlow(loadEngine())
    val engine: StateFlow<AsrEngineChoice> = _engine.asStateFlow()

    private val _whisperModel = MutableStateFlow(loadWhisperModel())
    val whisperModel: StateFlow<WhisperModel> = _whisperModel.asStateFlow()

    fun setEngine(choice: AsrEngineChoice) {
        _engine.value = choice
        prefs.edit { putString(KEY_ENGINE, choice.name) }
        Timber.i("AsrEnginePreferences: engine=$choice")
    }

    fun setWhisperModel(model: WhisperModel) {
        _whisperModel.value = model
        prefs.edit { putString(KEY_WHISPER_MODEL, model.name) }
        Timber.i("AsrEnginePreferences: whisperModel=$model")
    }

    private fun loadEngine(): AsrEngineChoice {
        val name = prefs.getString(KEY_ENGINE, null) ?: return AsrEngineChoice.Volcengine
        return runCatching { AsrEngineChoice.valueOf(name) }.getOrDefault(AsrEngineChoice.Volcengine)
    }

    private fun loadWhisperModel(): WhisperModel {
        val name = prefs.getString(KEY_WHISPER_MODEL, null) ?: return WhisperModel.Base
        return runCatching { WhisperModel.valueOf(name) }.getOrDefault(WhisperModel.Base)
    }

    companion object {
        private const val PREF_NAME = "asr_engine_prefs"
        private const val KEY_ENGINE = "asr_engine"
        private const val KEY_WHISPER_MODEL = "whisper_model"
    }
}

/**
 * v1.1 ASR 引擎可选项。
 *
 *  - [Volcengine] — 火山 SeedASR 大模型，云端识别（v1.0 默认）。中文识别率高，需网络 +
 *    API key + ~500ms 首字延迟（火山往返）。
 *  - [Whisper] — whisper.cpp 本地推理，全离线，隐私第一（v1.1 stub；真集成 v1.2）。
 */
enum class AsrEngineChoice {
    Volcengine,
    Whisper,
}

/**
 * Whisper 模型分级 (ggml-tiny.bin / ggml-base.bin / ggml-small.bin)。
 *
 * 大模型留 v1.2（Android 内存吃紧 + 推理延迟超 v1.1 < 2s 目标）。
 */
enum class WhisperModel(
    val displayName: String,
    val sizeMB: Int,
    val accuracyHint: String,
    val firstTokenLatencyMs: String,
    val ggmlFilename: String,
) {
    Tiny(
        displayName = "Tiny (39MB)",
        sizeMB = 39,
        accuracyHint = "中文一般，常用词对",
        firstTokenLatencyMs = "<1s",
        ggmlFilename = "ggml-tiny.bin",
    ),
    Base(
        displayName = "Base (142MB) — 推荐",
        sizeMB = 142,
        accuracyHint = "中文好，可日常对话",
        firstTokenLatencyMs = "<2s",
        ggmlFilename = "ggml-base.bin",
    ),
    Small(
        displayName = "Small (466MB)",
        sizeMB = 466,
        accuracyHint = "中文准确，适合长文",
        firstTokenLatencyMs = "<5s",
        ggmlFilename = "ggml-small.bin",
    ),
}
