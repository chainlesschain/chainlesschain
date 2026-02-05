package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.remote.data.AuthInfo
import com.chainlesschain.android.remote.data.CommandResponse
import com.chainlesschain.android.remote.data.EventNotification
import com.chainlesschain.android.remote.data.MessageTypes
import com.chainlesschain.android.remote.data.P2PMessage
import com.chainlesschain.android.remote.data.fromJson
import com.chainlesschain.android.remote.data.toJsonString
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
    private val webRTCClient: WebRTCClient
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val pendingRequests = ConcurrentHashMap<String, PendingRequest>()
    private var heartbeatJob: Job? = null

    private val config = P2PClientConfig()

    private val _events = MutableSharedFlow<EventNotification>(replay = 0, extraBufferCapacity = 16)
    val events: SharedFlow<EventNotification> = _events.asSharedFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _connectedPeer = MutableStateFlow<PeerInfo?>(null)
    val connectedPeer: StateFlow<PeerInfo?> = _connectedPeer.asStateFlow()

    init {
        webRTCClient.initialize()
        webRTCClient.setOnMessageReceived { raw ->
            scope.launch { handleIncoming(raw) }
        }
    }

    suspend fun connect(pcPeerId: String, pcDID: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            if (_connectionState.value == ConnectionState.CONNECTED) {
                disconnect()
            }
            _connectionState.value = ConnectionState.CONNECTING

            val result = webRTCClient.connect(pcPeerId)
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
            startHeartbeat()
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "P2P connect failed")
            _connectionState.value = ConnectionState.ERROR
            Result.failure(e)
        }
    }

    suspend fun <T> sendCommand(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = config.requestTimeout
    ): Result<T> = withContext(Dispatchers.IO) {
        if (_connectionState.value != ConnectionState.CONNECTED) {
            return@withContext Result.failure(Exception("Not connected"))
        }
        try {
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

                if (response.isError()) {
                    return@withContext Result.failure(Exception(response.error?.message ?: "Unknown error"))
                }

                @Suppress("UNCHECKED_CAST")
                Result.success(response.result as T)
            } catch (e: Exception) {
                timeoutJob.cancel()
                pendingRequests.remove(requestId)
                throw e
            }
        } catch (e: Exception) {
            Timber.e(e, "sendCommand failed: $method")
            Result.failure(e)
        }
    }

    fun disconnect() {
        stopHeartbeat()
        webRTCClient.disconnect()
        pendingRequests.forEach { (_, pending) ->
            pending.deferred.completeExceptionally(Exception("Connection closed"))
        }
        pendingRequests.clear()
        _connectedPeer.value = null
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    private suspend fun handleIncoming(raw: String) {
        try {
            val message = raw.fromJson<P2PMessage>()
            when (message.type) {
                MessageTypes.COMMAND_RESPONSE -> {
                    val response = message.payload.fromJson<CommandResponse>()
                    pendingRequests[response.id]?.deferred?.complete(response)
                }
                MessageTypes.EVENT_NOTIFICATION -> {
                    val event = message.payload.fromJson<EventNotification>()
                    _events.emit(event)
                }
                MessageTypes.HEARTBEAT -> {
                    // no-op
                }
                else -> Timber.w("Unknown P2P message type: ${message.type}")
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle incoming message")
        }
    }

    private suspend fun createAuth(method: String): AuthInfo {
        val timestamp = System.currentTimeMillis()
        val nonce = Random.nextInt(100000, 999999).toString()
        val did = didManager.getCurrentDID()
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
    val maxRetries: Int = 3,
    val retryDelay: Long = 1_000
)
