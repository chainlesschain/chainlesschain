package com.chainlesschain.android.presentation.screens

import android.content.Context
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.R
import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import com.chainlesschain.android.pdh.llm.ModelManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * AndroidLocalModelScreen 的 VM —— 管 Gemma-3 1B 本机模型的下载/删除/状态可视化。
 *
 * 设计参考 `HubAskViewModel.observeModelManager()` (commit `c7452de00`) — 同 ModelManager
 * 状态来源、同 5 态映射，新屏单跑独立 collect，避免和 HubAsk 抢 Flow。
 *
 * 与 [com.chainlesschain.android.pdh.llm.MediaPipeLlmEngine] 解耦：只关心 ModelManager 文件
 * 态 + engine.nativeReady 这个一次性 probe（用于 disclaimer：MediaPipe .so 没装上时给提示）。
 * 真正测对话走 [LLMTestChatScreen]（useLocalEngine=true），不在本屏跑推理。
 */
@HiltViewModel
class AndroidLocalModelViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val modelManager: ModelManager,
    private val llmEngine: LlmInferenceEngine,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        AndroidLocalModelUiState(
            spec = modelManager.defaultSpec,
            nativeReady = llmEngine.nativeReady,
        )
    )
    val uiState: StateFlow<AndroidLocalModelUiState> = _uiState.asStateFlow()

    private var downloadJob: Job? = null

    init {
        observeModelManager()
        // 首次进入触发 refresh，让磁盘上已有文件能立刻被识别为 Ready。
        viewModelScope.launch { modelManager.refresh() }
    }

    private fun observeModelManager() {
        viewModelScope.launch {
            modelManager.state.collectLatest { state ->
                _uiState.update { it.copy(modelState = state.toUi(), rawState = state) }
            }
        }
    }

    fun downloadModel() {
        // 防并发：已经在下载就忽略（参考 HubLocalViewModel.downloadModel 的 guard）。
        if (downloadJob?.isActive == true) return
        downloadJob = viewModelScope.launch {
            _uiState.update { it.copy(message = context.getString(R.string.local_model_download_start)) }
            modelManager.download()
        }
    }

    fun deleteModel() {
        downloadJob?.cancel()
        viewModelScope.launch {
            modelManager.delete()
            _uiState.update { it.copy(message = context.getString(R.string.local_model_deleted)) }
        }
    }

    fun refreshModel() {
        viewModelScope.launch { modelManager.refresh() }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}

@Immutable
data class AndroidLocalModelUiState(
    val spec: ModelManager.ModelSpec,
    val modelState: LocalModelStatus = LocalModelStatus.NotDownloaded,
    val rawState: ModelManager.State = ModelManager.State.NotDownloaded,
    val nativeReady: Boolean = true,
    val message: String? = null,
) {
    val isReady: Boolean get() = modelState is LocalModelStatus.Ready
}

sealed class LocalModelStatus {
    object NotDownloaded : LocalModelStatus()
    data class Downloading(val received: Long, val total: Long, val fraction: Float) : LocalModelStatus()
    object Verifying : LocalModelStatus()
    data class Ready(val filename: String, val sha256Short: String) : LocalModelStatus()
    data class Failed(val reason: String) : LocalModelStatus()
}

private fun ModelManager.State.toUi(): LocalModelStatus = when (this) {
    is ModelManager.State.NotDownloaded -> LocalModelStatus.NotDownloaded
    is ModelManager.State.Downloading -> LocalModelStatus.Downloading(
        received = receivedBytes,
        total = totalBytes,
        fraction = progressFraction,
    )
    is ModelManager.State.Verifying -> LocalModelStatus.Verifying
    is ModelManager.State.Ready -> LocalModelStatus.Ready(
        filename = file.name,
        sha256Short = sha256.take(12),
    )
    is ModelManager.State.Failed -> LocalModelStatus.Failed(reason)
}
