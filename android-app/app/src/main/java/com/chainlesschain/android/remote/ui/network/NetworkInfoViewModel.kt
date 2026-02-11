package com.chainlesschain.android.remote.ui.network

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.NetworkCommands
import com.chainlesschain.android.remote.commands.NetworkInterface
import com.chainlesschain.android.remote.commands.NetworkConnection
import com.chainlesschain.android.remote.commands.BandwidthInfo
import com.chainlesschain.android.remote.commands.WifiInfo
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 网络信息 ViewModel
 *
 * 功能：
 * - 网络状态监控
 * - 网络接口信息
 * - 活动连接
 * - 带宽使用
 * - Ping/DNS/Traceroute 工具
 */
@HiltViewModel
class NetworkInfoViewModel @Inject constructor(
    private val networkCommands: NetworkCommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(NetworkInfoUiState())
    val uiState: StateFlow<NetworkInfoUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 网络状态
    private val _networkStatus = MutableStateFlow<com.chainlesschain.android.remote.commands.NetworkStatusDetail?>(null)
    val networkStatus: StateFlow<com.chainlesschain.android.remote.commands.NetworkStatusDetail?> = _networkStatus.asStateFlow()

    // 网络接口列表
    private val _interfaces = MutableStateFlow<List<NetworkInterface>>(emptyList())
    val interfaces: StateFlow<List<NetworkInterface>> = _interfaces.asStateFlow()

    // 活动连接
    private val _connections = MutableStateFlow<List<NetworkConnection>>(emptyList())
    val connections: StateFlow<List<NetworkConnection>> = _connections.asStateFlow()

    // 带宽信息
    private val _bandwidth = MutableStateFlow<BandwidthInfo?>(null)
    val bandwidth: StateFlow<BandwidthInfo?> = _bandwidth.asStateFlow()

    // WiFi 信息
    private val _wifiInfo = MutableStateFlow<WifiInfo?>(null)
    val wifiInfo: StateFlow<WifiInfo?> = _wifiInfo.asStateFlow()

    // 公网 IP
    private val _publicIP = MutableStateFlow<String?>(null)
    val publicIP: StateFlow<String?> = _publicIP.asStateFlow()

    // 自动刷新
    private var isAutoRefreshActive = false

    init {
        loadNetworkStatus()
        loadInterfaces()
    }

    /**
     * 加载网络状态
     */
    fun loadNetworkStatus() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = networkCommands.getStatus()

            if (result.isSuccess) {
                _networkStatus.value = result.getOrNull()?.network
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "加载网络状态失败")
            }
        }
    }

    /**
     * 加载网络接口
     */
    fun loadInterfaces() {
        viewModelScope.launch {
            val result = networkCommands.getInterfaces()

            if (result.isSuccess) {
                _interfaces.value = result.getOrNull()?.interfaces ?: emptyList()
            } else {
                Timber.w(result.exceptionOrNull(), "加载网络接口失败")
            }
        }
    }

    /**
     * 加载活动连接
     */
    fun loadConnections() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val result = networkCommands.getConnections()

            if (result.isSuccess) {
                _connections.value = result.getOrNull()?.connections ?: emptyList()
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "加载连接信息失败")
            }
        }
    }

    /**
     * 加载带宽信息
     */
    fun loadBandwidth() {
        viewModelScope.launch {
            val result = networkCommands.getBandwidth()

            if (result.isSuccess) {
                _bandwidth.value = result.getOrNull()?.bandwidth
            } else {
                Timber.w(result.exceptionOrNull(), "加载带宽信息失败")
            }
        }
    }

    /**
     * 获取公网 IP
     */
    fun getPublicIP() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val result = networkCommands.getPublicIP()

            if (result.isSuccess) {
                _publicIP.value = result.getOrNull()?.ip
                _uiState.update { it.copy(isLoading = false) }
            } else {
                handleError(result.exceptionOrNull(), "获取公网IP失败")
            }
        }
    }

    /**
     * Ping 测试
     */
    fun ping(host: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null, pingResult = null) }

            val result = networkCommands.ping(host)

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isExecuting = false,
                    pingResult = if (response?.success == true) {
                        "Ping $host: ${response.time}ms (TTL: ${response.ttl})"
                    } else {
                        "Ping failed: ${response?.error ?: "Unknown error"}"
                    }
                )}
            } else {
                handleError(result.exceptionOrNull(), "Ping 失败")
            }
        }
    }

    /**
     * DNS 解析
     */
    fun resolve(hostname: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null, resolveResult = null) }

            val result = networkCommands.resolve(hostname)

            if (result.isSuccess) {
                val response = result.getOrNull()
                val addresses = response?.addresses?.joinToString(", ") ?: "N/A"
                _uiState.update { it.copy(
                    isExecuting = false,
                    resolveResult = "$hostname -> $addresses"
                )}
            } else {
                handleError(result.exceptionOrNull(), "DNS 解析失败")
            }
        }
    }

    /**
     * 路由追踪
     */
    fun traceroute(host: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null, tracerouteResult = null) }

            val result = networkCommands.traceroute(host)

            if (result.isSuccess) {
                val response = result.getOrNull()
                val hops = response?.hops?.mapIndexed { index, hop ->
                    "${index + 1}. ${hop.address ?: "*"} (${hop.time}ms)"
                }?.joinToString("\n") ?: "No data"
                _uiState.update { it.copy(
                    isExecuting = false,
                    tracerouteResult = hops
                )}
            } else {
                handleError(result.exceptionOrNull(), "路由追踪失败")
            }
        }
    }

    /**
     * 获取 WiFi 信息
     */
    fun getWifiInfo() {
        viewModelScope.launch {
            val result = networkCommands.getWifi()

            if (result.isSuccess) {
                _wifiInfo.value = result.getOrNull()?.wifi
            } else {
                Timber.w(result.exceptionOrNull(), "获取WiFi信息失败")
            }
        }
    }

    /**
     * 速度测试
     */
    fun speedTest() {
        viewModelScope.launch {
            _uiState.update { it.copy(isExecuting = true, error = null, speedTestResult = null) }

            val result = networkCommands.getSpeed()

            if (result.isSuccess) {
                val response = result.getOrNull()
                _uiState.update { it.copy(
                    isExecuting = false,
                    speedTestResult = "Download: ${response?.downloadFormatted ?: "N/A"}, Upload: ${response?.uploadFormatted ?: "N/A"}, Ping: ${response?.ping ?: 0}ms"
                )}
            } else {
                handleError(result.exceptionOrNull(), "速度测试失败")
            }
        }
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
                loadNetworkStatus()
                loadBandwidth()
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
     * 刷新所有数据
     */
    fun refresh() {
        loadNetworkStatus()
        loadInterfaces()
        loadBandwidth()
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
 * 网络信息 UI 状态
 */
data class NetworkInfoUiState(
    val isLoading: Boolean = false,
    val isExecuting: Boolean = false,
    val error: String? = null,
    val isAutoRefreshEnabled: Boolean = false,
    val pingResult: String? = null,
    val resolveResult: String? = null,
    val tracerouteResult: String? = null,
    val speedTestResult: String? = null
)
