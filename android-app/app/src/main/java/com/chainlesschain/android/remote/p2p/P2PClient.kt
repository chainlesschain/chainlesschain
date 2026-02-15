package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.remote.data.AuthInfo
import com.chainlesschain.android.remote.data.CommandCancelRequest
import com.chainlesschain.android.remote.data.CommandResponse
import com.chainlesschain.android.remote.data.ErrorCodes
import com.chainlesschain.android.remote.data.EventNotification
import com.chainlesschain.android.remote.data.FileTransferProgress
import com.chainlesschain.android.remote.data.MessageTypes
import com.chainlesschain.android.remote.data.P2PMessage
import com.chainlesschain.android.remote.data.ProgressNotification
import com.chainlesschain.android.remote.data.StreamChunkMessage
import com.chainlesschain.android.remote.data.StreamEndMessage
import com.chainlesschain.android.remote.data.StreamStartMessage
import com.chainlesschain.android.remote.data.fromJson
import com.chainlesschain.android.remote.data.toJsonString
import com.chainlesschain.android.remote.crypto.NonceManager
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.lang.reflect.Type
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

@Singleton
class P2PClient @Inject constructor(
    private val didManager: DIDManager,
    private val webRTCClient: WebRTCClient,
    private val nonceManager: NonceManager,  // Nonce 持久化管理
    private val deviceActivityManager: DeviceActivityManager  // 设备活动跟踪
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val pendingRequests = ConcurrentHashMap<String, PendingRequest>()
    @Volatile private var heartbeatJob: Job? = null
    @Volatile private var reconnectJob: Job? = null
    @Volatile private var heartbeatTimeoutJob: Job? = null

    private val config = P2PClientConfig()
    private val gson = Gson()

    // Reconnection state
    @Volatile private var reconnectAttempts = 0
    @Volatile private var currentReconnectDelay = config.baseReconnectDelay
    @Volatile private var lastConnectedPeerId: String? = null
    @Volatile private var lastConnectedPeerDID: String? = null
    @Volatile private var lastHeartbeatReceived = System.currentTimeMillis()
    @Volatile private var autoReconnectEnabled = true

    private val _events = MutableSharedFlow<EventNotification>(replay = 0, extraBufferCapacity = 16)
    val events: SharedFlow<EventNotification> = _events.asSharedFlow()

    // ==================== 流式消息支持 ====================
    private val _streamStart = MutableSharedFlow<StreamStartMessage>(replay = 0, extraBufferCapacity = 16)
    val streamStart: SharedFlow<StreamStartMessage> = _streamStart.asSharedFlow()

    private val _streamChunks = MutableSharedFlow<StreamChunkMessage>(replay = 0, extraBufferCapacity = 64)
    val streamChunks: SharedFlow<StreamChunkMessage> = _streamChunks.asSharedFlow()

    private val _streamEnd = MutableSharedFlow<StreamEndMessage>(replay = 0, extraBufferCapacity = 16)
    val streamEnd: SharedFlow<StreamEndMessage> = _streamEnd.asSharedFlow()

    // 活跃流追踪
    private val activeStreams = ConcurrentHashMap<String, StreamState>()

    // ==================== 进度通知支持 ====================
    private val _progressUpdates = MutableSharedFlow<ProgressNotification>(replay = 0, extraBufferCapacity = 32)
    val progressUpdates: SharedFlow<ProgressNotification> = _progressUpdates.asSharedFlow()

    private val _fileTransferProgress = MutableSharedFlow<FileTransferProgress>(replay = 0, extraBufferCapacity = 32)
    val fileTransferProgress: SharedFlow<FileTransferProgress> = _fileTransferProgress.asSharedFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _connectedPeer = MutableStateFlow<PeerInfo?>(null)
    val connectedPeer: StateFlow<PeerInfo?> = _connectedPeer.asStateFlow()

    // Reconnection events for UI updates
    private val _reconnectionEvents = MutableSharedFlow<ReconnectionEvent>(replay = 0, extraBufferCapacity = 8)
    val reconnectionEvents: SharedFlow<ReconnectionEvent> = _reconnectionEvents.asSharedFlow()

    init {
        webRTCClient.initialize()
        webRTCClient.setOnMessageReceived { raw ->
            scope.launch { handleIncoming(raw) }
        }
        webRTCClient.setOnDisconnected {
            scope.launch { handleDisconnection() }
        }
    }

    suspend fun connect(pcPeerId: String, pcDID: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            Timber.i("========================================")
            Timber.i("[P2PClient] connect() 被调用")
            Timber.i("[P2PClient] 目标 pcPeerId: $pcPeerId")
            Timber.i("[P2PClient] 目标 pcDID: $pcDID")
            Timber.i("[P2PClient] 当前连接状态: ${_connectionState.value}")
            Timber.i("========================================")

            if (_connectionState.value == ConnectionState.CONNECTED) {
                Timber.i("[P2PClient] 已连接，先断开...")
                disconnect()
            }
            _connectionState.value = ConnectionState.CONNECTING
            Timber.i("[P2PClient] 状态更新为 CONNECTING")

            // Store for reconnection
            lastConnectedPeerId = pcPeerId
            lastConnectedPeerDID = pcDID

            // Generate a local peerId for signaling registration
            val localPeerId = "mobile-${java.util.UUID.randomUUID().toString().take(8)}"
            Timber.i("[P2PClient] 生成本地 peerId: $localPeerId")
            Timber.i("[P2PClient] 正在调用 webRTCClient.connect()...")
            val result = webRTCClient.connect(pcPeerId, localPeerId)
            if (result.isFailure) {
                _connectionState.value = ConnectionState.ERROR
                return@withContext Result.failure(result.exceptionOrNull() ?: Exception("Connect failed"))
            }

            _connectionState.value = ConnectionState.CONNECTED
            _connectedPeer.value = PeerInfo(
                peerId = pcPeerId,
                did = pcDID,
                connectedAt = System.currentTimeMillis()
            )

            // Reset reconnection state on successful connect
            resetReconnectionState()

            // 通知活动管理器连接成功
            deviceActivityManager.setConnected(true)
            deviceActivityManager.recordActivity("connected")

            startHeartbeat()
            startHeartbeatTimeoutMonitor()
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "P2P connect failed")
            _connectionState.value = ConnectionState.ERROR
            Result.failure(e)
        }
    }

    /**
     * Enable or disable automatic reconnection
     */
    fun setAutoReconnect(enabled: Boolean) {
        autoReconnectEnabled = enabled
        if (!enabled) {
            cancelReconnect()
        }
    }

    /**
     * Handle disconnection and trigger auto-reconnect
     */
    private suspend fun handleDisconnection() {
        Timber.w("[P2PClient] Connection lost, handling disconnection...")

        if (_connectionState.value == ConnectionState.DISCONNECTED) {
            return  // Already handled
        }

        stopHeartbeat()
        stopHeartbeatTimeoutMonitor()

        _connectionState.value = ConnectionState.DISCONNECTED

        if (autoReconnectEnabled && lastConnectedPeerId != null && lastConnectedPeerDID != null) {
            scheduleReconnect()
        }
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private fun scheduleReconnect() {
        if (reconnectAttempts >= config.maxReconnectAttempts) {
            Timber.e("[P2PClient] Max reconnection attempts reached (${config.maxReconnectAttempts})")
            scope.launch {
                _reconnectionEvents.emit(ReconnectionEvent.Failed(
                    attempts = reconnectAttempts,
                    reason = "Max reconnection attempts exceeded"
                ))
            }
            _connectionState.value = ConnectionState.ERROR
            return
        }

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val delay = currentReconnectDelay
            Timber.i("[P2PClient] Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempts + 1}/${config.maxReconnectAttempts})")

            _reconnectionEvents.emit(ReconnectionEvent.Scheduled(
                attempt = reconnectAttempts + 1,
                delayMs = delay
            ))

            _connectionState.value = ConnectionState.RECONNECTING

            delay(delay)

            reconnectAttempts++

            // Calculate next delay with exponential backoff
            currentReconnectDelay = minOf(
                (currentReconnectDelay * config.reconnectBackoffFactor).toLong(),
                config.maxReconnectDelay
            )

            _reconnectionEvents.emit(ReconnectionEvent.Attempting(
                attempt = reconnectAttempts
            ))

            val peerId = lastConnectedPeerId ?: return@launch
            val peerDID = lastConnectedPeerDID ?: return@launch

            Timber.i("[P2PClient] Attempting reconnect to $peerId...")

            val result = connect(peerId, peerDID)

            if (result.isSuccess) {
                Timber.i("[P2PClient] Reconnection successful!")
                _reconnectionEvents.emit(ReconnectionEvent.Success(
                    attempts = reconnectAttempts
                ))
            } else {
                Timber.w("[P2PClient] Reconnection failed: ${result.exceptionOrNull()?.message}")
                // Will be scheduled again by handleDisconnection if still auto-reconnect enabled
                if (autoReconnectEnabled) {
                    scheduleReconnect()
                }
            }
        }
    }

    /**
     * Cancel any pending reconnection attempt
     */
    fun cancelReconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
    }

    /**
     * Reset reconnection state after successful connection
     */
    private fun resetReconnectionState() {
        reconnectAttempts = 0
        currentReconnectDelay = config.baseReconnectDelay
        lastHeartbeatReceived = System.currentTimeMillis()
    }

    /**
     * Monitor heartbeat timeout
     */
    private fun startHeartbeatTimeoutMonitor() {
        heartbeatTimeoutJob?.cancel()
        heartbeatTimeoutJob = scope.launch {
            while (isActive && _connectionState.value == ConnectionState.CONNECTED) {
                delay(config.heartbeatCheckInterval)

                val elapsed = System.currentTimeMillis() - lastHeartbeatReceived
                if (elapsed > config.heartbeatTimeout) {
                    Timber.w("[P2PClient] Heartbeat timeout! Last received ${elapsed}ms ago")
                    _reconnectionEvents.emit(ReconnectionEvent.HeartbeatTimeout(
                        lastReceivedMs = elapsed
                    ))
                    handleDisconnection()
                    break
                }
            }
        }
    }

    /**
     * Stop heartbeat timeout monitor
     */
    private fun stopHeartbeatTimeoutMonitor() {
        heartbeatTimeoutJob?.cancel()
        heartbeatTimeoutJob = null
    }

    /**
     * Get current reconnection status
     */
    fun getReconnectionStatus(): ReconnectionStatus {
        return ReconnectionStatus(
            isReconnecting = _connectionState.value == ConnectionState.RECONNECTING,
            attempts = reconnectAttempts,
            maxAttempts = config.maxReconnectAttempts,
            nextDelayMs = currentReconnectDelay,
            autoReconnectEnabled = autoReconnectEnabled
        )
    }

    /**
     * Send a command and return the raw result (no type conversion).
     * Callers should handle type conversion themselves or use the typed overload.
     */
    suspend fun <T> sendCommand(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = config.requestTimeout
    ): Result<T> = withContext(Dispatchers.IO) {
        if (_connectionState.value != ConnectionState.CONNECTED) {
            return@withContext Result.failure(Exception("Not connected"))
        }
        try {
            // 记录活动（命令执行）
            deviceActivityManager.recordActivity("command_executed")

            val response = sendCommandInternal(method, params, timeout)

            if (response.isError()) {
                return@withContext Result.failure(Exception(response.error?.message ?: "Unknown error"))
            }

            @Suppress("UNCHECKED_CAST")
            Result.success(response.result as T)
        } catch (e: Exception) {
            Timber.e(e, "sendCommand failed: $method")
            Result.failure(e)
        }
    }

    /**
     * Send a command with proper type-safe deserialization via Gson TypeToken.
     * Use this when you need a specific return type (e.g., a data class).
     *
     * Example: sendCommand("ai.chat", params, typeOf = object : TypeToken<ChatResponse>() {}.type)
     */
    suspend fun <T> sendCommand(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = config.requestTimeout,
        typeOf: Type
    ): Result<T> = withContext(Dispatchers.IO) {
        if (_connectionState.value != ConnectionState.CONNECTED) {
            return@withContext Result.failure(Exception("Not connected"))
        }
        try {
            val response = sendCommandInternal(method, params, timeout)

            if (response.isError()) {
                return@withContext Result.failure(Exception(response.error?.message ?: "Unknown error"))
            }

            val result = response.result
            val converted: T = when (result) {
                null -> {
                    @Suppress("UNCHECKED_CAST")
                    null as T
                }
                is String, is Number, is Boolean -> {
                    @Suppress("UNCHECKED_CAST")
                    result as T
                }
                else -> {
                    // Convert via JSON round-trip for proper type safety
                    val json = gson.toJson(result)
                    gson.fromJson(json, typeOf)
                }
            }
            Result.success(converted)
        } catch (e: Exception) {
            Timber.e(e, "sendCommand failed: $method")
            Result.failure(e)
        }
    }

    private suspend fun sendCommandInternal(
        method: String,
        params: Map<String, Any>,
        timeout: Long
    ): CommandResponse = withContext(Dispatchers.IO) {
        val requestId = generateRequestId()
        val requestPayload = mapOf(
            "id" to requestId,
            "method" to method,
            "params" to params,
            "auth" to createAuth(method)
        )

        val deferred = CompletableDeferred<CommandResponse>()
        pendingRequests[requestId] = PendingRequest(
            requestId = requestId,
            method = method,
            timestamp = System.currentTimeMillis(),
            deferred = deferred
        )

        val timeoutJob = scope.launch {
            delay(timeout)
            val pending = pendingRequests.remove(requestId)
            pending?.deferred?.completeExceptionally(Exception("Request timeout: $method"))
        }

        try {
            val message = P2PMessage(
                type = MessageTypes.COMMAND_REQUEST,
                payload = requestPayload.toJsonString()
            )
            webRTCClient.sendMessage(message.toJsonString())
            val response = deferred.await()
            timeoutJob.cancel()
            pendingRequests.remove(requestId)
            response
        } catch (e: Exception) {
            timeoutJob.cancel()
            pendingRequests.remove(requestId)
            throw e
        }
    }

    fun disconnect() {
        // Disable auto-reconnect during intentional disconnect
        autoReconnectEnabled = false
        cancelReconnect()
        stopHeartbeat()
        stopHeartbeatTimeoutMonitor()

        // 通知活动管理器断开连接
        deviceActivityManager.setConnected(false)

        webRTCClient.disconnect()
        pendingRequests.forEach { (_, pending) ->
            pending.deferred.completeExceptionally(Exception("Connection closed"))
        }
        pendingRequests.clear()
        _connectedPeer.value = null
        _connectionState.value = ConnectionState.DISCONNECTED

        // Clear stored peer info
        lastConnectedPeerId = null
        lastConnectedPeerDID = null
        resetReconnectionState()
    }

    /**
     * Disconnect but keep auto-reconnect enabled (for temporary disconnections)
     */
    fun disconnectTemporary() {
        stopHeartbeat()
        stopHeartbeatTimeoutMonitor()
        webRTCClient.disconnect()
        pendingRequests.forEach { (_, pending) ->
            pending.deferred.completeExceptionally(Exception("Connection closed temporarily"))
        }
        pendingRequests.clear()
        _connectedPeer.value = null
        _connectionState.value = ConnectionState.DISCONNECTED

        // Don't clear lastConnectedPeerId/DID so auto-reconnect can work
        if (autoReconnectEnabled && lastConnectedPeerId != null) {
            scope.launch { scheduleReconnect() }
        }
    }

    private suspend fun handleIncoming(raw: String) {
        try {
            val message = raw.fromJson<P2PMessage>()
            when (message.type) {
                MessageTypes.COMMAND_RESPONSE -> {
                    val response = message.payload.fromJson<CommandResponse>()
                    pendingRequests[response.id]?.deferred?.complete(response)
                }
                MessageTypes.COMMAND_CANCEL -> {
                    // 处理来自 PC 端的取消请求
                    val cancelRequest = message.payload.fromJson<CommandCancelRequest>()
                    handleCommandCancel(cancelRequest)
                }
                MessageTypes.EVENT_NOTIFICATION -> {
                    val event = message.payload.fromJson<EventNotification>()
                    _events.emit(event)
                    // 处理特定类型的事件
                    handleSpecificEvent(event)
                }
                MessageTypes.HEARTBEAT, MessageTypes.HEARTBEAT_ACK, "pong" -> {
                    // Reset heartbeat timeout on any heartbeat-related message
                    lastHeartbeatReceived = System.currentTimeMillis()
                    Timber.v("[P2PClient] Heartbeat received, resetting timeout")
                }

                // ==================== 流式消息处理 ====================
                MessageTypes.STREAM_START -> {
                    val streamStart = message.payload.fromJson<StreamStartMessage>()
                    handleStreamStart(streamStart)
                }
                MessageTypes.STREAM_CHUNK -> {
                    val streamChunk = message.payload.fromJson<StreamChunkMessage>()
                    handleStreamChunk(streamChunk)
                }
                MessageTypes.STREAM_END -> {
                    val streamEnd = message.payload.fromJson<StreamEndMessage>()
                    handleStreamEnd(streamEnd)
                }
                MessageTypes.STREAM_ERROR -> {
                    val streamEnd = message.payload.fromJson<StreamEndMessage>()
                    handleStreamError(streamEnd)
                }

                // ==================== 文件传输进度 ====================
                MessageTypes.FILE_TRANSFER_PROGRESS -> {
                    val progress = message.payload.fromJson<FileTransferProgress>()
                    _fileTransferProgress.emit(progress)
                }

                else -> Timber.w("Unknown P2P message type: ${message.type}")
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle incoming message")
        }
    }

    /**
     * 处理特定类型的事件通知
     */
    private suspend fun handleSpecificEvent(event: EventNotification) {
        when (event.method) {
            // 进度类事件转换为进度通知
            "progress.update" -> {
                val progress = ProgressNotification(
                    operationId = event.params["operationId"] as? String ?: "",
                    operationType = event.params["operationType"] as? String ?: "",
                    progress = (event.params["progress"] as? Number)?.toFloat() ?: 0f,
                    currentStep = event.params["currentStep"] as? String,
                    totalSteps = (event.params["totalSteps"] as? Number)?.toInt(),
                    currentStepIndex = (event.params["currentStepIndex"] as? Number)?.toInt(),
                    estimatedRemainingMs = (event.params["estimatedRemainingMs"] as? Number)?.toLong()
                )
                _progressUpdates.emit(progress)
            }
            // 文件传输进度
            "file.transfer.progress" -> {
                val progress = FileTransferProgress(
                    transferId = event.params["transferId"] as? String ?: "",
                    fileName = event.params["fileName"] as? String ?: "",
                    filePath = event.params["filePath"] as? String ?: "",
                    direction = event.params["direction"] as? String ?: "download",
                    bytesTransferred = (event.params["bytesTransferred"] as? Number)?.toLong() ?: 0,
                    totalBytes = (event.params["totalBytes"] as? Number)?.toLong() ?: 0,
                    progress = (event.params["progress"] as? Number)?.toFloat() ?: 0f,
                    speed = (event.params["speed"] as? Number)?.toLong() ?: 0,
                    estimatedRemainingMs = (event.params["estimatedRemainingMs"] as? Number)?.toLong(),
                    state = event.params["state"] as? String ?: "transferring"
                )
                _fileTransferProgress.emit(progress)
            }
        }
    }

    // ==================== 流式消息处理方法 ====================

    private suspend fun handleStreamStart(streamStart: StreamStartMessage) {
        Timber.d("[P2PClient] Stream started: ${streamStart.streamId}")
        activeStreams[streamStart.streamId] = StreamState(
            streamId = streamStart.streamId,
            method = streamStart.method,
            startTime = System.currentTimeMillis(),
            totalChunks = streamStart.totalChunks,
            receivedChunks = 0
        )
        _streamStart.emit(streamStart)
    }

    private suspend fun handleStreamChunk(streamChunk: StreamChunkMessage) {
        val state = activeStreams[streamChunk.streamId]
        if (state != null) {
            activeStreams[streamChunk.streamId] = state.copy(
                receivedChunks = state.receivedChunks + 1,
                lastChunkTime = System.currentTimeMillis()
            )
        }
        _streamChunks.emit(streamChunk)
    }

    private suspend fun handleStreamEnd(streamEnd: StreamEndMessage) {
        Timber.d("[P2PClient] Stream ended: ${streamEnd.streamId}, success=${streamEnd.success}")
        activeStreams.remove(streamEnd.streamId)
        _streamEnd.emit(streamEnd)
    }

    private suspend fun handleStreamError(streamEnd: StreamEndMessage) {
        Timber.e("[P2PClient] Stream error: ${streamEnd.streamId}, error=${streamEnd.error}")
        activeStreams.remove(streamEnd.streamId)
        _streamEnd.emit(streamEnd.copy(success = false))
    }

    /**
     * 获取活跃流状态
     */
    fun getActiveStreams(): List<StreamState> {
        return activeStreams.values.toList()
    }

    /**
     * 取消活跃流
     */
    suspend fun cancelStream(streamId: String): Result<Unit> {
        return try {
            val cancelRequest = mapOf(
                "type" to "stream_cancel",
                "streamId" to streamId
            )
            val message = P2PMessage(
                type = "chainlesschain:stream:cancel",
                payload = cancelRequest.toJsonString()
            )
            webRTCClient.sendMessage(message.toJsonString())
            activeStreams.remove(streamId)
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "[P2PClient] 取消流失败: $streamId")
            Result.failure(e)
        }
    }

    /**
     * 处理来自 PC 端的命令取消请求
     */
    private fun handleCommandCancel(cancelRequest: CommandCancelRequest) {
        Timber.i("[P2PClient] 收到取消请求: ${cancelRequest.id} (${cancelRequest.reason ?: "no reason"})")

        val pending = pendingRequests[cancelRequest.id]
        if (pending != null) {
            // 取消待处理请求
            pending.deferred.completeExceptionally(
                CommandCancelledException(cancelRequest.reason ?: "Cancelled by server")
            )
            pendingRequests.remove(cancelRequest.id)
            Timber.i("[P2PClient] 命令已取消: ${cancelRequest.id}")
        } else {
            Timber.w("[P2PClient] 取消请求的命令不存在或已完成: ${cancelRequest.id}")
        }
    }

    /**
     * 取消正在执行的命令（发送取消请求到 PC 端）
     */
    suspend fun cancelCommand(commandId: String, reason: String = "Cancelled by client"): Result<Unit> {
        return try {
            Timber.d("[P2PClient] 取消命令: $commandId")

            val cancelRequest = CommandCancelRequest(
                id = commandId,
                reason = reason
            )

            val message = P2PMessage(
                type = MessageTypes.COMMAND_CANCEL,
                payload = cancelRequest.toJsonString()
            )

            webRTCClient.sendMessage(message.toJsonString())

            // 同时取消本地等待
            val pending = pendingRequests.remove(commandId)
            pending?.deferred?.completeExceptionally(
                CommandCancelledException(reason)
            )

            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "[P2PClient] 取消命令失败: $commandId")
            Result.failure(e)
        }
    }

    /**
     * 获取当前待处理的命令列表
     */
    fun getPendingCommands(): List<PendingCommandInfo> {
        val now = System.currentTimeMillis()
        return pendingRequests.values.map { pending ->
            PendingCommandInfo(
                requestId = pending.requestId,
                method = pending.method,
                timestamp = pending.timestamp,
                elapsedMs = now - pending.timestamp
            )
        }
    }

    private suspend fun createAuth(method: String): AuthInfo {
        val timestamp = System.currentTimeMillis()
        val did = didManager.getCurrentDID()
        // 使用 NonceManager 生成持久化的 Nonce（防重放攻击）
        val nonce = nonceManager.generateNonce(did)
        val signature = didManager.sign("$method:$timestamp:$nonce")
        return AuthInfo(
            did = did,
            signature = signature,
            timestamp = timestamp,
            nonce = nonce
        )
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && _connectionState.value == ConnectionState.CONNECTED) {
                try {
                    val heartbeat = P2PMessage(
                        type = MessageTypes.HEARTBEAT,
                        payload = mapOf("timestamp" to System.currentTimeMillis()).toJsonString()
                    )
                    webRTCClient.sendMessage(heartbeat.toJsonString())
                } catch (e: Exception) {
                    Timber.w(e, "Heartbeat failed")
                }
                delay(config.heartbeatInterval)
            }
        }
    }

    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    private fun generateRequestId(): String {
        return "req-${System.currentTimeMillis()}-${Random.nextInt(100000, 999999)}"
    }
}

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    ERROR
}

data class PeerInfo(
    val peerId: String,
    val did: String,
    val connectedAt: Long
)

data class PendingRequest(
    val requestId: String,
    val method: String,
    val timestamp: Long,
    val deferred: CompletableDeferred<CommandResponse>
)

data class P2PClientConfig(
    val requestTimeout: Long = 30_000,
    val heartbeatInterval: Long = 30_000,
    val heartbeatTimeout: Long = 90_000,        // 90 seconds timeout
    val heartbeatCheckInterval: Long = 10_000,  // Check every 10 seconds
    val maxRetries: Int = 3,
    val retryDelay: Long = 1_000,

    // Reconnection configuration (exponential backoff)
    val baseReconnectDelay: Long = 1_000,       // Start with 1 second
    val maxReconnectDelay: Long = 60_000,       // Max 60 seconds
    val reconnectBackoffFactor: Double = 2.0,   // Double each time
    val maxReconnectAttempts: Int = 10          // Max 10 attempts before giving up
)

/**
 * Reconnection status for UI updates
 */
data class ReconnectionStatus(
    val isReconnecting: Boolean,
    val attempts: Int,
    val maxAttempts: Int,
    val nextDelayMs: Long,
    val autoReconnectEnabled: Boolean
)

/**
 * Reconnection events for observing reconnection progress
 */
sealed class ReconnectionEvent {
    data class Scheduled(
        val attempt: Int,
        val delayMs: Long
    ) : ReconnectionEvent()

    data class Attempting(
        val attempt: Int
    ) : ReconnectionEvent()

    data class Success(
        val attempts: Int
    ) : ReconnectionEvent()

    data class Failed(
        val attempts: Int,
        val reason: String
    ) : ReconnectionEvent()

    data class HeartbeatTimeout(
        val lastReceivedMs: Long
    ) : ReconnectionEvent()
}

/**
 * 命令被取消异常
 */
class CommandCancelledException(
    message: String
) : Exception("Command cancelled: $message")

/**
 * 待处理命令信息（用于 UI 显示）
 */
data class PendingCommandInfo(
    val requestId: String,
    val method: String,
    val timestamp: Long,
    val elapsedMs: Long
)

/**
 * 流状态信息
 */
data class StreamState(
    val streamId: String,
    val method: String,
    val startTime: Long,
    val totalChunks: Int? = null,
    val receivedChunks: Int = 0,
    val lastChunkTime: Long? = null
) {
    val elapsedMs: Long get() = System.currentTimeMillis() - startTime
    val progress: Float? get() = totalChunks?.let { receivedChunks.toFloat() / it }
}
