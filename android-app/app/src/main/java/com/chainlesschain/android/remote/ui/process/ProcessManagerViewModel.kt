package com.chainlesschain.android.remote.ui.process

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.ProcessCommands
import com.chainlesschain.android.remote.commands.ProcessInfo
import com.chainlesschain.android.remote.commands.ProcessDetail
import com.chainlesschain.android.remote.commands.ResourceUsage
import com.chainlesschain.android.remote.commands.SystemResources
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 进程管理 ViewModel
 *
 * 功能：
 * - 进程列表查看
 * - 进程详情
 * - 终止进程
 * - 搜索进程
 * - 资源使用情况
 */
@HiltViewModel
class ProcessManagerViewModel @Inject constructor(
    private val processCommands: ProcessCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(ProcessManagerUiState())
    val uiState: StateFlow<ProcessManagerUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 进程列表
    private val _processes = MutableStateFlow<List<ProcessInfo>>(emptyList())
    val processes: StateFlow<List<ProcessInfo>> = _processes.asStateFlow()

    // 选中的进程详情
    private val _selectedProcess = MutableStateFlow<ProcessDetail?>(null)
    val selectedProcess: StateFlow<ProcessDetail?> = _selectedProcess.asStateFlow()

    // 资源使用情况
    private val _resourceUsage = MutableStateFlow<ResourceUsage?>(null)
    val resourceUsage: StateFlow<ResourceUsage?> = _resourceUsage.asStateFlow()

    // 搜索查询
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    // 过滤后的进程列表
    val filteredProcesses: StateFlow<List<ProcessInfo>> = combine(
        _processes,
        _searchQuery
    ) { processList, query ->
        if (query.isBlank()) {
            processList
        } else {
            processList.filter {
                it.name.contains(query, ignoreCase = true) ||
                it.pid.toString().contains(query)
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // 自动刷新标志
    private var isAutoRefreshActive = false

    init {
        loadProcesses()
        loadResourceUsage()
    }

    /**
     * 加载进程列表
     */
    fun loadProcesses(sortBy: String = "cpu", limit: Int = 100) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = processCommands.list(sortBy, limit)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _processes.value = response?.processes ?: emptyList()
                _uiState.update { it.copy(
                    isLoading = false,
                    totalProcesses = response?.total ?: 0,
                    lastRefreshTime = System.currentTimeMillis()
                )}
            } else {
                handleError(result.exceptionOrNull(), "加载进程列表失败")
            }
        }
    }

    /**
     * 获取进程详情
     */
    fun getProcessDetail(pid: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val result = processCommands.get(pid)

            if (result.isSuccess) {
                _selectedProcess.value = result.getOrNull()?.process
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "获取进程详情失败")
            }
        }
    }

    /**
     * 终止进程
     */
    fun killProcess(pid: Int, force: Boolean = false) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = processCommands.kill(pid, force = force)

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Process $pid terminated"
                )}
                // 刷新进程列表
                loadProcesses()
            } else {
                handleError(result.exceptionOrNull(), "终止进程失败")
            }
        }
    }

    /**
     * 启动进程
     */
    fun startProcess(command: String, args: List<String> = emptyList()) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = processCommands.start(command, args)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Started: ${response?.command ?: command} (PID: ${response?.pid})"
                )}
                // 刷新进程列表
                delay(500) // 等待进程启动
                loadProcesses()
            } else {
                handleError(result.exceptionOrNull(), "启动进程失败")
            }
        }
    }

    /**
     * 搜索进程
     */
    fun searchProcesses(query: String) {
        viewModelScope.launch {
            if (query.isBlank()) {
                loadProcesses()
                return@launch
            }

            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = processCommands.search(query)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _processes.value = response?.processes ?: emptyList()
                _uiState.update { it.copy(
                    isLoading = false,
                    totalProcesses = response?.total ?: 0
                )}
            } else {
                handleError(result.exceptionOrNull(), "搜索进程失败")
            }
        }
    }

    /**
     * 加载资源使用情况
     */
    fun loadResourceUsage() {
        viewModelScope.launch {
            val result = processCommands.getResources()

            if (result.isSuccess) {
                val resources = result.getOrNull()?.resources
                _resourceUsage.value = resources?.let {
                    ResourceUsage(
                        cpuUsage = it.cpu.usage,
                        memoryUsage = it.memory.usagePercent,
                        processCount = _processes.value.size
                    )
                }
            } else {
                Timber.w(result.exceptionOrNull(), "获取资源使用情况失败")
            }
        }
    }

    /**
     * 更新搜索查询
     */
    fun updateSearchQuery(query: String) {
        _searchQuery.value = query
    }

    /**
     * 开始自动刷新
     */
    fun startAutoRefresh(intervalSeconds: Int = 5) {
        if (isAutoRefreshActive) return

        isAutoRefreshActive = true
        _uiState.update { it.copy(isAutoRefreshEnabled = true) }

        viewModelScope.launch {
            while (isAutoRefreshActive && connectionState.value == ConnectionState.CONNECTED) {
                loadProcesses()
                loadResourceUsage()
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
     * 清除选中的进程
     */
    fun clearSelectedProcess() {
        _selectedProcess.value = null
    }

    /**
     * 请求终止进程确认
     */
    fun requestKillConfirmation(pid: Int, name: String) {
        _uiState.update { it.copy(
            pendingKillPid = pid,
            pendingKillName = name,
            showKillConfirmDialog = true
        )}
    }

    /**
     * 确认终止进程
     */
    fun confirmKill(force: Boolean = false) {
        val pid = _uiState.value.pendingKillPid ?: return
        dismissKillConfirmDialog()
        killProcess(pid, force)
    }

    /**
     * 取消终止确认对话框
     */
    fun dismissKillConfirmDialog() {
        _uiState.update { it.copy(
            pendingKillPid = null,
            pendingKillName = null,
            showKillConfirmDialog = false
        )}
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

    override fun onCleared() {
        super.onCleared()
        stopAutoRefresh()
    }
}

/**
 * 进程管理 UI 状态
 */
@Immutable
data class ProcessManagerUiState(
    val isLoading: Boolean = false,
    val isExecuting: Boolean = false,
    val error: String? = null,
    val lastAction: String? = null,
    val totalProcesses: Int = 0,
    val isAutoRefreshEnabled: Boolean = false,
    val lastRefreshTime: Long = 0,
    val pendingKillPid: Int? = null,
    val pendingKillName: String? = null,
    val showKillConfirmDialog: Boolean = false
)
