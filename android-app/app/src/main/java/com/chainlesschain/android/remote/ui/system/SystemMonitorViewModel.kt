package com.chainlesschain.android.remote.ui.system

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.SystemCommands
import com.chainlesschain.android.remote.commands.SystemStatus
import com.chainlesschain.android.remote.commands.SystemInfo
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 系统监控 ViewModel
 *
 * 功能：
 * - 实时监控 PC 端系统状态
 * - CPU、内存、磁盘使用率
 * - 系统信息
 * - 历史数据图表
 */
@HiltViewModel
class SystemMonitorViewModel @Inject constructor(
    private val systemCommands: SystemCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(SystemMonitorUiState())
    val uiState: StateFlow<SystemMonitorUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 当前系统状态
    private val _currentStatus = MutableStateFlow<SystemStatus?>(null)
    val currentStatus: StateFlow<SystemStatus?> = _currentStatus.asStateFlow()

    // 系统信息
    private val _systemInfo = MutableStateFlow<SystemInfo?>(null)
    val systemInfo: StateFlow<SystemInfo?> = _systemInfo.asStateFlow()

    // CPU 使用率历史（最近 60 个数据点）
    private val _cpuHistory = MutableStateFlow<List<Float>>(emptyList())
    val cpuHistory: StateFlow<List<Float>> = _cpuHistory.asStateFlow()

    // 内存使用率历史
    private val _memoryHistory = MutableStateFlow<List<Float>>(emptyList())
    val memoryHistory: StateFlow<List<Float>> = _memoryHistory.asStateFlow()

    // 自动刷新标志
    private var isAutoRefreshActive = false

    init {
        // 初始化时获取系统信息
        loadSystemInfo()
    }

    /**
     * 开始自动刷新
     */
    fun startAutoRefresh(intervalSeconds: Int = 5) {
        if (isAutoRefreshActive) return

        isAutoRefreshActive = true
        _uiState.update { it.copy(isAutoRefreshEnabled = true, refreshInterval = intervalSeconds) }

        viewModelScope.launch {
            while (isAutoRefreshActive && connectionState.value == ConnectionState.CONNECTED) {
                refreshStatus()
                delay(intervalSeconds * 1000L)
            }
        }
    }

    /**
     * 停止自动刷新
     */
    fun stopAutoRefresh() {
        isAutoRefreshActive = false
        _uiState.update { it.copy(isAutoRefreshEnabled = false) }
    }

    /**
     * 刷新系统状态
     */
    fun refreshStatus() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true, error = null) }

            val result = systemCommands.getStatus()

            if (result.isSuccess) {
                val status = result.getOrNull()
                if (status != null) {
                    _currentStatus.value = status
                    _uiState.update { it.copy(
                        isRefreshing = false,
                        lastRefreshTime = System.currentTimeMillis()
                    )}

                    // 更新历史数据
                    updateHistory(status)
                }
            } else {
                val error = result.exceptionOrNull()?.message ?: "获取系统状态失败"
                Timber.e(result.exceptionOrNull(), "获取系统状态失败")
                _uiState.update { it.copy(
                    isRefreshing = false,
                    error = error
                )}
            }
        }
    }

    /**
     * 加载系统信息
     */
    fun loadSystemInfo() {
        viewModelScope.launch {
            val result = systemCommands.getInfo()

            if (result.isSuccess) {
                _systemInfo.value = result.getOrNull()
            } else {
                Timber.e(result.exceptionOrNull(), "获取系统信息失败")
            }
        }
    }

    /**
     * 更新历史数据
     */
    private fun updateHistory(status: SystemStatus) {
        // 解析 CPU 使用率
        val cpuUsage = parseCpuUsage(status.cpu.usage)
        _cpuHistory.update { history ->
            (history + cpuUsage).takeLast(60) // 保留最近 60 个数据点
        }

        // 解析内存使用率
        val memoryUsage = parseMemoryUsage(status.memory.usagePercent)
        _memoryHistory.update { history ->
            (history + memoryUsage).takeLast(60)
        }
    }

    /**
     * 解析 CPU 使用率（从字符串中提取百分比）
     */
    private fun parseCpuUsage(usageString: String): Float {
        return try {
            // 假设格式为 "45.2%" 或 "45.2"
            val cleaned = usageString.replace("%", "").trim()
            cleaned.toFloatOrNull() ?: 0f
        } catch (e: Exception) {
            0f
        }
    }

    /**
     * 解析内存使用率
     */
    private fun parseMemoryUsage(usageString: String): Float {
        return try {
            val cleaned = usageString.replace("%", "").trim()
            cleaned.toFloatOrNull() ?: 0f
        } catch (e: Exception) {
            0f
        }
    }

    /**
     * 设置刷新间隔
     */
    fun setRefreshInterval(intervalSeconds: Int) {
        _uiState.update { it.copy(refreshInterval = intervalSeconds) }

        // 如果正在自动刷新，重新启动
        if (isAutoRefreshActive) {
            stopAutoRefresh()
            startAutoRefresh(intervalSeconds)
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    override fun onCleared() {
        super.onCleared()
        stopAutoRefresh()
    }
}

/**
 * UI 状态
 */
data class SystemMonitorUiState(
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val isAutoRefreshEnabled: Boolean = false,
    val refreshInterval: Int = 5, // 秒
    val lastRefreshTime: Long = 0
)
