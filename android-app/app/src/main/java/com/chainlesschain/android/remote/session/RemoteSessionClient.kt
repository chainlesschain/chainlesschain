package com.chainlesschain.android.remote.session

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.min

enum class RemoteSessionStatus {
    IDLE,
    CONNECTING,
    PAIRING,
    CONNECTED,
    RECONNECTING,
    DISCONNECTED,
    REVOKED,
    ERROR,
}

/** Injectable delayed scheduler so reconnect timing is deterministic in tests. */
fun interface RemoteReconnectScheduler {
    fun schedule(delayMs: Long, task: () -> Unit): AutoCloseable
}

private class RealReconnectScheduler : RemoteReconnectScheduler {
    private val executor = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "remote-session-reconnect").apply { isDaemon = true }
    }

    override fun schedule(delayMs: Long, task: () -> Unit): AutoCloseable {
        val future = executor.schedule(task, delayMs, TimeUnit.MILLISECONDS)
        return AutoCloseable { future.cancel(false) }
    }
}

class RemoteSessionClient(
    private val webSocketFactory: (String, WebSocketListener) -> WebSocket,
    private val reconnectBaseMs: Long = 1_000L,
    private val reconnectMaxMs: Long = 30_000L,
    private val maxReconnectAttempts: Int = Int.MAX_VALUE,
    private val scheduler: RemoteReconnectScheduler = RealReconnectScheduler(),
) {
    constructor(httpClient: OkHttpClient) : this(
        webSocketFactory = { url, listener ->
            httpClient.newWebSocket(Request.Builder().url(url).build(), listener)
        },
    )
    private val _status = MutableStateFlow(RemoteSessionStatus.IDLE)
    val status: StateFlow<RemoteSessionStatus> = _status
    private val _events = MutableSharedFlow<JSONObject>(extraBufferCapacity = 64)
    val events: SharedFlow<JSONObject> = _events
    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val errors: SharedFlow<String> = _errors

    private var socket: WebSocket? = null
    private var pairing: RemoteSessionPairing? = null
    private var crypto: RemoteSessionCrypto? = null
    private var peerId: String? = null
    val currentPairing: RemoteSessionPairing? get() = pairing
    val localPeerId: String? get() = peerId

    // Optional vendor-push credentials. When set before pairing, they ride along
    // in the encrypted pair.join so the host can wake this device for approval
    // requests while the app is backgrounded. Sourcing the actual FCM/HMS token
    // (FirebaseMessaging.getInstance().token) is left to the app layer; this
    // client just forwards whatever it is handed.
    private var pushToken: String? = null
    private var pushProvider: String? = null

    /** Provide (or clear, with null) the vendor push token used for wake-ups. */
    fun setPushCredentials(token: String?, provider: String? = null) {
        pushToken = token?.takeIf { it.isNotBlank() }
        pushProvider = if (pushToken != null) provider else null
    }

    /**
     * Update the vendor push token AFTER pairing (e.g. FCM onNewToken). Records
     * it for the next pair.join and, when already paired, forwards the change to
     * the host now via an encrypted push.register control event so an in-flight
     * session starts using the fresh token immediately. A null token clears it.
     */
    fun updatePushCredentials(token: String?, provider: String? = null) {
        setPushCredentials(token, provider)
        if (!paired) return
        val event = JSONObject().put("type", "push.register")
        pushToken?.let { event.put("pushToken", it) }
        pushProvider?.let { event.put("pushProvider", it) }
        sendControl(event)
    }

    // Idempotency (Phase 5): every control event carries a commandId + a
    // per-pairing monotonic seq INSIDE the encrypted plaintext (the host reads
    // event.commandId after decryption via its RemoteCommandLedger). The relay
    // is at-least-once — it stores and REDELIVERS offline-messages — so
    // without the id a redelivered prompt would run a second agent turn.
    private val controlSeq = java.util.concurrent.atomic.AtomicLong(0)

    // Reconnect state. The pairing token is single-use, so a reconnect within
    // the same process lifetime re-registers with the relay and resumes on the
    // already-derived shared secret instead of re-pairing.
    private var paired = false
    private var closedExplicitly = false
    private var reconnectAttempts = 0
    private var reconnectTask: AutoCloseable? = null

    fun connect(uri: String) {
        disconnect()
        val parsed = RemoteSessionPairingParser.parse(uri)
        val mobilePeerId = "android-${UUID.randomUUID()}"
        val context = RemoteSessionCrypto(parsed.remoteSessionId, mobilePeerId).apply {
            pair(parsed.hostPublicKey, parsed.pairingToken)
        }
        pairing = parsed
        crypto = context
        peerId = mobilePeerId
        paired = false
        closedExplicitly = false
        reconnectAttempts = 0
        // Fresh pairing = fresh peerId = fresh per-device seq space on the host.
        controlSeq.set(0)
        _status.value = RemoteSessionStatus.CONNECTING
        openSocket()
    }

    private fun openSocket() {
        val activePairing = pairing ?: return
        socket = webSocketFactory(activePairing.relayUrl, listener)
    }

    fun sendPrompt(content: String) = sendControl(
        JSONObject().put("type", "prompt").put("content", content),
    )

    fun resolveApproval(requestId: String, approved: Boolean) = sendControl(
        JSONObject()
            .put("type", "approval.resolve")
            .put("requestId", requestId)
            .put("approved", approved),
    )

    fun interrupt() = sendControl(JSONObject().put("type", "interrupt"))

    fun disconnect() {
        closedExplicitly = true
        paired = false
        cancelReconnect()
        socket?.close(1000, "Android Remote Session closed")
        socket = null
        _status.value = RemoteSessionStatus.DISCONNECTED
    }

    private fun sendControl(event: JSONObject): Boolean {
        val activeSocket = socket ?: return false
        val activePairing = pairing ?: return false
        if (!paired) return false
        // Stamp the idempotency key before encryption (the host only sees the
        // decrypted event). A caller-supplied commandId is preserved so an
        // explicit retry of the same logical command stays deduplicable.
        if (!event.has("commandId")) event.put("commandId", UUID.randomUUID().toString())
        if (!event.has("seq")) event.put("seq", controlSeq.incrementAndGet())
        val envelope = requireNotNull(crypto).encrypt(event)
        return activeSocket.send(
            JSONObject()
                .put("type", "message")
                .put("to", activePairing.hostPeerId)
                .put(
                    "payload",
                    JSONObject()
                        .put("type", "remote-session.encrypted")
                        .put("envelope", envelope.toJson()),
                )
                .toString(),
        )
    }

    private fun sendPairRequest(webSocket: WebSocket) {
        val activePairing = requireNotNull(pairing)
        val activeCrypto = requireNotNull(crypto)
        val joinPayload = JSONObject()
            .put("type", "pair.join")
            .put("remoteSessionId", activePairing.remoteSessionId)
            .put("token", activePairing.pairingToken)
        pushToken?.let { joinPayload.put("pushToken", it) }
        pushProvider?.let { joinPayload.put("pushProvider", it) }
        val envelope = activeCrypto.encrypt(joinPayload)
        webSocket.send(
            JSONObject()
                .put("type", "message")
                .put("to", activePairing.hostPeerId)
                .put(
                    "payload",
                    JSONObject()
                        .put("type", "remote-session.pair")
                        .put("mobilePeerId", peerId)
                        .put("mobilePublicKey", activeCrypto.publicKeyBase64())
                        .put("envelope", envelope.toJson()),
                )
                .toString(),
        )
    }

    private fun handleMessage(text: String) {
        runCatching {
            var message = JSONObject(text)
            if (message.optString("type") == "offline-message") {
                message = message.getJSONObject("originalMessage")
            }
            when (message.optString("type")) {
                "registered" -> {
                    if (paired) {
                        // Reconnected after a transient drop — the shared secret
                        // is still valid, so resume without consuming a token.
                        _status.value = RemoteSessionStatus.CONNECTED
                    } else {
                        _status.value = RemoteSessionStatus.PAIRING
                        sendPairRequest(requireNotNull(socket))
                    }
                }
                "message" -> {
                    val payload = message.optJSONObject("payload") ?: return@runCatching
                    if (payload.optString("type") != "remote-session.encrypted") return@runCatching
                    val event = requireNotNull(crypto).decrypt(
                        RemoteEncryptedEnvelope.fromJson(payload.getJSONObject("envelope")),
                    )
                    when (event.optString("type")) {
                        "pair.accepted" -> {
                            paired = true
                            reconnectAttempts = 0
                            _status.value = RemoteSessionStatus.CONNECTED
                        }
                        "session.revoked" -> {
                            closedExplicitly = true
                            paired = false
                            cancelReconnect()
                            socket?.close(1000, "Revoked by host")
                            socket = null
                            _status.value = RemoteSessionStatus.REVOKED
                        }
                        else -> _events.tryEmit(event)
                    }
                }
                else -> Unit
            }
        }.onFailure {
            _status.value = RemoteSessionStatus.ERROR
            _errors.tryEmit(it.message ?: "Remote Session protocol error")
        }
    }

    private fun scheduleReconnect() {
        if (closedExplicitly || reconnectTask != null || reconnectAttempts >= maxReconnectAttempts) {
            _status.value = RemoteSessionStatus.DISCONNECTED
            return
        }
        val delay = min(reconnectBaseMs * (1L shl reconnectAttempts.coerceAtMost(20)), reconnectMaxMs)
        reconnectAttempts += 1
        _status.value = RemoteSessionStatus.RECONNECTING
        reconnectTask = scheduler.schedule(delay) {
            reconnectTask = null
            if (!closedExplicitly) openSocket()
        }
    }

    private fun cancelReconnect() {
        reconnectTask?.close()
        reconnectTask = null
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send(
                JSONObject()
                    .put("type", "register")
                    .put("peerId", peerId)
                    .put("deviceType", "mobile")
                    .put("deviceInfo", JSONObject().put("protocol", "remote-session.e2ee.v1"))
                    .toString(),
            )
        }

        override fun onMessage(webSocket: WebSocket, text: String) = handleMessage(text)
        override fun onMessage(webSocket: WebSocket, bytes: ByteString) = handleMessage(bytes.utf8())

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (webSocket !== socket) return
            socket = null
            if (closedExplicitly) {
                _status.value = RemoteSessionStatus.DISCONNECTED
            } else {
                scheduleReconnect()
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (webSocket !== socket) return
            socket = null
            _errors.tryEmit(t.message ?: "Remote Session relay failed")
            if (closedExplicitly) {
                _status.value = RemoteSessionStatus.ERROR
            } else {
                scheduleReconnect()
            }
        }
    }
}
