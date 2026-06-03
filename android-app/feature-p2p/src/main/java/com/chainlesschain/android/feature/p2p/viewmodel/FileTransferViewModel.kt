package com.chainlesschain.android.feature.p2p.viewmodel

import android.net.Uri
import timber.log.Timber
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.FileTransferEntity
import com.chainlesschain.android.core.database.entity.FileTransferStatusEnum
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.filetransfer.TransferResult
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferStatus
import com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress
import com.chainlesschain.android.feature.p2p.notification.FileTransferNotificationManager
import com.chainlesschain.android.feature.p2p.repository.FileTransferRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 文件传输 UI 状态
 */
@Immutable
data class FileTransferUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val transfers: List<FileTransferEntity> = emptyList(),
    val activeTransfers: List<FileTransferEntity> = emptyList(),
    val pendingRequests: List<FileTransferEntity> = emptyList(),
    val selectedTransferId: String? = null
)

/**
 * 文件传输事件（一次性事件）
 */
sealed class FileTransferUiEvent {
    data class TransferStarted(val transferId: String, val fileName: String) : FileTransferUiEvent()
    data class TransferCompleted(val transferId: String, val fileName: String, val localPath: String?) : FileTransferUiEvent()
    data class TransferFailed(val transferId: String, val error: String?) : FileTransferUiEvent()
    data class ShowError(val message: String) : FileTransferUiEvent()
    data class ShowMessage(val message: String) : FileTransferUiEvent()
    object RequestFilePicker : FileTransferUiEvent()
}

/**
 * 文件传输 ViewModel
 *
 * 管理P2P文件传输的UI状态和业务逻辑
 */
@HiltViewModel
class FileTransferViewModel @Inject constructor(
    private val fileTransferRepository: FileTransferRepository,
    private val didManager: DIDManager,
    private val notificationManager: FileTransferNotificationManager
) : ViewModel() {

    companion object {
        /** 通知更新间隔（毫秒） */
        private const val NOTIFICATION_UPDATE_INTERVAL = 500L
    }

    // UI 状态
    private val _uiState = MutableStateFlow(FileTransferUiState())
    val uiState: StateFlow<FileTransferUiState> = _uiState.asStateFlow()

    // 一次性事件
    private val _events = MutableSharedFlow<FileTransferUiEvent>()
    val events: SharedFlow<FileTransferUiEvent> = _events.asSharedFlow()

    // 实时进度
    val allTransfersProgress: StateFlow<Map<String, TransferProgress>> =
        fileTransferRepository.allTransfersProgress

    // 当前会话的设备ID
    private var currentPeerId: String? = null

    // 本地设备ID
    private val localDeviceId: String
        get() = didManager.getCurrentDID() ?: ""

    // 用于通知节流的时间戳缓存
    private val lastNotificationUpdate = mutableMapOf<String, Long>()

    init {
        // Initialize repository with local device ID
        viewModelScope.launch {
            val deviceId = didManager.getCurrentDID()
            if (deviceId != null) {
                fileTransferRepository.initialize(deviceId)
            }
        }

        // Observe transfer results
        observeTransferResults()

        // Observe progress for notifications
        observeProgressForNotifications()
    }

    /**
     * 加载与指定设备的传输记录
     */
    fun loadTransfers(peerId: String) {
        currentPeerId = peerId
        Timber.d("Loading transfers with peer: $peerId")

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                // Observe all transfers with this peer
                fileTransferRepository.getTransfersByPeer(peerId).collect { transfers ->
                    val active = transfers.filter { !FileTransferStatusEnum.isTerminal(it.status) }
                    val pending = transfers.filter {
                        !it.isOutgoing && it.status == FileTransferStatusEnum.REQUESTING
                    }

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            transfers = transfers,
                            activeTransfers = active,
                            pendingRequests = pending
                        )
                    }
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to load transfers")
                _uiState.update {
                    it.copy(isLoading = false, error = e.message)
                }
            }
        }
    }

    /**
     * 加载所有传输记录
     */
    fun loadAllTransfers() {
        currentPeerId = null
        Timber.d("Loading all transfers")

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                fileTransferRepository.getAllTransfers().collect { transfers ->
                    val active = transfers.filter { !FileTransferStatusEnum.isTerminal(it.status) }
                    val pending = transfers.filter {
                        !it.isOutgoing && it.status == FileTransferStatusEnum.REQUESTING
                    }

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            transfers = transfers,
                            activeTransfers = active,
                            pendingRequests = pending
                        )
                    }
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to load all transfers")
                _uiState.update {
                    it.copy(isLoading = false, error = e.message)
                }
            }
        }
    }

    /**
     * 请求打开文件选择器
     */
    fun requestFilePicker() {
        viewModelScope.launch {
            _events.emit(FileTransferUiEvent.RequestFilePicker)
        }
    }

    /**
     * 发送文件
     */
    fun sendFile(fileUri: Uri, peerId: String? = currentPeerId) {
        val targetPeerId = peerId ?: run {
            viewModelScope.launch {
                _events.emit(FileTransferUiEvent.ShowError("No peer selected"))
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            try {
                val metadata = fileTransferRepository.sendFile(fileUri, targetPeerId)

                if (metadata != null) {
                    _events.emit(FileTransferUiEvent.TransferStarted(
                        metadata.transferId,
                        metadata.fileName
                    ))
                    _events.emit(FileTransferUiEvent.ShowMessage(
                        "Sending ${metadata.fileName}..."
                    ))
                } else {
                    _events.emit(FileTransferUiEvent.ShowError(
                        "Failed to start file transfer"
                    ))
                }

                _uiState.update { it.copy(isLoading = false) }
            } catch (e: Exception) {
                Timber.e(e, "Failed to send file")
                _uiState.update { it.copy(isLoading = false, error = e.message) }
                _events.emit(FileTransferUiEvent.ShowError(
                    e.message ?: "Failed to send file"
                ))
            }
        }
    }

    /**
     * 接受传输请求
     */
    fun acceptTransfer(transferId: String) {
        viewModelScope.launch {
            try {
                fileTransferRepository.acceptTransfer(transferId)
                _events.emit(FileTransferUiEvent.ShowMessage("Transfer accepted"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to accept transfer")
                _events.emit(FileTransferUiEvent.ShowError(
                    e.message ?: "Failed to accept transfer"
                ))
            }
        }
    }

    /**
     * 拒绝传输请求
     */
    fun rejectTransfer(transferId: String, reason: String? = null) {
        viewModelScope.launch {
            try {
                fileTransferRepository.rejectTransfer(transferId, reason)
                _events.emit(FileTransferUiEvent.ShowMessage("Transfer rejected"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to reject transfer")
                _events.emit(FileTransferUiEvent.ShowError(
                    e.message ?: "Failed to reject transfer"
                ))
            }
        }
    }

    /**
     * 暂停传输
     */
    fun pauseTransfer(transferId: String) {
        viewModelScope.launch {
            try {
                fileTransferRepository.pauseTransfer(transferId)
                _events.emit(FileTransferUiEvent.ShowMessage("Transfer paused"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to pause transfer")
                _events.emit(FileTransferUiEvent.ShowError(
                    e.message ?: "Failed to pause transfer"
                ))
            }
        }
    }

    /**
     * 恢复传输
     */
    fun resumeTransfer(transferId: String) {
        viewModelScope.launch {
            try {
                fileTransferRepository.resumeTransfer(transferId)
                _events.emit(FileTransferUiEvent.ShowMessage("Transfer resumed"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to resume transfer")
                _events.emit(FileTransferUiEvent.ShowError(
                    e.message ?: "Failed to resume transfer"
                ))
            }
        }
    }

    /**
     * 取消传输
     */
    fun cancelTransfer(transferId: String) {
        viewModelScope.launch {
            try {
                fileTransferRepository.cancelTransfer(transferId, "Cancelled by user")
                _events.emit(FileTransferUiEvent.ShowMessage("Transfer cancelled"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to cancel transfer")
                _events.emit(FileTransferUiEvent.ShowError(
                    e.message ?: "Failed to cancel transfer"
                ))
            }
        }
    }

    /**
     * 重试传输
     */
    fun retryTransfer(transferId: String) {
        viewModelScope.launch {
            try {
                fileTransferRepository.retryTransfer(transferId)
                _events.emit(FileTransferUiEvent.ShowMessage("Retrying transfer..."))
            } catch (e: Exception) {
                Timber.e(e, "Failed to retry transfer")
                _events.emit(FileTransferUiEvent.ShowError(
                    e.message ?: "Failed to retry transfer"
                ))
            }
        }
    }

    /**
     * 删除传输记录
     */
    fun deleteTransfer(transferId: String) {
        viewModelScope.launch {
            try {
                fileTransferRepository.deleteTransfer(transferId)
                _events.emit(FileTransferUiEvent.ShowMessage("Transfer deleted"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to delete transfer")
                _events.emit(FileTransferUiEvent.ShowError(
                    e.message ?: "Failed to delete transfer"
                ))
            }
        }
    }

    /**
     * 清除已完成的传输
     */
    fun clearCompletedTransfers() {
        viewModelScope.launch {
            try {
                fileTransferRepository.clearCompletedTransfers()
                _events.emit(FileTransferUiEvent.ShowMessage("Completed transfers cleared"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to clear completed transfers")
            }
        }
    }

    /**
     * 清除失败的传输
     */
    fun clearFailedTransfers() {
        viewModelScope.launch {
            try {
                fileTransferRepository.clearFailedTransfers()
                _events.emit(FileTransferUiEvent.ShowMessage("Failed transfers cleared"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to clear failed transfers")
            }
        }
    }

    /**
     * 选择传输（用于详情页）
     */
    fun selectTransfer(transferId: String?) {
        _uiState.update { it.copy(selectedTransferId = transferId) }
    }

    /**
     * 获取传输进度
     */
    fun getProgress(transferId: String): TransferProgress? {
        return allTransfersProgress.value[transferId]
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    // Private helpers

    private fun observeTransferResults() {
        viewModelScope.launch {
            fileTransferRepository.transferResults.collect { result ->
                val transfer = fileTransferRepository.getTransferById(result.transferId)
                val fileName = transfer?.fileName ?: "File"
                val isOutgoing = transfer?.isOutgoing ?: true

                if (result.success) {
                    _events.emit(FileTransferUiEvent.TransferCompleted(
                        result.transferId,
                        fileName,
                        result.localFilePath
                    ))

                    // 显示完成通知
                    notificationManager.showCompletionNotification(
                        transferId = result.transferId,
                        fileName = fileName,
                        success = true,
                        isOutgoing = isOutgoing
                    )
                } else {
                    _events.emit(FileTransferUiEvent.TransferFailed(
                        result.transferId,
                        result.errorMessage
                    ))

                    // 显示失败通知
                    notificationManager.showCompletionNotification(
                        transferId = result.transferId,
                        fileName = fileName,
                        success = false,
                        isOutgoing = isOutgoing,
                        errorMessage = result.errorMessage
                    )
                }

                // 清理通知时间戳缓存
                lastNotificationUpdate.remove(result.transferId)
            }
        }
    }

    /**
     * 观察进度并更新系统通知
     */
    private fun observeProgressForNotifications() {
        viewModelScope.launch {
            allTransfersProgress.collect { progressMap ->
                val currentTime = System.currentTimeMillis()

                progressMap.forEach { (transferId, progress) ->
                    // 节流：每500ms最多更新一次通知
                    val lastUpdate = lastNotificationUpdate[transferId] ?: 0L
                    if (currentTime - lastUpdate < NOTIFICATION_UPDATE_INTERVAL) {
                        return@forEach
                    }

                    // 只在传输中状态更新通知
                    if (progress.status == FileTransferStatus.TRANSFERRING) {
                        val transfer = fileTransferRepository.getTransferById(transferId)
                        if (transfer != null) {
                            notificationManager.showProgressNotification(
                                transferId = transferId,
                                fileName = transfer.fileName,
                                progress = progress,
                                isOutgoing = transfer.isOutgoing
                            )
                            lastNotificationUpdate[transferId] = currentTime
                        }
                    }
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        // 清理所有进度通知（保留完成通知）
        lastNotificationUpdate.keys.forEach { transferId ->
            notificationManager.cancelProgressNotification(transferId)
        }
    }
}
