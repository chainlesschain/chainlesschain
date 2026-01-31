package com.chainlesschain.android.remote.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.SystemCommands
import com.chainlesschain.android.remote.commands.SystemStatus
import com.chainlesschain.android.remote.commands.SystemInfo
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PeerInfo
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 远程控制界面 ViewModel
 *
 * 功能：
 * - PC 设备连接管理
 * - 系统状态监控
 * - 命令快捷入口
 */
@HiltViewModel
class RemoteControlViewModel @Inject constructor(
    private val p2pClient: P2PClient,
    private val commandClient: RemoteCommandClient,
    private val aiCommands: AICommands,
    private val systemCommands: SystemCommands
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(RemoteControlUiState())
    val uiState: StateFlow<RemoteControlUiState> = _uiState.asStateFlow()

    // 连接状态（从 P2PClient）
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 已连接的节点
    val connectedPeer: StateFlow<PeerInfo?> = p2pClient.connectedPeer

    init {
        // 监听连接状态变化
        observeConnectionState()

        // 自动刷新系统状态（如果已连接）
        startAutoRefreshStatus()
    }

    /**
     * 监听连接状态变化
     */
    private fun observeConnectionState() {
        viewModelScope.launch {
            connectionState.collect { state ->
                when (state) {
                    ConnectionState.CONNECTED -> {
                        // 连接成功，立即获取系统信息和状态
                        refreshSystemInfo()
                        refreshSystemStatus()
                    }
                    ConnectionState.DISCONNECTED, ConnectionState.ERROR -> {
                        // 连接断开，清空状态
                        _uiState.update { it.copy(
                            systemStatus = null,
                            systemInfo = null
                        )}
                    }
                    else -> {}
                }
            }
        }
    }

    /**
     * 自动刷新系统状态（每 10 秒）
     */
    private fun startAutoRefreshStatus() {
        viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(10000)  // 10 秒
                if (connectionState.value == ConnectionState.CONNECTED) {
                    refreshSystemStatus()
                }
            }
        }
    }

    /**
     * 连接到 PC
     */
    fun connectToPC(pcPeerId: String, pcDID: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = p2pClient.connect(pcPeerId, pcDID)

            if (result.isSuccess) {
                Timber.d("连接成功")
                _uiState.update { it.copy(isLoading = false) }
            } else {
                Timber.e(result.exceptionOrNull(), "连接失败")
                _uiState.update { it.copy(
                    isLoading = false,
                    error = result.exceptionOrNull()?.message ?: "连接失败"
                )}
            }
        }
    }

    /**
     * 断开连接
     */
    fun disconnect() {
        viewModelScope.launch {
            p2pClient.disconnect()
            _uiState.update { it.copy(
                systemStatus = null,
                systemInfo = null,
                error = null
            )}
        }
    }

    /**
     * 刷新系统状态
     */
    fun refreshSystemStatus() {
        viewModelScope.launch {
            val result = systemCommands.getStatus()

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    systemStatus = result.getOrNull(),
                    lastRefreshTime = System.currentTimeMillis()
                )}
            } else {
                Timber.e(result.exceptionOrNull(), "获取系统状态失败")
            }
        }
    }

    /**
     * 刷新系统信息
     */
    fun refreshSystemInfo() {
        viewModelScope.launch {
            val result = systemCommands.getInfo()

            if (result.isSuccess) {
                _uiState.update { it.copy(systemInfo = result.getOrNull()) }
            } else {
                Timber.e(result.exceptionOrNull(), "获取系统信息失败")
            }
        }
    }

    /**
     * 截图
     */
    fun takeScreenshot(onSuccess: (String) -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val result = systemCommands.screenshot()

            _uiState.update { it.copy(isLoading = false) }

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    onSuccess(response.data)  // Base64 图片数据
                }
            } else {
                onError(result.exceptionOrNull()?.message ?: "截图失败")
            }
        }
    }

    /**
     * 发送通知
     */
    fun sendNotification(
        title: String,
        body: String,
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val result = systemCommands.notify(title, body)

            _uiState.update { it.copy(isLoading = false) }

            if (result.isSuccess) {
                onSuccess()
            } else {
                onError(result.exceptionOrNull()?.message ?: "发送通知失败")
            }
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

/**
 * UI 状态
 */
data class RemoteControlUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val systemStatus: SystemStatus? = null,
    val systemInfo: SystemInfo? = null,
    val lastRefreshTime: Long = 0
)
