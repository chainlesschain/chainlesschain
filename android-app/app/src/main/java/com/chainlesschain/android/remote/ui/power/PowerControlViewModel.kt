package com.chainlesschain.android.remote.ui.power

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.PowerCommands
import com.chainlesschain.android.remote.commands.ScheduleInfo
import com.chainlesschain.android.remote.commands.ScheduledTask
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 电源控制 ViewModel
 *
 * 功能：
 * - 关机、重启、睡眠、休眠
 * - 锁定、注销
 * - 定时关机管理
 * - 操作确认
 */
@HiltViewModel
class PowerControlViewModel @Inject constructor(
    private val powerCommands: PowerCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(PowerControlUiState())
    val uiState: StateFlow<PowerControlUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 定时任务列表
    private val _scheduledTasks = MutableStateFlow<List<ScheduledTask>>(emptyList())
    val scheduledTasks: StateFlow<List<ScheduledTask>> = _scheduledTasks.asStateFlow()

    // 当前定时任务信息（供 UI 层使用）
    private val _scheduleInfo = MutableStateFlow<ScheduleInfo?>(null)
    val scheduleInfo: StateFlow<ScheduleInfo?> = _scheduleInfo.asStateFlow()

    init {
        loadScheduleInfo()
    }

    /**
     * 关机
     */
    fun shutdown(delay: Int = 0, force: Boolean = false) {
        executePowerAction("shutdown") {
            powerCommands.shutdown(delay, force)
        }
    }

    /**
     * 重启
     */
    fun restart(delay: Int = 0, force: Boolean = false) {
        executePowerAction("restart") {
            powerCommands.restart(delay, force)
        }
    }

    /**
     * 睡眠
     */
    fun sleep() {
        executePowerAction("sleep") {
            powerCommands.sleep()
        }
    }

    /**
     * 休眠
     */
    fun hibernate() {
        executePowerAction("hibernate") {
            powerCommands.hibernate()
        }
    }

    /**
     * 锁定工作站
     */
    fun lock() {
        executePowerAction("lock") {
            powerCommands.lock()
        }
    }

    /**
     * 注销当前用户
     */
    fun logout(force: Boolean = false) {
        executePowerAction("logout") {
            powerCommands.logout(force)
        }
    }

    /**
     * 设置定时关机
     */
    fun scheduleShutdown(minutes: Int, action: String = "shutdown") {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = powerCommands.scheduleShutdown(delay = minutes * 60, action = action)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "定时${action}已设置",
                    lastActionTime = System.currentTimeMillis()
                )}
                loadScheduleInfo()
            } else {
                handleError(result.exceptionOrNull(), "设置定时任务失败")
            }
        }
    }

    /**
     * 取消当前定时任务（无参数版本，取消第一个任务）
     */
    fun cancelSchedule() {
        val taskId = _scheduledTasks.value.firstOrNull()?.id ?: return
        cancelSchedule(taskId)
    }

    /**
     * 取消定时任务
     */
    fun cancelSchedule(taskId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = powerCommands.cancelSchedule(taskId)

            if (result.isSuccess) {
                _scheduledTasks.value = _scheduledTasks.value.filter { it.id != taskId }
                if (_scheduledTasks.value.isEmpty()) {
                    _scheduleInfo.value = null
                }
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "定时任务已取消",
                    lastActionTime = System.currentTimeMillis()
                )}
            } else {
                handleError(result.exceptionOrNull(), "取消定时任务失败")
            }
        }
    }

    /**
     * 加载定时任务信息
     */
    fun loadScheduleInfo() {
        viewModelScope.launch {
            val result = powerCommands.getSchedule()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _scheduledTasks.value = response?.tasks ?: emptyList()
                // Populate scheduleInfo from response or first task
                _scheduleInfo.value = response?.schedule ?: response?.tasks?.firstOrNull()?.let { task ->
                    ScheduleInfo(
                        action = task.action,
                        scheduledTime = task.scheduledTime
                    )
                }
            } else {
                Timber.w(result.exceptionOrNull(), "获取定时任务信息失败")
            }
        }
    }

    /**
     * 请求确认操作
     */
    fun requestConfirmation(action: String) {
        _uiState.update { it.copy(
            pendingAction = action,
            showConfirmDialog = true
        )}
    }

    /**
     * 确认执行操作
     */
    fun confirmAction() {
        val action = _uiState.value.pendingAction ?: return
        dismissConfirmDialog()

        when (action) {
            "shutdown" -> shutdown()
            "restart" -> restart()
            "sleep" -> sleep()
            "hibernate" -> hibernate()
            "lock" -> lock()
            "logout" -> logout()
        }
    }

    /**
     * 取消确认对话框
     */
    fun dismissConfirmDialog() {
        _uiState.update { it.copy(
            pendingAction = null,
            showConfirmDialog = false
        )}
    }

    /**
     * 执行电源操作的通用方法
     */
    private fun <T> executePowerAction(
        actionName: String,
        action: suspend () -> Result<T>
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = action()

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = actionName,
                    lastActionTime = System.currentTimeMillis()
                )}
            } else {
                handleError(result.exceptionOrNull(), "${actionName}操作失败")
            }
        }
    }

    /**
     * 处理错误
     */
    private fun handleError(throwable: Throwable?, defaultMessage: String) {
        val error = throwable?.message ?: defaultMessage
        Timber.e(throwable, defaultMessage)
        _uiState.update { it.copy(
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
 * 电源控制 UI 状态
 */
@Immutable
data class PowerControlUiState(
    val isExecuting: Boolean = false,
    val error: String? = null,
    val lastAction: String? = null,
    val lastActionTime: Long = 0,
    val pendingAction: String? = null,
    val showConfirmDialog: Boolean = false
)
