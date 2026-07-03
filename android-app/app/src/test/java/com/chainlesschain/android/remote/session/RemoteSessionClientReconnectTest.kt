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
        override fun request(): Request = Request.Builder().url("http://localhost").build()
        override fun queueSize(): Long = 0
        override fun send(text: String): Boolean { sent += text; return true }
        override fun send(bytes: ByteString): Boolean { sent += bytes.utf8(); return true }
        override fun close(code: Int, reason: String?): Boolean = true
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

    private fun pairingUri(): String {
        val hostPublicKey = RemoteSessionCrypto("session-1", "host-peer").publicKeyBase64()
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
}
