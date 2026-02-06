package com.chainlesschain.android.core.p2p.connection

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.p2p.discovery.DeviceDiscovery
import com.chainlesschain.android.core.p2p.ice.IceServerConfig
import com.chainlesschain.android.core.p2p.model.ConnectionStatus
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PDevice
import com.chainlesschain.android.core.p2p.model.P2PMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import javax.inject.Inject
import javax.inject.Singleton

/**
 * P2P连接管理器
 *
 * 协调设备发现、信令交换和WebRTC连接建立的整个流程
 * 支持心跳检测和自动重连
 */
@Singleton
class P2PConnectionManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val deviceDiscovery: DeviceDiscovery,
    private val signalingClient: SignalingClient,
    private val heartbeatManager: HeartbeatManager,
    private val autoReconnectManager: AutoReconnectManager,
    private val iceServerConfig: IceServerConfig
) {

    companion object {
        private const val TAG = "P2PConnectionManager"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // WebRTC连接池（每个设备一个连接）
    private val connections = mutableMapOf<String, WebRTCPeerConnection>()

    // 当前设备信息
    private var localDevice: P2PDevice? = null

    // 连接状态流
    private val _connectedDevices = MutableStateFlow<List<P2PDevice>>(emptyList())
    val connectedDevices: StateFlow<List<P2PDevice>> = _connectedDevices.asStateFlow()

    // 接收到的消息流
    private val _receivedMessages = MutableSharedFlow<P2PMessage>()
    val receivedMessages: Flow<P2PMessage> = _receivedMessages.asSharedFlow()

    // 连接超时事件
    val connectionTimeoutEvents: SharedFlow<ConnectionTimeoutEvent> = heartbeatManager.connectionTimeoutEvents

    // 重连状态事件
    val reconnectStatusEvents: SharedFlow<ReconnectStatusEvent> = autoReconnectManager.reconnectStatusEvents

    init {
        // 监听信令消息
        scope.launch {
            signalingClient.signalingMessages.collect { message ->
                handleSignalingMessage(message)
            }
        }

        // 监听连接超时事件
        scope.launch {
            heartbeatManager.connectionTimeoutEvents.collect { event ->
                handleConnectionTimeout(event)
            }
        }

        // 启动信令服务器
        signalingClient.startServer()
    }

    /**
     * 初始化P2P网络
     *
     * @param device 本地设备信息
     */
    fun initialize(device: P2PDevice) {
        localDevice = device
        Log.i(TAG, "P2P network initialized for device: ${device.deviceName}")

        // 初始化心跳管理器
        heartbeatManager.start(device.deviceId) { deviceId, message ->
            sendHeartbeat(deviceId, message)
        }

        // 初始化自动重连管理器
        autoReconnectManager.start { targetDevice ->
            reconnectToDevice(targetDevice)
        }

        // 注册本地服务
        deviceDiscovery.registerService(device)

        // 开始发现设备
        deviceDiscovery.startDiscovery()
    }

    /**
     * 发送心跳消息
     */
    private suspend fun sendHeartbeat(deviceId: String, message: P2PMessage) {
        try {
            connections[deviceId]?.let { connection ->
                if (connection.isConnected()) {
                    connection.sendMessage(message)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send heartbeat to $deviceId", e)
        }
    }

    /**
     * 重连到设备
     */
    private suspend fun reconnectToDevice(device: P2PDevice) {
        Log.i(TAG, "Attempting to reconnect to: ${device.deviceName}")

        // 先断开旧连接
        connections[device.deviceId]?.let { oldConnection ->
            try {
                oldConnection.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "Error disconnecting old connection", e)
            }
            connections.remove(device.deviceId)
        }

        // 建立新连接
        connectToDevice(device)
    }

    /**
     * 处理连接超时事件
     */
    private fun handleConnectionTimeout(event: ConnectionTimeoutEvent) {
        Log.w(TAG, "Connection timeout for device: ${event.deviceId}, will retry: ${event.willRetry}")

        if (!event.willRetry) {
            // 最终断开连接
            removeConnectedDevice(event.deviceId)
            connections.remove(event.deviceId)
        }
    }

    /**
     * 连接到设备
     *
     * @param device 目标设备
     */
    suspend fun connectToDevice(device: P2PDevice) {
        if (connections.containsKey(device.deviceId)) {
            Log.w(TAG, "Already connected to device: ${device.deviceName}")
            return
        }

        Log.i(TAG, "Connecting to device: ${device.deviceName}")

        try {
            // 创建WebRTC连接
            val connection = WebRTCPeerConnection(context, iceServerConfig)

            // 设置信令回调
            connection.onOfferCreated = { offer ->
                scope.launch {
                    signalingClient.sendMessage(
                        SignalingMessage.Offer(
                            fromDeviceId = localDevice?.deviceId ?: "",
                            sessionDescription = offer
                        )
                    )
                }
            }

            connection.onAnswerCreated = { answer ->
                scope.launch {
                    signalingClient.sendMessage(
                        SignalingMessage.Answer(
                            fromDeviceId = localDevice?.deviceId ?: "",
                            sessionDescription = answer
                        )
                    )
                }
            }

            connection.onIceCandidateFound = { candidate ->
                scope.launch {
                    signalingClient.sendMessage(
                        SignalingMessage.Candidate(
                            fromDeviceId = localDevice?.deviceId ?: "",
                            iceCandidate = candidate
                        )
                    )
                }
            }

            // 监听连接状态
            scope.launch {
                connection.observeConnectionState().collect { state ->
                    when (state) {
                        is ConnectionState.Connected -> {
                            val connectedDevice = device.copy(status = ConnectionStatus.CONNECTED)
                            addConnectedDevice(connectedDevice)

                            // 注册心跳监控
                            heartbeatManager.registerDevice(device.deviceId)

                            // 缓存设备信息用于重连
                            autoReconnectManager.cacheDevice(connectedDevice)

                            // 重置重连计数
                            heartbeatManager.resetReconnectAttempts(device.deviceId)

                            Log.i(TAG, "Connected to device: ${device.deviceName}")
                        }
                        is ConnectionState.Disconnected -> {
                            handleDeviceDisconnection(device.deviceId, device.deviceName, ReconnectReason.CONNECTION_LOST)
                        }
                        is ConnectionState.Failed -> {
                            handleDeviceDisconnection(device.deviceId, device.deviceName, ReconnectReason.ICE_FAILED)
                            Log.e(TAG, "Connection failed: ${state.error}")
                        }
                        else -> {}
                    }
                }
            }

            // 监听接收消息
            scope.launch {
                connection.observeMessages().filterNotNull().collect { message ->
                    // 检查是否为心跳消息
                    if (heartbeatManager.handleHeartbeatMessage(message)) {
                        // 心跳消息已处理，不需要转发
                        return@collect
                    }
                    _receivedMessages.emit(message)
                }
            }

            connections[device.deviceId] = connection

            // 连接到信令服务器
            device.address?.let { address ->
                val host = address.substringBefore(":")
                signalingClient.connectToServer(host)
            }

            // 开始WebRTC连接
            connection.connect(device)

        } catch (e: Exception) {
            Log.e(TAG, "Failed to connect to device", e)
        }
    }

    /**
     * 处理设备断开连接
     */
    private fun handleDeviceDisconnection(
        deviceId: String,
        deviceName: String,
        reason: ReconnectReason
    ) {
        removeConnectedDevice(deviceId)
        connections.remove(deviceId)

        // 如果可以重连，安排重连任务
        if (heartbeatManager.canRetryReconnect(deviceId)) {
            val attempt = heartbeatManager.incrementReconnectAttempts(deviceId)
            val delay = heartbeatManager.calculateReconnectDelay(deviceId)
            autoReconnectManager.scheduleReconnect(deviceId, delay, reason)
            Log.i(TAG, "Disconnected from $deviceName, will retry in ${delay}ms (attempt $attempt)")
        } else {
            // 达到最大重连次数，清理资源
            heartbeatManager.unregisterDevice(deviceId)
            autoReconnectManager.removeDeviceCache(deviceId)
            Log.i(TAG, "Disconnected from $deviceName, max retries reached")
        }
    }

    /**
     * 断开设备连接
     *
     * @param deviceId 设备ID
     * @param permanent 是否永久断开（不尝试重连）
     */
    suspend fun disconnectDevice(deviceId: String, permanent: Boolean = true) {
        connections[deviceId]?.let { connection ->
            connection.disconnect()
            connections.remove(deviceId)
            removeConnectedDevice(deviceId)

            if (permanent) {
                // 永久断开，不重连
                heartbeatManager.unregisterDevice(deviceId)
                autoReconnectManager.cancelReconnect(deviceId)
                autoReconnectManager.removeDeviceCache(deviceId)
            }

            Log.i(TAG, "Disconnected device: $deviceId (permanent: $permanent)")
        }
    }

    /**
     * 发送消息到设备
     *
     * @param deviceId 目标设备ID
     * @param message 消息内容
     */
    suspend fun sendMessage(deviceId: String, message: P2PMessage) {
        connections[deviceId]?.let { connection ->
            connection.sendMessage(message)
        } ?: run {
            Log.w(TAG, "No connection to device: $deviceId")
        }
    }

    /**
     * 广播消息到所有连接的设备
     *
     * @param message 消息内容
     */
    suspend fun broadcastMessage(message: P2PMessage) {
        connections.values.forEach { connection ->
            try {
                connection.sendMessage(message)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send message", e)
            }
        }
    }

    /**
     * 处理信令消息
     */
    private fun handleSignalingMessage(message: SignalingMessage) {
        when (message) {
            is SignalingMessage.Offer -> {
                Log.d(TAG, "Received offer from: ${message.fromDeviceId}")
                connections[message.fromDeviceId]?.handleOffer(message.sessionDescription)
            }
            is SignalingMessage.Answer -> {
                Log.d(TAG, "Received answer from: ${message.fromDeviceId}")
                connections[message.fromDeviceId]?.handleAnswer(message.sessionDescription)
            }
            is SignalingMessage.Candidate -> {
                Log.d(TAG, "Received ICE candidate from: ${message.fromDeviceId}")
                connections[message.fromDeviceId]?.addIceCandidate(message.iceCandidate)
            }
            is SignalingMessage.Heartbeat -> {
                Log.v(TAG, "Received heartbeat: ${message.id}")
                // 心跳由 HeartbeatManager 处理
            }
            is SignalingMessage.HeartbeatAck -> {
                Log.v(TAG, "Received heartbeat ack: ${message.id}")
                // 心跳响应由 HeartbeatManager 处理
            }
            is SignalingMessage.Close -> {
                Log.d(TAG, "Received close from: ${message.fromDeviceId}, reason: ${message.reason}")
                scope.launch {
                    disconnectDevice(message.fromDeviceId)
                }
            }
            is SignalingMessage.MessageAck -> {
                Log.v(TAG, "Received message ack for: ${message.ackMessageId}")
                // ACK 由传输层处理
            }
            is SignalingMessage.MessageNack -> {
                Log.w(TAG, "Received message nack for: ${message.nackMessageId}, reason: ${message.reason}")
                // NACK 由传输层处理
            }
        }
    }

    /**
     * 添加已连接设备
     */
    private fun addConnectedDevice(device: P2PDevice) {
        val current = _connectedDevices.value.toMutableList()
        val index = current.indexOfFirst { it.deviceId == device.deviceId }

        if (index >= 0) {
            current[index] = device
        } else {
            current.add(device)
        }

        _connectedDevices.value = current
    }

    /**
     * 移除已连接设备
     */
    private fun removeConnectedDevice(deviceId: String) {
        _connectedDevices.value = _connectedDevices.value.filter { it.deviceId != deviceId }
    }

    /**
     * 获取所有连接
     */
    fun getAllConnections(): Map<String, WebRTCPeerConnection> {
        return connections.toMap()
    }

    /**
     * 暂停自动重连
     */
    fun pauseAutoReconnect() {
        autoReconnectManager.pause()
    }

    /**
     * 恢复自动重连
     */
    fun resumeAutoReconnect() {
        autoReconnectManager.resume()
    }

    /**
     * 获取设备活跃状态
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
     * 关闭所有连接
     */
    fun shutdown() {
        scope.cancel()

        // 停止心跳和自动重连
        heartbeatManager.release()
        autoReconnectManager.release()

        connections.values.forEach { it.release() }
        connections.clear()

        deviceDiscovery.stopDiscovery()
        deviceDiscovery.unregisterService()

        signalingClient.stopServer()
        signalingClient.disconnect()

        Log.i(TAG, "P2P network shutdown")
    }
}
