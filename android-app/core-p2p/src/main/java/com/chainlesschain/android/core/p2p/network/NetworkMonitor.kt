package com.chainlesschain.android.core.p2p.network

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import timber.log.Timber
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 网络状态监听器
 *
 * 使用 ConnectivityManager 监听网络变化，提供：
 * - 网络可用性检测
 * - 网络类型识别（WiFi/Cellular/Ethernet）
 * - 网络变化事件流
 * - P2P 连接适配性检测
 */
@Singleton
class NetworkMonitor @Inject constructor(
    @ApplicationContext private val context: Context
) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val connectivityManager by lazy {
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: error("ConnectivityManager system service unavailable")
    }

    // 当前网络状态
    private val _networkState = MutableStateFlow<NetworkState>(NetworkState.Unknown)
    val networkState: StateFlow<NetworkState> = _networkState.asStateFlow()

    // 网络变化事件
    private val _networkEvents = MutableSharedFlow<NetworkEvent>()
    val networkEvents: SharedFlow<NetworkEvent> = _networkEvents.asSharedFlow()

    // 是否已注册回调
    private var isRegistered = false

    // 网络回调
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            Timber.i("Network available: $network")
            updateNetworkState(network)
            emitEvent(NetworkEvent.Available(getNetworkInfo(network)))
        }

        override fun onLost(network: Network) {
            Timber.i("Network lost: $network")
            _networkState.value = NetworkState.Disconnected
            emitEvent(NetworkEvent.Lost)
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities
        ) {
            Timber.d("Network capabilities changed")
            updateNetworkState(network)
        }

        override fun onUnavailable() {
            Timber.w("Network unavailable")
            _networkState.value = NetworkState.Unavailable
            emitEvent(NetworkEvent.Unavailable)
        }
    }

    /**
     * 开始监听网络状态
     */
    @SuppressLint("MissingPermission")
    fun startMonitoring() {
        if (isRegistered) {
            Timber.w("Already monitoring network")
            return
        }

        try {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
                .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
                .build()

            connectivityManager.registerNetworkCallback(request, networkCallback)
            isRegistered = true

            // 获取初始状态
            checkCurrentNetwork()

            Timber.i("Network monitoring started")
        } catch (e: Exception) {
            Timber.e(e, "Failed to start network monitoring")
        }
    }

    /**
     * 停止监听网络状态
     */
    fun stopMonitoring() {
        if (!isRegistered) return

        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
            isRegistered = false
            Timber.i("Network monitoring stopped")
        } catch (e: Exception) {
            Timber.e(e, "Failed to stop network monitoring")
        }
    }

    /**
     * 检查当前网络状态
     */
    @SuppressLint("MissingPermission")
    fun checkCurrentNetwork() {
        val activeNetwork = connectivityManager.activeNetwork
        if (activeNetwork != null) {
            updateNetworkState(activeNetwork)
        } else {
            _networkState.value = NetworkState.Disconnected
        }
    }

    /**
     * 检查网络是否可用
     */
    fun isNetworkAvailable(): Boolean {
        return when (_networkState.value) {
            is NetworkState.Connected -> true
            else -> false
        }
    }

    /**
     * 检查是否有适合 P2P 的网络
     *
     * WiFi 和 Ethernet 最适合 P2P 连接（局域网发现）
     * Cellular 可以用于互联网中继
     */
    fun isP2PCapableNetwork(): Boolean {
        val state = _networkState.value
        return state is NetworkState.Connected &&
                (state.networkInfo.type == NetworkType.WIFI ||
                        state.networkInfo.type == NetworkType.ETHERNET)
    }

    /**
     * 检查是否为计量网络（移动数据）
     */
    fun isMeteredNetwork(): Boolean {
        val state = _networkState.value
        return state is NetworkState.Connected && state.networkInfo.isMetered
    }

    /**
     * 获取当前网络类型
     */
    fun getCurrentNetworkType(): NetworkType {
        return when (val state = _networkState.value) {
            is NetworkState.Connected -> state.networkInfo.type
            else -> NetworkType.NONE
        }
    }

    /**
     * 获取网络信息
     */
    @SuppressLint("MissingPermission")
    private fun getNetworkInfo(network: Network): NetworkInfo {
        val capabilities = connectivityManager.getNetworkCapabilities(network)

        val type = when {
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> NetworkType.WIFI
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> NetworkType.CELLULAR
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> NetworkType.ETHERNET
            else -> NetworkType.OTHER
        }

        val isMetered = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) != true

        val hasInternet = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

        val linkDownstreamBandwidthKbps = capabilities?.linkDownstreamBandwidthKbps ?: 0
        val linkUpstreamBandwidthKbps = capabilities?.linkUpstreamBandwidthKbps ?: 0

        return NetworkInfo(
            type = type,
            isMetered = isMetered,
            hasInternet = hasInternet,
            downstreamBandwidthKbps = linkDownstreamBandwidthKbps,
            upstreamBandwidthKbps = linkUpstreamBandwidthKbps
        )
    }

    /**
     * 更新网络状态
     */
    private fun updateNetworkState(network: Network) {
        val info = getNetworkInfo(network)
        _networkState.value = NetworkState.Connected(info)
        Timber.d("Network state updated: $info")
    }

    /**
     * 发送网络事件
     */
    private fun emitEvent(event: NetworkEvent) {
        scope.launch {
            _networkEvents.emit(event)
        }
    }

    /**
     * 释放资源
     */
    fun release() {
        stopMonitoring()
    }
}

/**
 * 网络状态
 */
sealed class NetworkState {
    /** 未知状态（初始化中） */
    data object Unknown : NetworkState()

    /** 已连接 */
    data class Connected(val networkInfo: NetworkInfo) : NetworkState()

    /** 已断开 */
    data object Disconnected : NetworkState()

    /** 不可用 */
    data object Unavailable : NetworkState()
}

/**
 * 网络信息
 */
data class NetworkInfo(
    /** 网络类型 */
    val type: NetworkType,

    /** 是否计量网络 */
    val isMetered: Boolean,

    /** 是否有互联网访问 */
    val hasInternet: Boolean,

    /** 下行带宽 (Kbps) */
    val downstreamBandwidthKbps: Int,

    /** 上行带宽 (Kbps) */
    val upstreamBandwidthKbps: Int
)

/**
 * 网络类型
 */
enum class NetworkType {
    /** 无网络 */
    NONE,

    /** WiFi */
    WIFI,

    /** 移动数据 */
    CELLULAR,

    /** 以太网 */
    ETHERNET,

    /** 其他 */
    OTHER
}

/**
 * 网络事件
 */
sealed class NetworkEvent {
    /** 网络可用 */
    data class Available(val networkInfo: NetworkInfo) : NetworkEvent()

    /** 网络丢失 */
    data object Lost : NetworkEvent()

    /** 网络不可用 */
    data object Unavailable : NetworkEvent()

    /** 网络类型变化 */
    data class TypeChanged(val oldType: NetworkType, val newType: NetworkType) : NetworkEvent()
}
