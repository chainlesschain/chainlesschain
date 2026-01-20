package com.chainlesschain.android.core.p2p

import android.util.Log
import com.chainlesschain.android.core.p2p.connection.AutoReconnectManager
import com.chainlesschain.android.core.p2p.connection.HeartbeatManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.model.P2PDevice
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.network.NetworkEvent
import com.chainlesschain.android.core.p2p.network.NetworkMonitor
import com.chainlesschain.android.core.p2p.network.NetworkState
import com.chainlesschain.android.core.p2p.network.NetworkType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * P2P 网络协调器
 *
 * 统一管理 P2P 网络的所有组件，提供：
 * - 网络状态感知的连接管理
 * - 智能重连策略（基于网络类型）
 * - 统一的 P2P 网络状态
 * - 简化的 API 接口
 */
@Singleton
class P2PNetworkCoordinator @Inject constructor(
    private val connectionManager: P2PConnectionManager,
    private val networkMonitor: NetworkMonitor,
    private val heartbeatManager: HeartbeatManager,
    private val autoReconnectManager: AutoReconnectManager
) {

    companion object {
        private const val TAG = "P2PNetworkCoordinator"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // P2P 网络综合状态
    private val _p2pNetworkState = MutableStateFlow<P2PNetworkState>(P2PNetworkState.Initializing)
    val p2pNetworkState: StateFlow<P2PNetworkState> = _p2pNetworkState.asStateFlow()

    // P2P 网络统计
    private val _statistics = MutableStateFlow(P2PStatistics())
    val statistics: StateFlow<P2PStatistics> = _statistics.asStateFlow()

    // 本地设备信息
    private var localDevice: P2PDevice? = null

    // 是否已初始化
    private var isInitialized = false

    /**
     * 初始化 P2P 网络
     *
     * @param device 本地设备信息
     */
    fun initialize(device: P2PDevice) {
        if (isInitialized) {
            Log.w(TAG, "Already initialized")
            return
        }

        localDevice = device
        isInitialized = true

        // 启动网络监控
        networkMonitor.startMonitoring()

        // 监听网络状态变化
        observeNetworkChanges()

        // 监听连接状态变化
        observeConnectionChanges()

        // 初始化连接管理器
        connectionManager.initialize(device)

        updateState(P2PNetworkState.Ready)

        Log.i(TAG, "P2P Network Coordinator initialized for device: ${device.deviceName}")
    }

    /**
     * 连接到设备
     *
     * @param device 目标设备
     * @return 是否成功发起连接
     */
    suspend fun connectToDevice(device: P2PDevice): Boolean {
        if (!isInitialized) {
            Log.e(TAG, "Not initialized")
            return false
        }

        if (!networkMonitor.isNetworkAvailable()) {
            Log.w(TAG, "No network available")
            updateState(P2PNetworkState.NoNetwork)
            return false
        }

        // 检查是否为 P2P 友好网络
        if (!networkMonitor.isP2PCapableNetwork()) {
            Log.w(TAG, "Network not suitable for local P2P (using cellular)")
            // 仍然允许连接，但记录警告
        }

        return try {
            connectionManager.connectToDevice(device)
            updateStatistics { it.copy(connectionAttempts = it.connectionAttempts + 1) }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect to device", e)
            updateStatistics { it.copy(connectionFailures = it.connectionFailures + 1) }
            false
        }
    }

    /**
     * 断开设备连接
     *
     * @param deviceId 设备ID
     * @param permanent 是否永久断开（不自动重连）
     */
    suspend fun disconnectDevice(deviceId: String, permanent: Boolean = true) {
        connectionManager.disconnectDevice(deviceId, permanent)
    }

    /**
     * 发送消息
     *
     * @param deviceId 目标设备ID
     * @param message 消息内容
     * @return 是否成功发送
     */
    suspend fun sendMessage(deviceId: String, message: P2PMessage): Boolean {
        if (!networkMonitor.isNetworkAvailable()) {
            Log.w(TAG, "No network, message will be queued")
            // 消息将被离线队列处理
            return false
        }

        return try {
            connectionManager.sendMessage(deviceId, message)
            updateStatistics { it.copy(messagesSent = it.messagesSent + 1) }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message", e)
            false
        }
    }

    /**
     * 广播消息到所有连接的设备
     *
     * @param message 消息内容
     */
    suspend fun broadcastMessage(message: P2PMessage) {
        connectionManager.broadcastMessage(message)
    }

    /**
     * 获取已连接设备列表
     */
    fun getConnectedDevices(): StateFlow<List<P2PDevice>> {
        return connectionManager.connectedDevices
    }

    /**
     * 获取接收到的消息流
     */
    fun getReceivedMessages(): Flow<P2PMessage> {
        return connectionManager.receivedMessages
    }

    /**
     * 检查设备是否活跃
     */
    fun isDeviceActive(deviceId: String): Boolean {
        return heartbeatManager.isDeviceActive(deviceId)
    }

    /**
     * 获取设备最后活跃时间
     */
    fun getDeviceLastActiveTime(deviceId: String): Long? {
        return heartbeatManager.getLastActiveTime(deviceId)
    }

    /**
     * 获取待重连设备数量
     */
    fun getPendingReconnectCount(): Int {
        return autoReconnectManager.getPendingReconnectCount()
    }

    /**
     * 获取当前网络类型
     */
    fun getCurrentNetworkType(): NetworkType {
        return networkMonitor.getCurrentNetworkType()
    }

    /**
     * 检查网络是否计量（移动数据）
     */
    fun isMeteredNetwork(): Boolean {
        return networkMonitor.isMeteredNetwork()
    }

    /**
     * 手动触发所有设备重连
     */
    fun triggerReconnectAll() {
        if (!networkMonitor.isNetworkAvailable()) {
            Log.w(TAG, "No network, cannot reconnect")
            return
        }

        autoReconnectManager.resume()
        Log.i(TAG, "Triggered reconnect for all pending devices")
    }

    /**
     * 暂停所有自动重连
     */
    fun pauseAutoReconnect() {
        autoReconnectManager.pause()
        connectionManager.pauseAutoReconnect()
    }

    /**
     * 恢复自动重连
     */
    fun resumeAutoReconnect() {
        if (networkMonitor.isNetworkAvailable()) {
            autoReconnectManager.resume()
            connectionManager.resumeAutoReconnect()
        }
    }

    /**
     * 关闭 P2P 网络
     */
    fun shutdown() {
        Log.i(TAG, "Shutting down P2P network")

        updateState(P2PNetworkState.ShuttingDown)

        networkMonitor.stopMonitoring()
        connectionManager.shutdown()

        isInitialized = false
        localDevice = null

        updateState(P2PNetworkState.Shutdown)
    }

    /**
     * 监听网络状态变化
     */
    private fun observeNetworkChanges() {
        scope.launch {
            networkMonitor.networkEvents.collect { event ->
                handleNetworkEvent(event)
            }
        }

        scope.launch {
            networkMonitor.networkState.collect { state ->
                handleNetworkState(state)
            }
        }
    }

    /**
     * 处理网络事件
     */
    private fun handleNetworkEvent(event: NetworkEvent) {
        when (event) {
            is NetworkEvent.Available -> {
                Log.i(TAG, "Network available: ${event.networkInfo.type}")

                // 恢复自动重连
                if (isInitialized) {
                    autoReconnectManager.resume()
                    connectionManager.resumeAutoReconnect()
                }

                updateState(P2PNetworkState.Ready)
                updateStatistics { it.copy(networkChanges = it.networkChanges + 1) }
            }

            is NetworkEvent.Lost -> {
                Log.w(TAG, "Network lost")

                // 暂停自动重连
                autoReconnectManager.pause()
                connectionManager.pauseAutoReconnect()

                updateState(P2PNetworkState.NoNetwork)
            }

            is NetworkEvent.Unavailable -> {
                Log.w(TAG, "Network unavailable")
                updateState(P2PNetworkState.NoNetwork)
            }

            is NetworkEvent.TypeChanged -> {
                Log.i(TAG, "Network type changed: ${event.oldType} -> ${event.newType}")
                updateStatistics { it.copy(networkChanges = it.networkChanges + 1) }
            }
        }
    }

    /**
     * 处理网络状态
     */
    private fun handleNetworkState(state: NetworkState) {
        when (state) {
            is NetworkState.Connected -> {
                if (_p2pNetworkState.value == P2PNetworkState.NoNetwork) {
                    updateState(P2PNetworkState.Ready)
                }
            }

            is NetworkState.Disconnected,
            is NetworkState.Unavailable -> {
                updateState(P2PNetworkState.NoNetwork)
            }

            is NetworkState.Unknown -> {
                // 等待网络状态确定
            }
        }
    }

    /**
     * 监听连接状态变化
     */
    private fun observeConnectionChanges() {
        scope.launch {
            connectionManager.connectedDevices.collect { devices ->
                updateStatistics { it.copy(connectedDevices = devices.size) }

                if (devices.isNotEmpty() && _p2pNetworkState.value == P2PNetworkState.Ready) {
                    updateState(P2PNetworkState.Connected(devices.size))
                } else if (devices.isEmpty() && _p2pNetworkState.value is P2PNetworkState.Connected) {
                    updateState(P2PNetworkState.Ready)
                }
            }
        }

        scope.launch {
            connectionManager.receivedMessages.collect {
                updateStatistics { it.copy(messagesReceived = it.messagesReceived + 1) }
            }
        }
    }

    /**
     * 更新状态
     */
    private fun updateState(state: P2PNetworkState) {
        _p2pNetworkState.value = state
        Log.d(TAG, "P2P Network state: $state")
    }

    /**
     * 更新统计
     */
    private fun updateStatistics(update: (P2PStatistics) -> P2PStatistics) {
        _statistics.value = update(_statistics.value)
    }
}

/**
 * P2P 网络状态
 */
sealed class P2PNetworkState {
    /** 初始化中 */
    data object Initializing : P2PNetworkState()

    /** 就绪（可连接） */
    data object Ready : P2PNetworkState()

    /** 无网络 */
    data object NoNetwork : P2PNetworkState()

    /** 已连接设备 */
    data class Connected(val deviceCount: Int) : P2PNetworkState()

    /** 正在关闭 */
    data object ShuttingDown : P2PNetworkState()

    /** 已关闭 */
    data object Shutdown : P2PNetworkState()
}

/**
 * P2P 网络统计
 */
data class P2PStatistics(
    /** 已连接设备数 */
    val connectedDevices: Int = 0,

    /** 发送消息数 */
    val messagesSent: Long = 0,

    /** 接收消息数 */
    val messagesReceived: Long = 0,

    /** 连接尝试次数 */
    val connectionAttempts: Int = 0,

    /** 连接失败次数 */
    val connectionFailures: Int = 0,

    /** 网络变化次数 */
    val networkChanges: Int = 0
)
