package com.chainlesschain.android.remote.ui.file

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.client.StreamingCommandClient
import com.chainlesschain.android.remote.commands.FileCommands
import com.chainlesschain.android.remote.data.FileTransferEntity
import com.chainlesschain.android.remote.data.FileTransferProgress
import com.chainlesschain.android.remote.data.FileTransferRepository
import com.chainlesschain.android.remote.data.FileTransferStatistics
import com.chainlesschain.android.remote.events.EventSubscriptionClient
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.R
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 文件传输 ViewModel
 *
 * 功能增强：
 * - 实时进度订阅
 * - 暂停/恢复传输
 * - 批量传输
 * - 传输队列管理
 * - 断点续传
 */
@HiltViewModel
class FileTransferViewModel @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val repository: FileTransferRepository,
    private val fileCommands: FileCommands,
    private val streamingClient: StreamingCommandClient,
    private val eventClient: EventSubscriptionClient,
    private val p2pClient: P2PClient
) : ViewModel() {

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

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

    // 详细传输信息（transferId -> TransferInfo）
    private val _transferDetails = MutableStateFlow<Map<String, TransferDetailInfo>>(emptyMap())
    val transferDetails: StateFlow<Map<String, TransferDetailInfo>> = _transferDetails.asStateFlow()

    // 传输队列
    private val _transferQueue = MutableStateFlow<List<QueuedTransfer>>(emptyList())
    val transferQueue: StateFlow<List<QueuedTransfer>> = _transferQueue.asStateFlow()

    // 远程文件列表
    private val _remoteFiles = MutableStateFlow<List<RemoteFileInfo>>(emptyList())
    val remoteFiles: StateFlow<List<RemoteFileInfo>> = _remoteFiles.asStateFlow()

    // 当前路径
    private val _currentPath = MutableStateFlow("/")
    val currentPath: StateFlow<String> = _currentPath.asStateFlow()

    private var progressSubscriptionJob: Job? = null

    init {
        setupProgressSubscription()
    }

    /**
     * 设置进度订阅
     */
    private fun setupProgressSubscription() {
        progressSubscriptionJob = viewModelScope.launch {
            try {
                eventClient.subscribeFileTransferProgress().collect { progress ->
                    updateTransferProgress(progress)
                }
            } catch (e: Exception) {
                Timber.e(e, "文件传输进度订阅失败")
            }
        }
    }

    /**
     * 更新传输进度
     */
    private fun updateTransferProgress(progress: FileTransferProgress) {
        _transferProgress.update { map ->
            map + (progress.transferId to progress.progress.toDouble())
        }

        _transferDetails.update { map ->
            map + (progress.transferId to TransferDetailInfo(
                transferId = progress.transferId,
                fileName = progress.fileName,
                filePath = progress.filePath,
                direction = progress.direction,
                bytesTransferred = progress.bytesTransferred,
                totalBytes = progress.totalBytes,
                progress = progress.progress,
                speed = progress.speed,
                estimatedRemainingMs = progress.estimatedRemainingMs,
                state = progress.state
            ))
        }

        // 更新 UI 状态
        when (progress.state) {
            "completed" -> {
                _uiState.value = FileTransferUiState.Success("传输完成: ${progress.fileName}")
                removeFromQueue(progress.transferId)
            }
            "error" -> {
                _uiState.value = FileTransferUiState.Error("传输失败: ${progress.fileName}")
                removeFromQueue(progress.transferId)
            }
            "paused" -> {
                _uiState.value = FileTransferUiState.Paused(progress.fileName, progress.progress.toDouble())
            }
            else -> {
                // Other states (e.g., "transferring", "cancelled") - no UI state change needed
            }
        }
    }

    private fun removeFromQueue(transferId: String) {
        _transferQueue.update { queue ->
            queue.filter { it.transferId != transferId }
        }
    }

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
                    result.exceptionOrNull()?.message ?: context.getString(R.string.error_upload_failed)
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
                    result.exceptionOrNull()?.message ?: context.getString(R.string.error_download_failed)
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
                    result.exceptionOrNull()?.message ?: context.getString(R.string.error_cancel_failed)
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

    // ==================== 增强功能 ====================

    /**
     * 暂停传输
     */
    fun pauseTransfer(transferId: String) {
        viewModelScope.launch {
            val result = fileCommands.pauseTransfer(transferId)
            if (result.isSuccess) {
                val detail = _transferDetails.value[transferId]
                _uiState.value = FileTransferUiState.Paused(
                    detail?.fileName ?: transferId,
                    detail?.progress?.toDouble() ?: 0.0
                )
            } else {
                _uiState.value = FileTransferUiState.Error(
                    "暂停失败: ${result.exceptionOrNull()?.message}"
                )
            }
        }
    }

    /**
     * 恢复传输
     */
    fun resumeTransfer(transferId: String) {
        viewModelScope.launch {
            val result = fileCommands.resumeTransfer(transferId)
            if (result.isSuccess) {
                val detail = _transferDetails.value[transferId]
                if (detail?.direction == "upload") {
                    _uiState.value = FileTransferUiState.Uploading(
                        detail.fileName,
                        detail.progress.toDouble()
                    )
                } else {
                    _uiState.value = FileTransferUiState.Downloading(
                        detail?.fileName ?: "",
                        detail?.progress?.toDouble() ?: 0.0
                    )
                }
            } else {
                _uiState.value = FileTransferUiState.Error(
                    "恢复失败: ${result.exceptionOrNull()?.message}"
                )
            }
        }
    }

    /**
     * 批量上传文件
     */
    fun uploadFiles(files: List<Pair<Uri, String>>, deviceDid: String) {
        viewModelScope.launch {
            _uiState.value = FileTransferUiState.BatchTransfer(
                totalFiles = files.size,
                completedFiles = 0,
                currentFile = files.firstOrNull()?.second ?: ""
            )

            var completed = 0
            for ((uri, fileName) in files) {
                // 添加到队列
                val queuedTransfer = QueuedTransfer(
                    transferId = "upload-${System.currentTimeMillis()}",
                    fileName = fileName,
                    direction = "upload",
                    status = "pending"
                )
                _transferQueue.update { it + queuedTransfer }

                val result = repository.uploadFile(
                    uri = uri,
                    fileName = fileName,
                    deviceDid = deviceDid,
                    onProgress = { progress ->
                        _uiState.value = FileTransferUiState.BatchTransfer(
                            totalFiles = files.size,
                            completedFiles = completed,
                            currentFile = fileName,
                            currentProgress = progress
                        )
                    }
                )

                if (result.isSuccess) {
                    completed++
                } else {
                    Timber.e(result.exceptionOrNull(), "上传失败: $fileName")
                }
            }

            _uiState.value = if (completed == files.size) {
                FileTransferUiState.Success("批量上传完成: $completed 个文件")
            } else {
                FileTransferUiState.Error("批量上传完成: $completed/${files.size} 个文件")
            }
        }
    }

    /**
     * 批量下载文件
     */
    fun downloadFiles(files: List<String>, deviceDid: String) {
        viewModelScope.launch {
            _uiState.value = FileTransferUiState.BatchTransfer(
                totalFiles = files.size,
                completedFiles = 0,
                currentFile = files.firstOrNull() ?: ""
            )

            var completed = 0
            for (remotePath in files) {
                val fileName = remotePath.substringAfterLast("/")

                val result = repository.downloadFile(
                    remotePath = remotePath,
                    fileName = fileName,
                    deviceDid = deviceDid,
                    onProgress = { progress ->
                        _uiState.value = FileTransferUiState.BatchTransfer(
                            totalFiles = files.size,
                            completedFiles = completed,
                            currentFile = fileName,
                            currentProgress = progress
                        )
                    }
                )

                if (result.isSuccess) {
                    completed++
                }
            }

            _uiState.value = if (completed == files.size) {
                FileTransferUiState.Success("批量下载完成: $completed 个文件")
            } else {
                FileTransferUiState.Error("批量下载完成: $completed/${files.size} 个文件")
            }
        }
    }

    /**
     * 浏览远程文件
     */
    fun browseRemoteFiles(path: String = "/") {
        viewModelScope.launch {
            _uiState.value = FileTransferUiState.Loading

            val result = fileCommands.listDirectory(path)
            if (result.isSuccess) {
                val response = result.getOrNull()
                val files = response?.entries?.map { entry ->
                    RemoteFileInfo(
                        name = entry.name,
                        path = entry.path,
                        size = entry.size,
                        isDirectory = entry.type == "directory",
                        modifiedTime = entry.modifiedTime,
                        permissions = entry.permissions
                    )
                } ?: emptyList()

                _remoteFiles.value = files
                _currentPath.value = path
                _uiState.value = FileTransferUiState.Idle
            } else {
                _uiState.value = FileTransferUiState.Error(
                    "浏览失败: ${result.exceptionOrNull()?.message}"
                )
            }
        }
    }

    /**
     * 创建远程文件夹
     */
    fun createRemoteFolder(path: String) {
        viewModelScope.launch {
            val result = fileCommands.createDirectory(path)
            if (result.isSuccess) {
                // 刷新当前目录
                browseRemoteFiles(_currentPath.value)
            } else {
                _uiState.value = FileTransferUiState.Error(
                    "创建文件夹失败: ${result.exceptionOrNull()?.message}"
                )
            }
        }
    }

    /**
     * 删除远程文件
     */
    fun deleteRemoteFile(path: String) {
        viewModelScope.launch {
            val result = fileCommands.delete(path)
            if (result.isSuccess) {
                browseRemoteFiles(_currentPath.value)
            } else {
                _uiState.value = FileTransferUiState.Error(
                    "删除失败: ${result.exceptionOrNull()?.message}"
                )
            }
        }
    }

    /**
     * 搜索远程文件
     */
    fun searchRemoteFiles(query: String, path: String = "/") {
        viewModelScope.launch {
            _uiState.value = FileTransferUiState.Loading

            val result = fileCommands.search(path, query)
            if (result.isSuccess) {
                val response = result.getOrNull()
                @Suppress("UNCHECKED_CAST")
                val files = (response?.results as? List<Map<String, Any>>)?.map { file ->
                    RemoteFileInfo(
                        name = file["name"] as? String ?: "",
                        path = file["path"] as? String ?: "",
                        size = (file["size"] as? Number)?.toLong() ?: 0,
                        isDirectory = file["isDirectory"] as? Boolean ?: false,
                        modifiedTime = (file["modifiedTime"] as? Number)?.toLong() ?: 0
                    )
                } ?: emptyList()

                _remoteFiles.value = files
                _uiState.value = FileTransferUiState.Idle
            } else {
                _uiState.value = FileTransferUiState.Error(
                    "搜索失败: ${result.exceptionOrNull()?.message}"
                )
            }
        }
    }

    /**
     * 压缩文件
     */
    fun compressFiles(sources: List<String>, destination: String) {
        viewModelScope.launch {
            _uiState.value = FileTransferUiState.Compressing(destination, 0.0)

            val result = fileCommands.compress(sources, destination)
            if (result.isSuccess) {
                _uiState.value = FileTransferUiState.Success("压缩完成: $destination")
                browseRemoteFiles(_currentPath.value)
            } else {
                _uiState.value = FileTransferUiState.Error(
                    "压缩失败: ${result.exceptionOrNull()?.message}"
                )
            }
        }
    }

    /**
     * 解压文件
     */
    fun extractArchive(archivePath: String, destination: String) {
        viewModelScope.launch {
            _uiState.value = FileTransferUiState.Extracting(archivePath, 0.0)

            val result = fileCommands.decompress(archivePath, destination)
            if (result.isSuccess) {
                _uiState.value = FileTransferUiState.Success("解压完成")
                browseRemoteFiles(destination)
            } else {
                _uiState.value = FileTransferUiState.Error(
                    "解压失败: ${result.exceptionOrNull()?.message}"
                )
            }
        }
    }

    /**
     * 获取磁盘信息
     */
    fun getDiskInfo() {
        viewModelScope.launch {
            try {
                val result = fileCommands.getDiskUsage()
                if (result.isSuccess) {
                    val info = result.getOrNull()
                    _uiState.value = FileTransferUiState.DiskInfo(
                        totalSpace = info?.total ?: 0,
                        freeSpace = info?.available ?: 0,
                        usedSpace = info?.used ?: 0
                    )
                } else {
                    Timber.w(result.exceptionOrNull(), "获取磁盘信息失败")
                }
            } catch (e: Exception) {
                Timber.e(e, "获取磁盘信息异常")
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        progressSubscriptionJob?.cancel()
    }
}

/**
 * 传输详细信息
 */
data class TransferDetailInfo(
    val transferId: String,
    val fileName: String,
    val filePath: String,
    val direction: String,
    val bytesTransferred: Long,
    val totalBytes: Long,
    val progress: Float,
    val speed: Long,
    val estimatedRemainingMs: Long?,
    val state: String
)

/**
 * 队列传输项
 */
data class QueuedTransfer(
    val transferId: String,
    val fileName: String,
    val direction: String,
    val status: String
)

/**
 * 远程文件信息
 */
data class RemoteFileInfo(
    val name: String,
    val path: String,
    val size: Long,
    val isDirectory: Boolean,
    val modifiedTime: Long,
    val permissions: String? = null
)

/**
 * 文件传输 UI 状态
 */
sealed class FileTransferUiState {
    object Idle : FileTransferUiState()
    object Loading : FileTransferUiState()

    data class Uploading(
        val fileName: String,
        val progress: Double
    ) : FileTransferUiState()

    data class Downloading(
        val fileName: String,
        val progress: Double
    ) : FileTransferUiState()

    data class Paused(
        val fileName: String,
        val progress: Double
    ) : FileTransferUiState()

    data class BatchTransfer(
        val totalFiles: Int,
        val completedFiles: Int,
        val currentFile: String,
        val currentProgress: Double = 0.0
    ) : FileTransferUiState()

    data class Compressing(
        val fileName: String,
        val progress: Double
    ) : FileTransferUiState()

    data class Extracting(
        val fileName: String,
        val progress: Double
    ) : FileTransferUiState()

    data class DiskInfo(
        val totalSpace: Long,
        val freeSpace: Long,
        val usedSpace: Long
    ) : FileTransferUiState()

    data class Success(val message: String) : FileTransferUiState()
    data class Error(val message: String) : FileTransferUiState()
}
