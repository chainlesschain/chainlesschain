package com.chainlesschain.android.remote.session

import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * Framework-free JVM coverage for the Remote Session auto-reconnect state
 * machine: transient drops back off exponentially and resume without consuming
 * a fresh pairing token, while an explicit disconnect stops reconnecting.
 */
class RemoteSessionClientReconnectTest {

    private class FakeWebSocket : WebSocket {
        val sent = mutableListOf<String>()
        var closeCode: Int? = null
        var closeReason: String? = null
        override fun request(): Request = Request.Builder().url("http://localhost").build()
        override fun queueSize(): Long = 0
        override fun send(text: String): Boolean { sent += text; return true }
        override fun send(bytes: ByteString): Boolean { sent += bytes.utf8(); return true }
        override fun close(code: Int, reason: String?): Boolean {
            closeCode = code
            closeReason = reason
            return true
        }
        override fun cancel() {}
    }

    private class RecordingScheduler : RemoteReconnectScheduler {
        val delays = mutableListOf<Long>()
        private var pending: (() -> Unit)? = null
        override fun schedule(delayMs: Long, task: () -> Unit): AutoCloseable {
            delays += delayMs
            pending = task
            return AutoCloseable { pending = null }
        }
        fun fire() {
            val task = pending
            pending = null
            task?.invoke()
        }
        fun hasPending() = pending != null
    }

    private fun pairingUri(
        host: RemoteSessionCrypto = RemoteSessionCrypto("session-1", "host-peer"),
    ): String {
        val hostPublicKey = host.publicKeyBase64()
        val payload = JSONObject()
            .put("v", 1)
            .put("relayUrl", "wss://relay.example.test")
            .put("remoteSessionId", "session-1")
            .put("hostPeerId", "host-peer")
            .put("hostPublicKey", hostPublicKey)
            .put("pairingToken", "token-abc")
            .toString()
        val encoded = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.toByteArray(Charsets.UTF_8))
        return "chainlesschain://remote-session/pair#$encoded"
    }

    @Test
    fun `transient drops reconnect with exponential backoff`() {
        val sockets = mutableListOf<FakeWebSocket>()
        var listener: WebSocketListener? = null
        val scheduler = RecordingScheduler()
        val client = RemoteSessionClient(
            webSocketFactory = { _, l ->
                listener = l
                FakeWebSocket().also { sockets += it }
            },
            reconnectBaseMs = 1_000L,
            reconnectMaxMs = 30_000L,
            scheduler = scheduler,
        )

        client.connect(pairingUri())
        assertEquals(1, sockets.size)

        // Three consecutive transient drops → 1s, 2s, 4s backoff.
        repeat(3) { index ->
            listener!!.onClosed(sockets.last(), 1006, "drop")
            assertEquals(RemoteSessionStatus.RECONNECTING, client.status.value)
            scheduler.fire()
            assertEquals(index + 2, sockets.size)
        }
        assertEquals(listOf(1_000L, 2_000L, 4_000L), scheduler.delays)
    }

    @Test
    fun `explicit disconnect stops reconnecting`() {
        val sockets = mutableListOf<FakeWebSocket>()
        var listener: WebSocketListener? = null
        val scheduler = RecordingScheduler()
        val client = RemoteSessionClient(
            webSocketFactory = { _, l ->
                listener = l
                FakeWebSocket().also { sockets += it }
            },
            scheduler = scheduler,
        )

        client.connect(pairingUri())
        val active = sockets.last()
        client.disconnect()
        assertEquals(RemoteSessionStatus.DISCONNECTED, client.status.value)

        // A close callback for the already-torn-down socket must not reconnect.
        listener!!.onClosed(active, 1000, "closed")
        assertTrue(!scheduler.hasPending())
        assertEquals(1, sockets.size)
    }

    @Test
    fun `reconnect attempts are bounded`() {
        val sockets = mutableListOf<FakeWebSocket>()
        var listener: WebSocketListener? = null
        val scheduler = RecordingScheduler()
        val client = RemoteSessionClient(
            webSocketFactory = { _, l ->
                listener = l
                FakeWebSocket().also { sockets += it }
            },
            maxReconnectAttempts = 1,
            scheduler = scheduler,
        )

        client.connect(pairingUri())
        listener!!.onClosed(sockets.last(), 1006, "drop")
        scheduler.fire()
        assertEquals(2, sockets.size)

        // Second drop exceeds the attempt budget → give up, no more sockets.
        listener!!.onClosed(sockets.last(), 1006, "drop")
        assertEquals(RemoteSessionStatus.DISCONNECTED, client.status.value)
        assertTrue(!scheduler.hasPending())
        assertEquals(2, sockets.size)
    }

    @Test
    fun `lost pair accepted retransmits the same credential-bound join`() {
        val host = RemoteSessionCrypto("session-1", "host-peer")
        val socket = FakeWebSocket()
        var listener: WebSocketListener? = null
        val scheduler = RecordingScheduler()
        val client = RemoteSessionClient(
            webSocketFactory = { _, l -> listener = l; socket },
            scheduler = scheduler,
            pairAckTimeoutMs = 5_000L,
            pairAckScheduler = scheduler,
        )

        client.connect(pairingUri(host))
        listener!!.onMessage(socket, JSONObject().put("type", "registered").toString())
        val first = socket.sent.map(::JSONObject)
            .first { it.optJSONObject("payload")?.optString("type") == "remote-session.pair" }
            .getJSONObject("payload")
        host.pair(first.getString("mobilePublicKey"), "token-abc")
        val firstJoin = host.decrypt(
            RemoteEncryptedEnvelope.fromJson(first.getJSONObject("envelope")),
        )
        assertEquals(RemoteSessionStatus.PAIRING, client.status.value)
        assertEquals(listOf(5_000L), scheduler.delays)

        // Treat the first pair.accepted as lost. The timeout emits a new AEAD
        // envelope but preserves the exact peer/key/token authority tuple.
        scheduler.fire()
        val attempts = socket.sent.map(::JSONObject)
            .filter { it.optJSONObject("payload")?.optString("type") == "remote-session.pair" }
            .map { it.getJSONObject("payload") }
        assertEquals(2, attempts.size)
        val second = attempts[1]
        val secondJoin = host.decrypt(
            RemoteEncryptedEnvelope.fromJson(second.getJSONObject("envelope")),
        )
        assertEquals(first.getString("mobilePeerId"), second.getString("mobilePeerId"))
        assertEquals(first.getString("mobilePublicKey"), second.getString("mobilePublicKey"))
        assertEquals(firstJoin.getString("token"), secondJoin.getString("token"))
        assertTrue(
            second.getJSONObject("envelope").getLong("sequence") >
                first.getJSONObject("envelope").getLong("sequence"),
        )

        listener!!.onMessage(
            socket,
            JSONObject()
                .put("type", "message")
                .put(
                    "payload",
                    JSONObject()
                        .put("type", "remote-session.encrypted")
                        .put(
                            "envelope",
                            host.encrypt(JSONObject().put("type", "pair.accepted")).toJson(),
                        ),
                )
                .toString(),
        )
        assertEquals(RemoteSessionStatus.CONNECTED, client.status.value)
        assertTrue(!scheduler.hasPending())
    }

    @Test
    fun `pair ACK retry budget survives relay reconnect and ends in error`() {
        val sockets = mutableListOf<FakeWebSocket>()
        var listener: WebSocketListener? = null
        val reconnectScheduler = RecordingScheduler()
        val ackScheduler = RecordingScheduler()
        val client = RemoteSessionClient(
            webSocketFactory = { _, l ->
                listener = l
                FakeWebSocket().also { sockets += it }
            },
            maxReconnectAttempts = Int.MAX_VALUE,
            scheduler = reconnectScheduler,
            maxPairAckRetries = 1,
            pairAckScheduler = ackScheduler,
        )

        client.connect(pairingUri())
        listener!!.onMessage(
            sockets[0],
            JSONObject().put("type", "registered").toString(),
        )
        assertTrue(ackScheduler.hasPending())

        // Losing the transport also loses the ACK timer, but must not grant a
        // fresh pair.join budget to the replacement connection.
        listener!!.onClosed(sockets[0], 1006, "drop before ACK")
        assertTrue(!ackScheduler.hasPending())
        reconnectScheduler.fire()
        assertEquals(2, sockets.size)
        listener!!.onMessage(
            sockets[1],
            JSONObject().put("type", "registered").toString(),
        )
        assertTrue(ackScheduler.hasPending())

        // Initial send + one configured retry are the whole-operation budget.
        // Its expiry is terminal and must not feed the ordinary reconnect loop.
        ackScheduler.fire()
        assertEquals(RemoteSessionStatus.ERROR, client.status.value)
        assertEquals(1001, sockets[1].closeCode)
        assertTrue(sockets[1].closeReason!!.contains("retry budget exhausted"))
        assertTrue(!reconnectScheduler.hasPending())
        assertEquals(
            2,
            sockets.sumOf { socket ->
                socket.sent.map(::JSONObject).count {
                    it.optJSONObject("payload")?.optString("type") == "remote-session.pair"
                }
            },
        )
    }
}
