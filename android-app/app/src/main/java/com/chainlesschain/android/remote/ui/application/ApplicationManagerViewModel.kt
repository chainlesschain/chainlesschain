package com.chainlesschain.android.remote.ui.application

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.ApplicationCommands
import com.chainlesschain.android.remote.commands.InstalledApp
import com.chainlesschain.android.remote.commands.RunningApp
import com.chainlesschain.android.remote.commands.AppDetail
import com.chainlesschain.android.remote.commands.RecentApp
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 应用程序管理 ViewModel
 *
 * 功能：
 * - 已安装应用列表
 * - 运行中应用列表
 * - 启动/关闭应用
 * - 搜索应用
 * - 最近使用的应用
 */
@HiltViewModel
class ApplicationManagerViewModel @Inject constructor(
    private val applicationCommands: ApplicationCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(ApplicationManagerUiState())
    val uiState: StateFlow<ApplicationManagerUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 已安装应用列表
    private val _installedApps = MutableStateFlow<List<InstalledApp>>(emptyList())
    val installedApps: StateFlow<List<InstalledApp>> = _installedApps.asStateFlow()

    // 运行中应用列表
    private val _runningApps = MutableStateFlow<List<RunningApp>>(emptyList())
    val runningApps: StateFlow<List<RunningApp>> = _runningApps.asStateFlow()

    // 最近使用的应用
    private val _recentApps = MutableStateFlow<List<RecentApp>>(emptyList())
    val recentApps: StateFlow<List<RecentApp>> = _recentApps.asStateFlow()

    // 选中的应用详情
    private val _selectedApp = MutableStateFlow<AppDetail?>(null)
    val selectedApp: StateFlow<AppDetail?> = _selectedApp.asStateFlow()

    // 搜索查询
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    // 过滤后的已安装应用
    val filteredInstalledApps: StateFlow<List<InstalledApp>> = combine(
        _installedApps,
        _searchQuery
    ) { apps, query ->
        if (query.isBlank()) {
            apps
        } else {
            apps.filter { it.name.contains(query, ignoreCase = true) }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        loadRunningApps()
        loadRecentApps()
    }

    /**
     * 加载已安装应用
     */
    fun loadInstalledApps(limit: Int = 100, filter: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = applicationCommands.listInstalled(limit, filter)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _installedApps.value = response?.apps ?: emptyList()
                _uiState.update { it.copy(
                    isLoading = false,
                    totalInstalled = response?.total ?: 0
                )}
            } else {
                handleError(result.exceptionOrNull(), "加载已安装应用失败")
            }
        }
    }

    /**
     * 加载运行中应用
     */
    fun loadRunningApps(limit: Int = 100) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = applicationCommands.listRunning(limit)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _runningApps.value = response?.apps ?: emptyList()
                _uiState.update { it.copy(
                    isLoading = false,
                    totalRunning = response?.total ?: 0
                )}
            } else {
                handleError(result.exceptionOrNull(), "加载运行中应用失败")
            }
        }
    }

    /**
     * 加载最近使用的应用
     */
    fun loadRecentApps(limit: Int = 10) {
        viewModelScope.launch {
            val result = applicationCommands.getRecent(limit)

            if (result.isSuccess) {
                _recentApps.value = result.getOrNull()?.apps ?: emptyList()
            } else {
                Timber.w(result.exceptionOrNull(), "加载最近应用失败")
            }
        }
    }

    /**
     * 获取应用详情
     */
    fun getAppInfo(name: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val result = applicationCommands.getInfo(name = name)

            if (result.isSuccess) {
                _selectedApp.value = result.getOrNull()?.app
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "获取应用详情失败")
            }
        }
    }

    /**
     * 启动应用
     */
    fun launchApp(name: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = applicationCommands.launch(name = name)

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Launched: $name"
                )}
                // 刷新运行中应用
                loadRunningApps()
            } else {
                handleError(result.exceptionOrNull(), "启动应用失败")
            }
        }
    }

    /**
     * 关闭应用
     */
    fun closeApp(name: String? = null, pid: Int? = null, force: Boolean = false) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = applicationCommands.close(name, pid, force)

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Closed: ${name ?: "PID $pid"}"
                )}
                // 刷新运行中应用
                loadRunningApps()
            } else {
                handleError(result.exceptionOrNull(), "关闭应用失败")
            }
        }
    }

    /**
     * 聚焦应用窗口
     */
    fun focusApp(name: String? = null, pid: Int? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = applicationCommands.focus(name, pid)

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Focused: ${name ?: "PID $pid"}"
                )}
            } else {
                handleError(result.exceptionOrNull(), "聚焦应用失败")
            }
        }
    }

    /**
     * 搜索应用
     */
    fun searchApps(query: String) {
        viewModelScope.launch {
            if (query.isBlank()) {
                loadInstalledApps()
                return@launch
            }

            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = applicationCommands.search(query)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _installedApps.value = response?.apps ?: emptyList()
                _uiState.update { it.copy(
                    isLoading = false,
                    totalInstalled = response?.total ?: 0
                )}
            } else {
                handleError(result.exceptionOrNull(), "搜索应用失败")
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
     * 请求关闭确认
     */
    fun requestCloseConfirmation(name: String, pid: Int?) {
        _uiState.update { it.copy(
            pendingCloseName = name,
            pendingClosePid = pid,
            showCloseConfirmDialog = true
        )}
    }

    /**
     * 确认关闭
     */
    fun confirmClose(force: Boolean = false) {
        val name = _uiState.value.pendingCloseName
        val pid = _uiState.value.pendingClosePid
        dismissCloseConfirmDialog()
        closeApp(name, pid, force)
    }

    /**
     * 取消关闭对话框
     */
    fun dismissCloseConfirmDialog() {
        _uiState.update { it.copy(
            pendingCloseName = null,
            pendingClosePid = null,
            showCloseConfirmDialog = false
        )}
    }

    /**
     * 清除选中的应用
     */
    fun clearSelectedApp() {
        _selectedApp.value = null
    }

    /**
     * 刷新
     */
    fun refresh() {
        loadRunningApps()
        loadRecentApps()
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
 * 应用程序管理 UI 状态
 */
data class ApplicationManagerUiState(
    val isLoading: Boolean = false,
    val isExecuting: Boolean = false,
    val error: String? = null,
    val lastAction: String? = null,
    val totalInstalled: Int = 0,
    val totalRunning: Int = 0,
    val pendingCloseName: String? = null,
    val pendingClosePid: Int? = null,
    val showCloseConfirmDialog: Boolean = false
)
