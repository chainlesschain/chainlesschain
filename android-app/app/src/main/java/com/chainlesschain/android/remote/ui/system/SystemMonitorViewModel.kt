package com.chainlesschain.android.remote.ui.system

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.ProcessCommands
import com.chainlesschain.android.remote.commands.PowerCommands
import com.chainlesschain.android.remote.commands.SystemCommands
import com.chainlesschain.android.remote.commands.SystemInfoCommands
import com.chainlesschain.android.remote.commands.SystemStatus
import com.chainlesschain.android.remote.commands.SystemInfo
import com.chainlesschain.android.remote.events.EventSubscriptionClient
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
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
 * - GPU、电池、进程信息
 * - 系统信息
 * - 历史数据图表
 */
@HiltViewModel
class SystemMonitorViewModel @Inject constructor(
    private val systemCommands: SystemCommands,
    private val systemInfoCommands: SystemInfoCommands,
    private val processCommands: ProcessCommands,
    private val powerCommands: PowerCommands,
    private val eventClient: EventSubscriptionClient,
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

    // 扩展信息
    private val _gpuInfo = MutableStateFlow<SystemInfoCommands.GpuInfoResponse?>(null)
    val gpuInfo: StateFlow<SystemInfoCommands.GpuInfoResponse?> = _gpuInfo.asStateFlow()

    private val _batteryInfo = MutableStateFlow<PowerCommands.BatteryStatusResponse?>(null)
    val batteryInfo: StateFlow<PowerCommands.BatteryStatusResponse?> = _batteryInfo.asStateFlow()

    private val _topProcesses = MutableStateFlow<List<ProcessInfo>>(emptyList())
    val topProcesses: StateFlow<List<ProcessInfo>> = _topProcesses.asStateFlow()

    private val _networkStats = MutableStateFlow<SystemInfoCommands.NetworkStatsResponse?>(null)
    val networkStats: StateFlow<SystemInfoCommands.NetworkStatsResponse?> = _networkStats.asStateFlow()

    // CPU 使用率历史（最近 60 个数据点）
    private val _cpuHistory = MutableStateFlow<List<Float>>(emptyList())
    val cpuHistory: StateFlow<List<Float>> = _cpuHistory.asStateFlow()

    // 内存使用率历史
    private val _memoryHistory = MutableStateFlow<List<Float>>(emptyList())
    val memoryHistory: StateFlow<List<Float>> = _memoryHistory.asStateFlow()

    // GPU 使用率历史
    private val _gpuHistory = MutableStateFlow<List<Float>>(emptyList())
    val gpuHistory: StateFlow<List<Float>> = _gpuHistory.asStateFlow()

    // 网络带宽历史 (download, upload)
    private val _networkHistory = MutableStateFlow<List<Pair<Long, Long>>>(emptyList())
    val networkHistory: StateFlow<List<Pair<Long, Long>>> = _networkHistory.asStateFlow()

    // 自动刷新标志
    private var isAutoRefreshActive = false
    private var eventSubscriptionId: String? = null
    private var processMonitorJob: Job? = null

    init {
        // 初始化时获取系统信息
        loadSystemInfo()
        loadExtendedInfo()
        setupEventSubscription()
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

    /**
     * 加载扩展系统信息
     */
    fun loadExtendedInfo() {
        viewModelScope.launch {
            // 并行加载 GPU、电池、网络信息
            launch { loadGpuInfo() }
            launch { loadBatteryInfo() }
            launch { loadNetworkStats() }
            launch { loadTopProcesses() }
        }
    }

    /**
     * 加载 GPU 信息
     */
    private suspend fun loadGpuInfo() {
        val result = systemInfoCommands.getGPU()
        if (result.isSuccess) {
            _gpuInfo.value = result.getOrNull()
        } else {
            Timber.w("获取 GPU 信息失败: ${result.exceptionOrNull()?.message}")
        }
    }

    /**
     * 加载电池信息
     */
    private suspend fun loadBatteryInfo() {
        val result = powerCommands.getBatteryStatus()
        if (result.isSuccess) {
            _batteryInfo.value = result.getOrNull()
        } else {
            Timber.w("获取电池信息失败: ${result.exceptionOrNull()?.message}")
        }
    }

    /**
     * 加载网络统计
     */
    private suspend fun loadNetworkStats() {
        val result = systemInfoCommands.getNetworkStats()
        if (result.isSuccess) {
            val stats = result.getOrNull()
            _networkStats.value = stats
            if (stats != null) {
                _networkHistory.update { history ->
                    (history + Pair(stats.bytesReceived, stats.bytesSent)).takeLast(60)
                }
            }
        }
    }

    /**
     * 加载 Top 进程列表
     */
    private suspend fun loadTopProcesses() {
        val result = processCommands.list("cpu", 10)
        if (result.isSuccess) {
            val response = result.getOrNull()
            @Suppress("UNCHECKED_CAST")
            val processes = (response?.processes as? List<Map<String, Any>>)?.map { proc ->
                ProcessInfo(
                    pid = (proc["pid"] as? Number)?.toInt() ?: 0,
                    name = proc["name"] as? String ?: "",
                    cpuUsage = (proc["cpuUsage"] as? Number)?.toFloat() ?: 0f,
                    memoryUsage = (proc["memoryUsage"] as? Number)?.toLong() ?: 0,
                    status = proc["status"] as? String ?: "unknown"
                )
            } ?: emptyList()
            _topProcesses.value = processes
        }
    }

    /**
     * 设置事件订阅
     */
    private fun setupEventSubscription() {
        viewModelScope.launch {
            // 订阅电池状态变化
            eventClient.subscribeBatteryStatus { event ->
                val level = (event.params["level"] as? Number)?.toInt()
                val isCharging = event.params["isCharging"] as? Boolean
                if (level != null) {
                    _batteryInfo.update { current ->
                        current?.copy(level = level, isCharging = isCharging ?: current.isCharging)
                    }
                }
            }.onSuccess { id ->
                eventSubscriptionId = id
            }
        }
    }

    /**
     * 开始进程监控
     */
    fun startProcessMonitor(pid: Int) {
        processMonitorJob?.cancel()
        processMonitorJob = viewModelScope.launch {
            val result = processCommands.startMonitor(pid, 2000)
            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(monitoringProcessId = pid, monitorId = response?.monitorId) }

                // 订阅进程监控事件
                eventClient.subscribeProcessMonitor(pid) { event ->
                    val cpuUsage = (event.params["cpuUsage"] as? Number)?.toFloat()
                    val memoryUsage = (event.params["memoryUsage"] as? Number)?.toLong()
                    // 更新监控数据
                    _uiState.update { state ->
                        state.copy(
                            monitoredProcessCpu = cpuUsage,
                            monitoredProcessMemory = memoryUsage
                        )
                    }
                }
            }
        }
    }

    /**
     * 停止进程监控
     */
    fun stopProcessMonitor() {
        val monitorId = _uiState.value.monitorId
        if (monitorId != null) {
            viewModelScope.launch {
                processCommands.stopMonitor(monitorId)
            }
        }
        processMonitorJob?.cancel()
        processMonitorJob = null
        _uiState.update { it.copy(monitoringProcessId = null, monitorId = null) }
    }

    /**
     * 终止进程
     */
    fun killProcess(pid: Int, force: Boolean = false) {
        viewModelScope.launch {
            val result = processCommands.kill(pid, force)
            if (result.isSuccess) {
                // 刷新进程列表
                loadTopProcesses()
            } else {
                _uiState.update { it.copy(error = "终止进程失败: ${result.exceptionOrNull()?.message}") }
            }
        }
    }

    /**
     * 设置进程优先级
     */
    fun setProcessPriority(pid: Int, priority: Int) {
        viewModelScope.launch {
            val result = processCommands.setPriority(pid, priority)
            if (result.isFailure) {
                _uiState.update { it.copy(error = "设置优先级失败: ${result.exceptionOrNull()?.message}") }
            }
        }
    }

    /**
     * 获取完整系统报告
     */
    fun generateFullReport() {
        viewModelScope.launch {
            _uiState.update { it.copy(isGeneratingReport = true) }

            val result = systemInfoCommands.getFullReport()

            if (result.isSuccess) {
                val report = result.getOrNull()
                _uiState.update { it.copy(
                    isGeneratingReport = false,
                    lastFullReport = report
                )}
            } else {
                _uiState.update { it.copy(
                    isGeneratingReport = false,
                    error = "生成报告失败: ${result.exceptionOrNull()?.message}"
                )}
            }
        }
    }

    /**
     * 运行 CPU 基准测试
     */
    fun runCpuBenchmark() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRunningBenchmark = true) }

            val result = systemInfoCommands.runCpuBenchmark()

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isRunningBenchmark = false,
                    lastBenchmarkScore = result.getOrNull()?.score
                )}
            } else {
                _uiState.update { it.copy(
                    isRunningBenchmark = false,
                    error = "基准测试失败: ${result.exceptionOrNull()?.message}"
                )}
            }
        }
    }

    /**
     * 切换监控视图
     */
    fun setMonitorView(view: MonitorView) {
        _uiState.update { it.copy(currentView = view) }
    }

    override fun onCleared() {
        super.onCleared()
        stopAutoRefresh()
        stopProcessMonitor()

        // 取消事件订阅
        eventSubscriptionId?.let { id ->
            viewModelScope.launch {
                eventClient.unsubscribe(id)
            }
        }
    }
}

/**
 * 监控视图类型
 */
enum class MonitorView {
    OVERVIEW,
    CPU,
    MEMORY,
    GPU,
    NETWORK,
    PROCESSES,
    STORAGE,
    BATTERY
}

/**
 * 进程信息
 */
data class ProcessInfo(
    val pid: Int,
    val name: String,
    val cpuUsage: Float,
    val memoryUsage: Long,
    val status: String
)

/**
 * UI 状态
 */
data class SystemMonitorUiState(
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val isAutoRefreshEnabled: Boolean = false,
    val refreshInterval: Int = 5, // 秒
    val lastRefreshTime: Long = 0,
    // 扩展状态
    val currentView: MonitorView = MonitorView.OVERVIEW,
    val monitoringProcessId: Int? = null,
    val monitorId: String? = null,
    val monitoredProcessCpu: Float? = null,
    val monitoredProcessMemory: Long? = null,
    val isGeneratingReport: Boolean = false,
    val lastFullReport: SystemInfoCommands.FullSystemReportResponse? = null,
    val isRunningBenchmark: Boolean = false,
    val lastBenchmarkScore: Int? = null
)
