package com.chainlesschain.android.remote.ui.file

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.data.FileTransferEntity
import com.chainlesschain.android.remote.data.FileTransferRepository
import com.chainlesschain.android.remote.data.FileTransferStatistics
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 文件传输 ViewModel
 */
@HiltViewModel
class FileTransferViewModel @Inject constructor(
    private val repository: FileTransferRepository
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow<FileTransferUiState>(FileTransferUiState.Idle)
    val uiState: StateFlow<FileTransferUiState> = _uiState.asStateFlow()

    // 最近的传输列表
    val recentTransfers: StateFlow<List<FileTransferEntity>> =
        repository.getRecentTransfers(limit = 50)
            .stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5000),
                initialValue = emptyList()
            )

    // 活动的传输列表
    val activeTransfers: StateFlow<List<FileTransferEntity>> =
        repository.getActiveTransfers()
            .stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5000),
                initialValue = emptyList()
            )

    // 传输统计
    val statistics: StateFlow<FileTransferStatistics?> =
        repository.getStatistics()
            .map { it }
            .stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5000),
                initialValue = null
            )

    // 当前传输进度（transferId -> progress）
    private val _transferProgress = MutableStateFlow<Map<String, Double>>(emptyMap())
    val transferProgress: StateFlow<Map<String, Double>> = _transferProgress.asStateFlow()

    /**
     * 上传文件
     */
    fun uploadFile(
        uri: Uri,
        fileName: String,
        deviceDid: String
    ) {
        viewModelScope.launch {
            _uiState.value = FileTransferUiState.Uploading(fileName, 0.0)

            val result = repository.uploadFile(
                uri = uri,
                fileName = fileName,
                deviceDid = deviceDid,
                onProgress = { progress ->
                    _uiState.value = FileTransferUiState.Uploading(fileName, progress)
                }
            )

            _uiState.value = if (result.isSuccess) {
                FileTransferUiState.Success("文件上传成功: $fileName")
            } else {
                FileTransferUiState.Error(
                    result.exceptionOrNull()?.message ?: "上传失败"
                )
            }
        }
    }

    /**
     * 下载文件
     */
    fun downloadFile(
        remotePath: String,
        fileName: String,
        deviceDid: String
    ) {
        viewModelScope.launch {
            _uiState.value = FileTransferUiState.Downloading(fileName, 0.0)

            val result = repository.downloadFile(
                remotePath = remotePath,
                fileName = fileName,
                deviceDid = deviceDid,
                onProgress = { progress ->
                    _uiState.value = FileTransferUiState.Downloading(fileName, progress)
                }
            )

            _uiState.value = if (result.isSuccess) {
                FileTransferUiState.Success("文件下载成功: $fileName")
            } else {
                FileTransferUiState.Error(
                    result.exceptionOrNull()?.message ?: "下载失败"
                )
            }
        }
    }

    /**
     * 取消传输
     */
    fun cancelTransfer(transferId: String) {
        viewModelScope.launch {
            val result = repository.cancelTransfer(transferId)

            if (result.isFailure) {
                _uiState.value = FileTransferUiState.Error(
                    result.exceptionOrNull()?.message ?: "取消失败"
                )
            }
        }
    }

    /**
     * 清理完成的传输
     */
    fun cleanupOldTransfers(days: Int = 30) {
        viewModelScope.launch {
            repository.cleanupOldTransfers(days)
        }
    }

    /**
     * 重置 UI 状态
     */
    fun resetUiState() {
        _uiState.value = FileTransferUiState.Idle
    }
}

/**
 * 文件传输 UI 状态
 */
sealed class FileTransferUiState {
    object Idle : FileTransferUiState()

    data class Uploading(
        val fileName: String,
        val progress: Double
    ) : FileTransferUiState()

    data class Downloading(
        val fileName: String,
        val progress: Double
    ) : FileTransferUiState()

    data class Success(val message: String) : FileTransferUiState()
    data class Error(val message: String) : FileTransferUiState()
}
