package com.chainlesschain.android.core.p2p.connection

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.p2p.discovery.DeviceDiscovery
import com.chainlesschain.android.core.p2p.model.ConnectionStatus
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
 */
@Singleton
class P2PConnectionManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val deviceDiscovery: DeviceDiscovery,
    private val signalingClient: SignalingClient
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

    init {
        // 监听信令消息
        scope.launch {
            signalingClient.signalingMessages.collect { message ->
                handleSignalingMessage(message)
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

        // 注册本地服务
        deviceDiscovery.registerService(device)

        // 开始发现设备
        deviceDiscovery.startDiscovery()
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
            val connection = WebRTCPeerConnection(context)

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
                            addConnectedDevice(device.copy(status = ConnectionStatus.CONNECTED))
                            Log.i(TAG, "Connected to device: ${device.deviceName}")
                        }
                        is ConnectionState.Disconnected -> {
                            removeConnectedDevice(device.deviceId)
                            connections.remove(device.deviceId)
                            Log.i(TAG, "Disconnected from device: ${device.deviceName}")
                        }
                        is ConnectionState.Failed -> {
                            removeConnectedDevice(device.deviceId)
                            connections.remove(device.deviceId)
                            Log.e(TAG, "Connection failed: ${state.error}")
                        }
                        else -> {}
                    }
                }
            }

            // 监听接收消息
            scope.launch {
                connection.observeMessages().filterNotNull().collect { message ->
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
     * 断开设备连接
     *
     * @param deviceId 设备ID
     */
    suspend fun disconnectDevice(deviceId: String) {
        connections[deviceId]?.let { connection ->
            connection.disconnect()
            connections.remove(deviceId)
            removeConnectedDevice(deviceId)
            Log.i(TAG, "Disconnected device: $deviceId")
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
     * 关闭所有连接
     */
    fun shutdown() {
        scope.cancel()

        connections.values.forEach { it.release() }
        connections.clear()

        deviceDiscovery.stopDiscovery()
        deviceDiscovery.unregisterService()

        signalingClient.stopServer()
        signalingClient.disconnect()

        Log.i(TAG, "P2P network shutdown")
    }
}
