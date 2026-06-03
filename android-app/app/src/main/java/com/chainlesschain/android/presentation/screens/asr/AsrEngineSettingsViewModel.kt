package com.chainlesschain.android.presentation.screens.asr

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.ai.data.voice.AsrEngineChoice
import com.chainlesschain.android.feature.ai.data.voice.AsrEnginePreferences
import com.chainlesschain.android.feature.ai.data.voice.WhisperAsrEngine
import com.chainlesschain.android.feature.ai.data.voice.WhisperModel
import com.chainlesschain.android.feature.ai.data.voice.WhisperModelDownloader
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * v1.1 issue #19 W4：Settings → ASR 引擎 ViewModel。
 *
 * 暴露 [AsrEnginePreferences] 状态 + Whisper 安装检测 + W4c 下载控制。
 */
@HiltViewModel
class AsrEngineSettingsViewModel @Inject constructor(
    private val preferences: AsrEnginePreferences,
    private val whisper: WhisperAsrEngine,
    private val downloader: WhisperModelDownloader,
) : ViewModel() {

    val engine: StateFlow<AsrEngineChoice> = preferences.engine
    val whisperModel: StateFlow<WhisperModel> = preferences.whisperModel

    /** W4c：UI collect 显示下载进度 / 错误 / 成功状态。 */
    val downloadState: StateFlow<WhisperModelDownloader.DownloadState> = downloader.downloadState

    private var downloadJob: Job? = null

    fun setEngine(choice: AsrEngineChoice) {
        preferences.setEngine(choice)
    }

    fun setWhisperModel(model: WhisperModel) {
        preferences.setWhisperModel(model)
    }

    /** W4c：检查 ggml 文件是否已下载（委托 [WhisperModelDownloader]）。 */
    fun isWhisperInstalled(model: WhisperModel = whisperModel.value): Boolean =
        whisper.isModelInstalled(model)

    /**
     * W4c：开始下载当前选中的模型。重复调用 (downloadJob 还活着) 跳过；
     * 用户想换模型应先 [cancelDownload] 再调本函数。
     */
    fun downloadCurrentModel() {
        if (downloadJob?.isActive == true) return
        val model = whisperModel.value
        downloadJob = viewModelScope.launch {
            downloader.downloadModel(model)
        }
    }

    /** W4c：取消当前下载。tmp 文件被删，StateFlow 置回 Idle。 */
    fun cancelDownload() {
        downloadJob?.cancel()
        downloadJob = null
    }

    /** W4c：删模型（释放空间 / 用户主动重置）。 */
    fun deleteModel(model: WhisperModel = whisperModel.value) {
        downloader.deleteModel(model)
    }
}
