package com.chainlesschain.android.feature.p2p.webrtc.signaling

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.*
import okio.ByteString
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.min
import kotlin.math.pow

/**
 * WebSocket-based signaling client implementation
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Heartbeat mechanism (30s intervals)
 * - Message queuing during disconnection
 * - JSON serialization with kotlinx.serialization
 */
@Singleton
class WebSocketSignalingClient @Inject constructor(
    private val okHttpClient: OkHttpClient,
    private val json: Json,
    private val signalingConfig: com.chainlesschain.android.remote.config.SignalingConfig
) : SignalingClient {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    override val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _incomingMessages = MutableSharedFlow<SignalingMessage>(
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    override val incomingMessages: Flow<SignalingMessage> = _incomingMessages.asSharedFlow()

    private var webSocket: WebSocket? = null
    private var userId: String? = null
    private var token: String? = null
    private var reconnectAttempts = 0
    private var heartbeatJob: Job? = null

    private val messageQueue = ArrayDeque<SignalingMessage>()
    private val maxQueueSize = 100

    companion object {
        private const val SIGNALING_SERVER_URL = "wss://signal.chainlesschain.com/ws"
        private const val HEARTBEAT_INTERVAL_MS = 30_000L // 30 seconds
        private const val INITIAL_RECONNECT_DELAY_MS = 1_000L // 1 second
        private const val MAX_RECONNECT_DELAY_MS = 32_000L // 32 seconds
        private const val MAX_RECONNECT_ATTEMPTS = 10
    }

    override suspend fun connect(userId: String, token: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                this@WebSocketSignalingClient.userId = userId
                this@WebSocketSignalingClient.token = token

                _connectionState.value = ConnectionState.CONNECTING

                // Use configured signaling URL instead of hardcoded
                val signalingUrl = signalingConfig.getSignalingUrl()
                Timber.d("Connecting to signaling server: $signalingUrl")

                val request = Request.Builder()
                    .url(signalingUrl)
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("X-User-Id", userId)
                    .build()

                webSocket = okHttpClient.newWebSocket(request, createWebSocketListener())

                Result.success(Unit)
            } catch (e: Exception) {
                Timber.e(e, "Failed to connect to signaling server")
                _connectionState.value = ConnectionState.FAILED
                Result.failure(e)
            }
        }
    }

    override suspend fun disconnect() {
        withContext(Dispatchers.IO) {
            Timber.d("Disconnecting from signaling server")
            heartbeatJob?.cancel()
            heartbeatJob = null
            webSocket?.close(1000, "Client disconnect")
            webSocket = null
            _connectionState.value = ConnectionState.DISCONNECTED
            reconnectAttempts = 0
            messageQueue.clear()
        }
    }

    override suspend fun send(message: SignalingMessage): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                if (!isConnected()) {
                    // Queue message for later delivery
                    if (messageQueue.size < maxQueueSize) {
                        messageQueue.add(message)
                        Timber.w("Message queued (not connected): ${message::class.simpleName}")
                    } else {
                        Timber.e("Message queue full, dropping message: ${message::class.simpleName}")
                    }
                    return@withContext Result.failure(
                        IllegalStateException("Not connected to signaling server")
                    )
                }

                val envelope = createEnvelope(message)
                val jsonString = json.encodeToString(envelope)

                val success = webSocket?.send(jsonString) ?: false
                if (success) {
                    Timber.d("Sent signaling message: ${message::class.simpleName} to ${message.to}")
                    Result.success(Unit)
                } else {
                    Timber.e("Failed to send message: ${message::class.simpleName}")
                    Result.failure(IllegalStateException("WebSocket send failed"))
                }
            } catch (e: Exception) {
                Timber.e(e, "Error sending signaling message")
                Result.failure(e)
            }
        }
    }

    override fun isConnected(): Boolean {
        return _connectionState.value == ConnectionState.CONNECTED
    }

    private fun createWebSocketListener(): WebSocketListener {
        return object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Timber.i("WebSocket opened: ${response.message}")
                _connectionState.value = ConnectionState.CONNECTED
                reconnectAttempts = 0

                // Flush queued messages
                scope.launch {
                    flushMessageQueue()
                }

                // Start heartbeat
                startHeartbeat()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                scope.launch {
                    try {
                        val envelope = json.decodeFromString<SignalingEnvelope>(text)
                        val message = parseMessage(envelope)

                        when (message) {
                            is SignalingMessage.Pong -> {
                                Timber.v("Received pong from ${message.from}")
                            }
                            else -> {
                                Timber.d("Received signaling message: ${message::class.simpleName} from ${message.from}")
                                _incomingMessages.emit(message)
                            }
                        }
                    } catch (e: Exception) {
                        Timber.e(e, "Failed to parse signaling message: $text")
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                onMessage(webSocket, bytes.utf8())
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Timber.w("WebSocket closing: $code - $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Timber.i("WebSocket closed: $code - $reason")
                _connectionState.value = ConnectionState.DISCONNECTED
                heartbeatJob?.cancel()

                // Attempt reconnection if not a normal closure
                if (code != 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    scope.launch {
                        attemptReconnect()
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Timber.e(t, "WebSocket failure: ${response?.message}")
                _connectionState.value = ConnectionState.DISCONNECTED
                heartbeatJob?.cancel()

                // Attempt reconnection
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    scope.launch {
                        attemptReconnect()
                    }
                } else {
                    Timber.e("Max reconnection attempts reached, giving up")
                    _connectionState.value = ConnectionState.FAILED
                }
            }
        }
    }

    private suspend fun attemptReconnect() {
        if (_connectionState.value == ConnectionState.RECONNECTING) {
            return // Already reconnecting
        }

        _connectionState.value = ConnectionState.RECONNECTING
        reconnectAttempts++

        val delay = calculateBackoffDelay(reconnectAttempts)
        Timber.i("Reconnecting in ${delay}ms (attempt $reconnectAttempts/$MAX_RECONNECT_ATTEMPTS)")

        delay(delay)

        val localUserId = userId
        val localToken = token
        if (localUserId != null && localToken != null) {
            connect(localUserId, localToken)
        } else {
            Timber.e("Cannot reconnect: userId or token is null")
            _connectionState.value = ConnectionState.FAILED
        }
    }

    private fun calculateBackoffDelay(attempt: Int): Long {
        val exponentialDelay = INITIAL_RECONNECT_DELAY_MS * (2.0.pow(attempt - 1)).toLong()
        return min(exponentialDelay, MAX_RECONNECT_DELAY_MS)
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && isConnected()) {
                delay(HEARTBEAT_INTERVAL_MS)

                val localUserId = userId
                if (localUserId != null) {
                    val ping = SignalingMessage.Ping(
                        from = localUserId,
                        to = "server",
                        timestamp = System.currentTimeMillis()
                    )
                    send(ping)
                }
            }
        }
    }

    private suspend fun flushMessageQueue() {
        Timber.d("Flushing message queue (${messageQueue.size} messages)")
        while (messageQueue.isNotEmpty() && isConnected()) {
            val message = messageQueue.removeFirst()
            send(message)
            delay(100) // Small delay to avoid overwhelming the server
        }
    }

    private fun createEnvelope(message: SignalingMessage): SignalingEnvelope {
        val type = when (message) {
            is SignalingMessage.Offer -> "offer"
            is SignalingMessage.Answer -> "answer"
            is SignalingMessage.IceCandidate -> "ice_candidate"
            is SignalingMessage.Bye -> "bye"
            is SignalingMessage.Ping -> "ping"
            is SignalingMessage.Pong -> "pong"
        }

        return SignalingEnvelope(
            type = type,
            payload = json.encodeToJsonElement(
                serializer = SignalingMessage.serializer(),
                value = message
            )
        )
    }

    private fun parseMessage(envelope: SignalingEnvelope): SignalingMessage {
        return json.decodeFromJsonElement(
            deserializer = SignalingMessage.serializer(),
            element = envelope.payload
        )
    }

    fun cleanup() {
        scope.cancel()
        heartbeatJob?.cancel()
        webSocket?.close(1000, "Cleanup")
    }
}
