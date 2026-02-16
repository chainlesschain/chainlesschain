package com.chainlesschain.android.remote.ui.security

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.SecurityCommands
import com.chainlesschain.android.remote.commands.SecuritySummary
import com.chainlesschain.android.remote.commands.ActiveUser
import com.chainlesschain.android.remote.commands.LoginRecord
import com.chainlesschain.android.remote.commands.FirewallProfile
import com.chainlesschain.android.remote.commands.AntivirusProduct
import com.chainlesschain.android.remote.commands.PendingUpdate
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 安全信息 ViewModel
 *
 * 功能：
 * - 安全状态概览
 * - 活动用户
 * - 登录历史
 * - 防火墙状态
 * - 杀毒软件状态
 * - 加密状态
 * - 系统更新
 */
@HiltViewModel
class SecurityInfoViewModel @Inject constructor(
    private val securityCommands: SecurityCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(SecurityInfoUiState())
    val uiState: StateFlow<SecurityInfoUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 安全摘要
    private val _securitySummary = MutableStateFlow<SecuritySummary?>(null)
    val securitySummary: StateFlow<SecuritySummary?> = _securitySummary.asStateFlow()

    // 活动用户
    private val _activeUsers = MutableStateFlow<List<ActiveUser>>(emptyList())
    val activeUsers: StateFlow<List<ActiveUser>> = _activeUsers.asStateFlow()

    // 当前用户
    private val _currentUser = MutableStateFlow<String?>(null)
    val currentUser: StateFlow<String?> = _currentUser.asStateFlow()

    // 登录历史
    private val _loginHistory = MutableStateFlow<List<LoginRecord>>(emptyList())
    val loginHistory: StateFlow<List<LoginRecord>> = _loginHistory.asStateFlow()

    // 防火墙配置
    private val _firewallProfiles = MutableStateFlow<List<FirewallProfile>>(emptyList())
    val firewallProfiles: StateFlow<List<FirewallProfile>> = _firewallProfiles.asStateFlow()

    // 杀毒软件
    private val _antivirusProducts = MutableStateFlow<List<AntivirusProduct>>(emptyList())
    val antivirusProducts: StateFlow<List<AntivirusProduct>> = _antivirusProducts.asStateFlow()

    // 待更新
    private val _pendingUpdates = MutableStateFlow<List<PendingUpdate>>(emptyList())
    val pendingUpdates: StateFlow<List<PendingUpdate>> = _pendingUpdates.asStateFlow()

    init {
        loadSecurityStatus()
        loadActiveUsers()
    }

    /**
     * 加载安全状态
     */
    fun loadSecurityStatus() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = securityCommands.getStatus()

            if (result.isSuccess) {
                _securitySummary.value = result.getOrNull()?.security
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "加载安全状态失败")
            }
        }
    }

    /**
     * 加载活动用户
     */
    fun loadActiveUsers() {
        viewModelScope.launch {
            val result = securityCommands.getActiveUsers()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _activeUsers.value = response?.users ?: emptyList()
                _currentUser.value = response?.currentUser
            } else {
                Timber.w(result.exceptionOrNull(), "加载活动用户失败")
            }
        }
    }

    /**
     * 加载登录历史
     */
    fun loadLoginHistory(limit: Int = 50) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = securityCommands.getLoginHistory(limit)

            if (result.isSuccess) {
                _loginHistory.value = result.getOrNull()?.history ?: emptyList()
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "加载登录历史失败")
            }
        }
    }

    /**
     * 加载防火墙状态
     */
    fun loadFirewallStatus() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = securityCommands.getFirewallStatus()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _firewallProfiles.value = response?.profiles ?: emptyList()
                _uiState.update { it.copy(
                    isLoading = false,
                    firewallEnabled = response?.enabled,
                    firewallType = response?.type
                )}
            } else {
                handleError(result.exceptionOrNull(), "加载防火墙状态失败")
            }
        }
    }

    /**
     * 加载杀毒软件状态
     */
    fun loadAntivirusStatus() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = securityCommands.getAntivirusStatus()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _antivirusProducts.value = response?.products ?: emptyList()
                _uiState.update { it.copy(
                    isLoading = false,
                    antivirusInstalled = response?.installed
                )}
            } else {
                handleError(result.exceptionOrNull(), "加载杀毒软件状态失败")
            }
        }
    }

    /**
     * 加载加密状态
     */
    fun loadEncryptionStatus() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = securityCommands.getEncryptionStatus()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isLoading = false,
                    encryptionEnabled = response?.enabled,
                    encryptionType = response?.type,
                    encryptionPercentage = response?.percentage
                )}
            } else {
                handleError(result.exceptionOrNull(), "加载加密状态失败")
            }
        }
    }

    /**
     * 加载系统更新
     */
    fun loadUpdates() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = securityCommands.getUpdates()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _pendingUpdates.value = response?.updates ?: emptyList()
                _uiState.update { it.copy(
                    isLoading = false,
                    pendingUpdateCount = response?.pendingCount
                )}
            } else {
                handleError(result.exceptionOrNull(), "加载系统更新失败")
            }
        }
    }

    /**
     * 锁定工作站
     */
    fun lockWorkstation() {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null) }

            val result = securityCommands.lockWorkstation()

            if (result.isSuccess) {
                _uiState.update { it.copy(
                    isExecuting = false,
                    lastAction = "Workstation locked"
                )}
            } else {
                handleError(result.exceptionOrNull(), "锁定工作站失败")
            }
        }
    }

    /**
     * 刷新所有数据
     */
    fun refresh() {
        loadSecurityStatus()
        loadActiveUsers()
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
 * 安全信息 UI 状态
 */
@Immutable
data class SecurityInfoUiState(
    val isLoading: Boolean = false,
    val isExecuting: Boolean = false,
    val error: String? = null,
    val lastAction: String? = null,
    val firewallEnabled: Boolean? = null,
    val firewallType: String? = null,
    val antivirusInstalled: Boolean? = null,
    val encryptionEnabled: Boolean? = null,
    val encryptionType: String? = null,
    val encryptionPercentage: Int? = null,
    val pendingUpdateCount: Int? = null
)
