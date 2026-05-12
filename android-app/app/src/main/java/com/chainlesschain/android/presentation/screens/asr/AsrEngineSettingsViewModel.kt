package com.chainlesschain.android.presentation.screens.asr

import androidx.lifecycle.ViewModel
import com.chainlesschain.android.feature.ai.data.voice.AsrEngineChoice
import com.chainlesschain.android.feature.ai.data.voice.AsrEnginePreferences
import com.chainlesschain.android.feature.ai.data.voice.WhisperAsrEngine
import com.chainlesschain.android.feature.ai.data.voice.WhisperModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/**
 * v1.1 issue #19 W4：Settings → ASR 引擎 ViewModel。
 *
 * 暴露 [AsrEnginePreferences] 状态 + Whisper 安装检测结果给 UI。
 */
@HiltViewModel
class AsrEngineSettingsViewModel @Inject constructor(
    private val preferences: AsrEnginePreferences,
    private val whisper: WhisperAsrEngine,
) : ViewModel() {

    val engine: StateFlow<AsrEngineChoice> = preferences.engine
    val whisperModel: StateFlow<WhisperModel> = preferences.whisperModel

    fun setEngine(choice: AsrEngineChoice) {
        preferences.setEngine(choice)
    }

    fun setWhisperModel(model: WhisperModel) {
        preferences.setWhisperModel(model)
    }

    /** v1.1 stub 永远返 false；v1.2 真集成后才会按 ggml 文件存在性返。 */
    fun isWhisperInstalled(model: WhisperModel = whisperModel.value): Boolean =
        whisper.isModelInstalled(model)
}
