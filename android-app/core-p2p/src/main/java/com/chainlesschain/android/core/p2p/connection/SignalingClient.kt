package com.chainlesschain.android.core.p2p.connection

import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.concurrent.thread

/**
 * 信令客户端
 *
 * 用于WebRTC连接建立过程中的SDP和ICE候选交换
 * 支持两种模式：
 * 1. 直接P2P模式（通过Socket）
 * 2. 中继服务器模式（通过HTTP，待实现）
 *
 * 支持：
 * - 连接超时检测
 * - 读写超时处理
 * - 连接状态监控
 * - 自动重连
 */
@Singleton
class SignalingClient @Inject constructor() {

    companion object {
        private const val TAG = "SignalingClient"
        private const val SIGNALING_PORT = 9999

        /** 连接超时（毫秒） */
        const val CONNECT_TIMEOUT_MS = 10_000

        /** Socket读取超时（毫秒） */
        const val READ_TIMEOUT_MS = 30_000

        /** 最大重连尝试次数 */
        const val MAX_RECONNECT_ATTEMPTS = 5

        /** 重连基础延迟（毫秒） */
        const val RECONNECT_BASE_DELAY_MS = 1_000L

        /** 最大重连延迟（毫秒） */
        const val MAX_RECONNECT_DELAY_MS = 30_000L

        /** 心跳间隔（毫秒） */
        const val HEARTBEAT_INTERVAL_MS = 15_000L

        /** 心跳超时（毫秒）- 连续N次无响应视为断开 */
        const val HEARTBEAT_TIMEOUT_MS = 45_000L

        /** 心跳响应超时（毫秒） */
        const val HEARTBEAT_RESPONSE_TIMEOUT_MS = 5_000L
    }

    private val json = Json { ignoreUnknownKeys = true }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 信令消息流
    private val _signalingMessages = MutableSharedFlow<SignalingMessage>()
    val signalingMessages: Flow<SignalingMessage> = _signalingMessages.asSharedFlow()

    // 连接状态流
    private val _connectionState = MutableStateFlow<SignalingConnectionState>(SignalingConnectionState.Disconnected)
    val connectionState: StateFlow<SignalingConnectionState> = _connectionState.asStateFlow()

    // 连接事件流 - 使用extraBufferCapacity确保事件不会丢失
    private val _connectionEvents = MutableSharedFlow<SignalingConnectionEvent>(
        extraBufferCapacity = 64
    )
    val connectionEvents: SharedFlow<SignalingConnectionEvent> = _connectionEvents.asSharedFlow()

    // 服务器Socket（接收连接）
    private var serverSocket: ServerSocket? = null
    private var isServerRunning = false

    // 客户端Socket（发起连接）
    private var clientSocket: Socket? = null
    private var writer: PrintWriter? = null
    private var reader: BufferedReader? = null

    // 当前连接的服务器信息
    private var currentHost: String? = null
    private var currentPort: Int = SIGNALING_PORT

    // 重连状态
    private var reconnectAttempts = 0
    private var reconnectJob: Job? = null

    // 心跳状态
    private var heartbeatJob: Job? = null
    private var lastHeartbeatResponse = 0L
    private var pendingHeartbeatId: String? = null

    // 连接健康度统计
    private var totalHeartbeatsSent = 0
    private var totalHeartbeatsReceived = 0
    private var connectionStartTime = 0L

    /**
     * 启动信令服务器（等待连接）
     */
    fun startServer() {
        if (isServerRunning) {
            Log.w(TAG, "Server already running")
            return
        }

        thread {
            try {
                serverSocket = ServerSocket(SIGNALING_PORT).apply {
                    soTimeout = 0 // 无限等待连接
                }
                isServerRunning = true
                Log.i(TAG, "Signaling server started on port $SIGNALING_PORT")

                _connectionState.value = SignalingConnectionState.Listening

                while (isServerRunning) {
                    try {
                        val socket = serverSocket?.accept()
                        socket?.let {
                            Log.i(TAG, "Client connected: ${it.inetAddress}")
                            // 设置socket超时
                            it.soTimeout = READ_TIMEOUT_MS
                            handleClient(it)
                        }
                    } catch (e: SocketTimeoutException) {
                        // Accept超时，继续等待
                        continue
                    } catch (e: Exception) {
                        if (isServerRunning) {
                            Log.e(TAG, "Error accepting client", e)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start server", e)
                scope.launch {
                    _connectionEvents.emit(SignalingConnectionEvent.ServerError(e.message ?: "Unknown error"))
                }
            } finally {
                isServerRunning = false
                _connectionState.value = SignalingConnectionState.Disconnected
            }
        }
    }

    /**
     * 停止信令服务器
     */
    fun stopServer() {
        isServerRunning = false
        serverSocket?.close()
        serverSocket = null
        Log.i(TAG, "Signaling server stopped")
    }

    /**
     * 连接到远程信令服务器
     *
     * @param host 远程主机地址
     * @param port 远程端口（默认9999）
     */
    fun connectToServer(host: String, port: Int = SIGNALING_PORT) {
        currentHost = host
        currentPort = port
        reconnectAttempts = 0

        doConnect(host, port)
    }

    /**
     * 执行连接
     */
    private fun doConnect(host: String, port: Int) {
        thread {
            _connectionState.value = SignalingConnectionState.Connecting

            try {
                // 创建Socket并设置连接超时
                val socket = Socket()
                socket.soTimeout = READ_TIMEOUT_MS

                Log.d(TAG, "Connecting to signaling server: $host:$port with timeout ${CONNECT_TIMEOUT_MS}ms")

                // 带超时的连接
                socket.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)

                clientSocket = socket
                writer = PrintWriter(socket.getOutputStream(), true)
                reader = BufferedReader(InputStreamReader(socket.getInputStream()))

                _connectionState.value = SignalingConnectionState.Connected
                reconnectAttempts = 0
                connectionStartTime = System.currentTimeMillis()
                lastHeartbeatResponse = System.currentTimeMillis()

                Log.i(TAG, "Connected to signaling server: $host:$port")

                scope.launch {
                    _connectionEvents.emit(SignalingConnectionEvent.Connected(host, port))
                }

                // 启动心跳
                startHeartbeat()

                // 监听消息
                listenForMessages()

            } catch (e: SocketTimeoutException) {
                Log.e(TAG, "Connection timeout to $host:$port", e)
                handleConnectionFailure("Connection timeout", e)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to connect to server", e)
                handleConnectionFailure(e.message ?: "Unknown error", e)
            }
        }
    }

    /**
     * 处理连接失败
     */
    private fun handleConnectionFailure(reason: String, error: Exception) {
        _connectionState.value = SignalingConnectionState.Failed(reason)

        scope.launch {
            _connectionEvents.emit(SignalingConnectionEvent.ConnectionFailed(reason))
        }

        // 尝试重连
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            scheduleReconnect()
        } else {
            Log.e(TAG, "Max reconnect attempts reached")
            scope.launch {
                _connectionEvents.emit(SignalingConnectionEvent.MaxReconnectReached)
            }
        }
    }

    /**
     * 安排重连
     *
     * 使用带抖动的指数退避策略，避免雷群效应
     */
    private fun scheduleReconnect() {
        val host = currentHost ?: return
        val port = currentPort

        reconnectAttempts++

        // 指数退避：baseDelay * 2^(attempt-1)，带最大限制
        val exponentialDelay = RECONNECT_BASE_DELAY_MS * (1L shl (reconnectAttempts - 1).coerceAtMost(5))
        val cappedDelay = exponentialDelay.coerceAtMost(MAX_RECONNECT_DELAY_MS)

        // 添加 ±20% 的抖动，避免多客户端同时重连
        val jitter = (cappedDelay * 0.2 * (Math.random() * 2 - 1)).toLong()
        val finalDelay = (cappedDelay + jitter).coerceAtLeast(RECONNECT_BASE_DELAY_MS)

        Log.i(TAG, "Scheduling reconnect to $host:$port in ${finalDelay}ms (attempt $reconnectAttempts/$MAX_RECONNECT_ATTEMPTS)")

        _connectionState.value = SignalingConnectionState.Reconnecting(reconnectAttempts)

        scope.launch {
            _connectionEvents.emit(SignalingConnectionEvent.Reconnecting(reconnectAttempts, finalDelay))
        }

        reconnectJob = scope.launch {
            delay(finalDelay)
            doConnect(host, port)
        }
    }

    /**
     * 取消重连
     */
    fun cancelReconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectAttempts = 0
        Log.i(TAG, "Reconnect cancelled")
    }

    /**
     * 手动触发重连
     */
    fun reconnect() {
        val host = currentHost
        val port = currentPort

        if (host != null) {
            cancelReconnect()
            reconnectAttempts = 0
            doConnect(host, port)
        } else {
            Log.w(TAG, "No server to reconnect to")
        }
    }

    /**
     * 断开信令连接
     */
    fun disconnect() {
        cancelReconnect()
        stopHeartbeat()

        writer?.close()
        reader?.close()
        clientSocket?.close()

        writer = null
        reader = null
        clientSocket = null

        _connectionState.value = SignalingConnectionState.Disconnected

        scope.launch {
            _connectionEvents.emit(SignalingConnectionEvent.Disconnected)
        }

        Log.i(TAG, "Disconnected from signaling server")
    }

    /**
     * 检查是否已连接
     */
    fun isConnected(): Boolean {
        return _connectionState.value is SignalingConnectionState.Connected
    }

    /**
     * 发送信令消息
     */
    suspend fun sendMessage(message: SignalingMessage) {
        try {
            val wrapper = SignalingMessageWrapper.fromSignalingMessage(message)
            val jsonString = json.encodeToString(wrapper)

            writer?.println(jsonString)
            Log.d(TAG, "Sent signaling message: ${message::class.simpleName}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message", e)
        }
    }

    /**
     * 处理客户端连接
     */
    private fun handleClient(socket: Socket) {
        thread {
            try {
                writer = PrintWriter(socket.getOutputStream(), true)
                reader = BufferedReader(InputStreamReader(socket.getInputStream()))

                listenForMessages()
            } catch (e: Exception) {
                Log.e(TAG, "Error handling client", e)
            } finally {
                socket.close()
            }
        }
    }

    /**
     * 监听信令消息
     */
    private fun listenForMessages() {
        try {
            var line: String?
            while (reader?.readLine().also { line = it } != null) {
                line?.let {
                    try {
                        val wrapper = json.decodeFromString<SignalingMessageWrapper>(it)
                        val message = wrapper.toSignalingMessage()

                        Log.d(TAG, "Received signaling message: ${message::class.simpleName}")

                        // 处理心跳相关消息
                        when (message) {
                            is SignalingMessage.HeartbeatAck -> {
                                handleHeartbeatResponse(message.id)
                                // 不需要传递给上层
                            }
                            is SignalingMessage.Heartbeat -> {
                                // 收到对方心跳，发送响应
                                scope.launch {
                                    sendMessage(SignalingMessage.HeartbeatAck(message.id))
                                }
                            }
                            is SignalingMessage.Close -> {
                                Log.i(TAG, "Received close message: ${message.reason}")
                                _connectionState.value = SignalingConnectionState.Disconnected
                                scope.launch {
                                    _connectionEvents.emit(SignalingConnectionEvent.RemoteClosed(message.reason))
                                    _signalingMessages.emit(message)
                                }
                            }
                            else -> {
                                // 其他消息传递给上层
                                kotlinx.coroutines.runBlocking {
                                    _signalingMessages.emit(message)
                                }
                            }
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to parse message", e)
                    }
                }
            }

            // 连接正常关闭
            Log.i(TAG, "Connection closed by remote")
            stopHeartbeat()
            _connectionState.value = SignalingConnectionState.Disconnected
            scope.launch {
                _connectionEvents.emit(SignalingConnectionEvent.Disconnected)
            }

            // 尝试重连
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                scheduleReconnect()
            }

        } catch (e: SocketTimeoutException) {
            Log.w(TAG, "Read timeout, connection may be stale")
            stopHeartbeat()
            handleConnectionFailure("Read timeout", e)
        } catch (e: Exception) {
            if (_connectionState.value is SignalingConnectionState.Connected) {
                Log.e(TAG, "Error listening for messages", e)
                stopHeartbeat()
                handleConnectionFailure(e.message ?: "Connection error", e)
            }
        }
    }

    /**
     * 启动心跳
     */
    private fun startHeartbeat() {
        stopHeartbeat()

        heartbeatJob = scope.launch {
            Log.i(TAG, "Heartbeat started")

            while (coroutineContext.isActive) {
                delay(HEARTBEAT_INTERVAL_MS)

                if (_connectionState.value !is SignalingConnectionState.Connected) {
                    Log.d(TAG, "Heartbeat stopped: not connected")
                    break
                }

                // 检查上次心跳响应时间
                val timeSinceLastResponse = System.currentTimeMillis() - lastHeartbeatResponse
                if (timeSinceLastResponse > HEARTBEAT_TIMEOUT_MS) {
                    Log.w(TAG, "Heartbeat timeout: ${timeSinceLastResponse}ms since last response")
                    handleHeartbeatTimeout()
                    break
                }

                // 发送心跳
                sendHeartbeat()
            }
        }
    }

    /**
     * 停止心跳
     */
    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
        pendingHeartbeatId = null
    }

    /**
     * 发送心跳
     */
    private suspend fun sendHeartbeat() {
        val heartbeatId = "hb_${System.currentTimeMillis()}"
        pendingHeartbeatId = heartbeatId

        val heartbeatMessage = SignalingMessage.Heartbeat(heartbeatId)
        sendMessage(heartbeatMessage)

        totalHeartbeatsSent++
        Log.d(TAG, "Heartbeat sent: $heartbeatId (total: $totalHeartbeatsSent)")
    }

    /**
     * 处理心跳响应
     */
    private fun handleHeartbeatResponse(heartbeatId: String) {
        if (heartbeatId == pendingHeartbeatId) {
            lastHeartbeatResponse = System.currentTimeMillis()
            pendingHeartbeatId = null
            totalHeartbeatsReceived++

            Log.d(TAG, "Heartbeat response received: $heartbeatId (total: $totalHeartbeatsReceived)")
        } else {
            Log.w(TAG, "Unexpected heartbeat response: $heartbeatId (expected: $pendingHeartbeatId)")
        }
    }

    /**
     * 处理心跳超时
     */
    private fun handleHeartbeatTimeout() {
        Log.w(TAG, "Connection appears dead, initiating reconnect")

        _connectionState.value = SignalingConnectionState.Failed("Heartbeat timeout")

        scope.launch {
            _connectionEvents.emit(SignalingConnectionEvent.HeartbeatTimeout)
        }

        // 关闭当前连接并尝试重连
        try {
            writer?.close()
            reader?.close()
            clientSocket?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing socket after heartbeat timeout", e)
        }

        writer = null
        reader = null
        clientSocket = null

        // 触发重连
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            scheduleReconnect()
        }
    }

    /**
     * 获取连接健康度统计
     */
    fun getHealthStats(): ConnectionHealthStats {
        val uptime = if (connectionStartTime > 0 && _connectionState.value is SignalingConnectionState.Connected) {
            System.currentTimeMillis() - connectionStartTime
        } else {
            0L
        }

        val healthPercentage = if (totalHeartbeatsSent > 0) {
            (totalHeartbeatsReceived.toFloat() / totalHeartbeatsSent * 100).toInt()
        } else {
            100
        }

        return ConnectionHealthStats(
            isConnected = _connectionState.value is SignalingConnectionState.Connected,
            uptimeMs = uptime,
            heartbeatsSent = totalHeartbeatsSent,
            heartbeatsReceived = totalHeartbeatsReceived,
            healthPercentage = healthPercentage,
            reconnectAttempts = reconnectAttempts
        )
    }

    /**
     * 释放资源
     */
    fun release() {
        disconnect()
        stopServer()
        stopHeartbeat()
        scope.cancel()
    }
}

/**
 * 信令连接状态
 */
sealed class SignalingConnectionState {
    /** 已断开 */
    data object Disconnected : SignalingConnectionState()

    /** 监听中（服务端） */
    data object Listening : SignalingConnectionState()

    /** 连接中 */
    data object Connecting : SignalingConnectionState()

    /** 已连接 */
    data object Connected : SignalingConnectionState()

    /** 重连中 */
    data class Reconnecting(val attempt: Int) : SignalingConnectionState()

    /** 连接失败 */
    data class Failed(val reason: String) : SignalingConnectionState()
}

/**
 * 信令连接事件
 */
sealed class SignalingConnectionEvent {
    /** 已连接 */
    data class Connected(val host: String, val port: Int) : SignalingConnectionEvent()

    /** 连接失败 */
    data class ConnectionFailed(val reason: String) : SignalingConnectionEvent()

    /** 已断开 */
    data object Disconnected : SignalingConnectionEvent()

    /** 重连中 */
    data class Reconnecting(val attempt: Int, val delayMs: Long) : SignalingConnectionEvent()

    /** 达到最大重连次数 */
    data object MaxReconnectReached : SignalingConnectionEvent()

    /** 服务器错误 */
    data class ServerError(val reason: String) : SignalingConnectionEvent()

    /** 心跳超时 */
    data object HeartbeatTimeout : SignalingConnectionEvent()

    /** 远程关闭 */
    data class RemoteClosed(val reason: String) : SignalingConnectionEvent()
}

/**
 * 信令消息包装器（用于JSON序列化）
 */
@Serializable
data class SignalingMessageWrapper(
    val type: String,
    val fromDeviceId: String = "",
    val data: String = ""
) {
    companion object {
        fun fromSignalingMessage(message: SignalingMessage): SignalingMessageWrapper {
            return when (message) {
                is SignalingMessage.Offer -> SignalingMessageWrapper(
                    type = "offer",
                    fromDeviceId = message.fromDeviceId,
                    data = Json.encodeToString(message.sessionDescription)
                )
                is SignalingMessage.Answer -> SignalingMessageWrapper(
                    type = "answer",
                    fromDeviceId = message.fromDeviceId,
                    data = Json.encodeToString(message.sessionDescription)
                )
                is SignalingMessage.Candidate -> SignalingMessageWrapper(
                    type = "candidate",
                    fromDeviceId = message.fromDeviceId,
                    data = Json.encodeToString(message.iceCandidate)
                )
                is SignalingMessage.Heartbeat -> SignalingMessageWrapper(
                    type = "heartbeat",
                    data = message.id
                )
                is SignalingMessage.HeartbeatAck -> SignalingMessageWrapper(
                    type = "heartbeat_ack",
                    data = message.id
                )
                is SignalingMessage.Close -> SignalingMessageWrapper(
                    type = "close",
                    fromDeviceId = message.fromDeviceId,
                    data = message.reason
                )
            }
        }
    }

    fun toSignalingMessage(): SignalingMessage {
        return when (type) {
            "offer" -> SignalingMessage.Offer(
                fromDeviceId = fromDeviceId,
                sessionDescription = Json.decodeFromString(data)
            )
            "answer" -> SignalingMessage.Answer(
                fromDeviceId = fromDeviceId,
                sessionDescription = Json.decodeFromString(data)
            )
            "candidate" -> SignalingMessage.Candidate(
                fromDeviceId = fromDeviceId,
                iceCandidate = Json.decodeFromString(data)
            )
            "heartbeat" -> SignalingMessage.Heartbeat(id = data)
            "heartbeat_ack" -> SignalingMessage.HeartbeatAck(id = data)
            "close" -> SignalingMessage.Close(
                fromDeviceId = fromDeviceId,
                reason = data
            )
            else -> throw IllegalArgumentException("Unknown message type: $type")
        }
    }
}
