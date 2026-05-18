package com.chainlesschain.android.remote.ui.storage

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.StorageCommands
import com.chainlesschain.android.remote.commands.DiskInfo
import com.chainlesschain.android.remote.commands.PartitionInfo
import com.chainlesschain.android.remote.commands.FileStats
import com.chainlesschain.android.remote.commands.StorageStats
import com.chainlesschain.android.remote.commands.StorageUsageResponse
import com.chainlesschain.android.remote.commands.LargeFile
import com.chainlesschain.android.remote.commands.RecentFile
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 存储信息 ViewModel
 *
 * 功能：
 * - 磁盘信息查看
 * - 分区信息
 * - 存储统计
 * - 大文件查找
 * - 最近文件
 * - 磁盘清理
 */
@HiltViewModel
class StorageInfoViewModel @Inject constructor(
    private val storageCommands: StorageCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(StorageInfoUiState())
    val uiState: StateFlow<StorageInfoUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 磁盘列表
    private val _disks = MutableStateFlow<List<DiskInfo>>(emptyList())
    val disks: StateFlow<List<DiskInfo>> = _disks.asStateFlow()

    // 分区列表
    private val _partitions = MutableStateFlow<List<PartitionInfo>>(emptyList())
    val partitions: StateFlow<List<PartitionInfo>> = _partitions.asStateFlow()

    // 存储统计
    private val _storageStats = MutableStateFlow<StorageStats?>(null)
    val storageStats: StateFlow<StorageStats?> = _storageStats.asStateFlow()

    // 大文件列表
    private val _largeFiles = MutableStateFlow<List<LargeFile>>(emptyList())
    val largeFiles: StateFlow<List<LargeFile>> = _largeFiles.asStateFlow()

    // 最近文件列表
    private val _recentFiles = MutableStateFlow<List<RecentFile>>(emptyList())
    val recentFiles: StateFlow<List<RecentFile>> = _recentFiles.asStateFlow()

    init {
        loadDisks()
        loadStorageStats()
    }

    /**
     * 加载磁盘列表
     */
    fun loadDisks() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = storageCommands.getDisks()

            if (result.isSuccess) {
                _disks.value = result.getOrNull()?.disks ?: emptyList()
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "加载磁盘信息失败")
            }
        }
    }

    /**
     * 获取磁盘使用情况
     */
    fun getUsage(path: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = storageCommands.getUsage()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isLoading = false,
                    selectedDiskUsage = response
                )}
            } else {
                handleError(result.exceptionOrNull(), "获取使用情况失败")
            }
        }
    }

    /**
     * 加载分区信息
     */
    fun loadPartitions() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = storageCommands.getPartitions()

            if (result.isSuccess) {
                _partitions.value = result.getOrNull()?.partitions ?: emptyList()
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "加载分区信息失败")
            }
        }
    }

    /**
     * 加载存储统计
     */
    fun loadStorageStats() {
        viewModelScope.launch {
            val result = storageCommands.getUsage()

            if (result.isSuccess) {
                val usage = result.getOrNull()?.usage
                _storageStats.value = usage?.let {
                    StorageStats(
                        total = it.total,
                        used = it.used,
                        free = it.free,
                        totalFormatted = it.totalFormatted,
                        usedFormatted = it.usedFormatted,
                        freeFormatted = it.freeFormatted,
                        usagePercent = it.usagePercent
                    )
                }
            } else {
                Timber.w(result.exceptionOrNull(), "获取存储统计失败")
            }
        }
    }

    /**
     * 获取文件夹大小
     */
    fun getFolderSize(path: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = storageCommands.getFolderSize(path)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isLoading = false,
                    lastAction = "Folder size: ${response?.sizeFormatted ?: "N/A"}"
                )}
            } else {
                handleError(result.exceptionOrNull(), "获取文件夹大小失败")
            }
        }
    }

    /**
     * 查找大文件
     */
    fun findLargeFiles(path: String = "/", minSize: Long = 100 * 1024 * 1024, limit: Int = 20) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = storageCommands.getLargeFiles(path, minSize, limit)

            if (result.isSuccess) {
                _largeFiles.value = result.getOrNull()?.files ?: emptyList()
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "查找大文件失败")
            }
        }
    }

    /**
     * 获取最近文件
     */
    fun getRecentFiles(limit: Int = 20) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = storageCommands.getRecentFiles(limit = limit)

            if (result.isSuccess) {
                _recentFiles.value = result.getOrNull()?.files ?: emptyList()
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "获取最近文件失败")
            }
        }
    }

    /**
     * 清理磁盘
     */
    fun cleanup(dryRun: Boolean = true, maxAge: Int = 7) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = storageCommands.cleanup(dryRun, maxAge)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Cleaned: ${response?.cleaned?.totalSizeFormatted ?: "0 B"}"
                )}
                // 刷新统计
                loadStorageStats()
            } else {
                handleError(result.exceptionOrNull(), "磁盘清理失败")
            }
        }
    }

    /**
     * 清空回收站
     */
    fun emptyTrash() {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = storageCommands.emptyTrash()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Trash emptied: ${response?.message ?: "Done"}"
                )}
            } else {
                handleError(result.exceptionOrNull(), "清空回收站失败")
            }
        }
    }

    /**
     * 获取磁盘健康状态
     */
    fun getDriveHealth() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = storageCommands.getDriveHealth()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isLoading = false,
                    driveHealthInfo = response
                )}
            } else {
                handleError(result.exceptionOrNull(), "获取磁盘健康状态失败")
            }
        }
    }

    /**
     * 刷新所有数据
     */
    fun refresh() {
        loadDisks()
        loadStorageStats()
    }

    /**
     * 处理错误
     */
    private fun handleError(throwable: Throwable?, defaultMessage: String) {
        val error = throwable?.message ?: defaultMessage
        Timber.e(throwable, defaultMessage)
        _uiState.update { it.copy(
            isLoading = false,
            isExecuting = false,
            error = error
        )}
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

/**
 * 存储信息 UI 状态
 */
@Immutable
data class StorageInfoUiState(
    val isLoading: Boolean = false,
    val isExecuting: Boolean = false,
    val error: String? = null,
    val lastAction: String? = null,
    val selectedDiskUsage: StorageUsageResponse? = null,
    val driveHealthInfo: com.chainlesschain.android.remote.commands.DriveHealthResponse? = null
)
