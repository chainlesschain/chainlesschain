package com.chainlesschain.android.remote.session

import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * Phase 5 remote-control idempotency: every encrypted control event must carry
 * a commandId + per-pairing monotonic seq so the host's RemoteCommandLedger can
 * dedupe relay redeliveries (the relay is at-least-once: it stores and replays
 * offline-messages). Decrypted host-side to prove the keys survive encryption.
 */
class RemoteSessionClientIdempotencyTest {

    private class FakeWebSocket : WebSocket {
        val sent = mutableListOf<String>()
        override fun request(): Request = Request.Builder().url("http://localhost").build()
        override fun queueSize(): Long = 0
        override fun send(text: String): Boolean { sent += text; return true }
        override fun send(bytes: ByteString): Boolean { sent += bytes.utf8(); return true }
        override fun close(code: Int, reason: String?): Boolean = true
        override fun cancel() {}
    }

    private fun pairingUri(host: RemoteSessionCrypto): String {
        val payload = JSONObject()
            .put("v", 1)
            .put("relayUrl", "wss://relay.example.test")
            .put("remoteSessionId", "session-1")
            .put("hostPeerId", "host-peer")
            .put("hostPublicKey", host.publicKeyBase64())
            .put("pairingToken", "token-abc")
            .toString()
        val encoded = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.toByteArray(Charsets.UTF_8))
        return "chainlesschain://remote-session/pair#$encoded"
    }

    /** One client whose factory hands out a fresh fake socket per connect(). */
    private val sockets = mutableListOf<FakeWebSocket>()
    private var listener: WebSocketListener? = null
    private val client = RemoteSessionClient(
        webSocketFactory = { _, l ->
            listener = l
            FakeWebSocket().also { sockets += it }
        },
    )

    /** Drive connect() → registered → pair.join → pair.accepted on a new host. */
    private fun pair(): RemoteSessionCrypto {
        val host = RemoteSessionCrypto("session-1", "host-peer")
        client.connect(pairingUri(host))
        val fake = sockets.last()
        listener!!.onMessage(fake, JSONObject().put("type", "registered").toString())
        val pairPayload = fake.sent.map { JSONObject(it) }
            .first { it.optJSONObject("payload")?.optString("type") == "remote-session.pair" }
            .getJSONObject("payload")
        host.pair(pairPayload.getString("mobilePublicKey"), "token-abc")
        host.decrypt(RemoteEncryptedEnvelope.fromJson(pairPayload.getJSONObject("envelope")))
        listener!!.onMessage(
            fake,
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
        return host
    }

    private fun decryptControls(host: RemoteSessionCrypto, from: Int): List<JSONObject> =
        sockets.last().sent.drop(from).map { JSONObject(it) }
            .filter { it.optJSONObject("payload")?.optString("type") == "remote-session.encrypted" }
            .map {
                host.decrypt(
                    RemoteEncryptedEnvelope.fromJson(
                        it.getJSONObject("payload").getJSONObject("envelope"),
                    ),
                )
            }

    @Test
    fun `every control event carries a commandId and a monotonic seq`() {
        val host = pair()
        val before = sockets.last().sent.size
        client.sendPrompt("continue")
        client.resolveApproval("req-1", true)
        client.interrupt()

        val controls = decryptControls(host, before)
        assertEquals(3, controls.size)
        assertEquals("prompt", controls[0].getString("type"))
        assertEquals("approval.resolve", controls[1].getString("type"))
        assertEquals("interrupt", controls[2].getString("type"))
        for (event in controls) {
            assertTrue("commandId must be a real id", event.getString("commandId").length > 8)
        }
        // Distinct ids per logical command; strictly monotonic per-pairing seq.
        assertNotEquals(controls[0].getString("commandId"), controls[1].getString("commandId"))
        assertNotEquals(controls[1].getString("commandId"), controls[2].getString("commandId"))
        assertEquals(listOf(1L, 2L, 3L), controls.map { it.getLong("seq") })
    }

    @Test
    fun `re-pairing the same client restarts the seq space`() {
        val firstHost = pair()
        var before = sockets.last().sent.size
        client.sendPrompt("one")
        client.sendPrompt("two")
        assertEquals(listOf(1L, 2L), decryptControls(firstHost, before).map { it.getLong("seq") })

        // A NEW pairing on the SAME client (fresh QR scan → new peerId → new
        // per-device seq space on the host): the counter must reset, not leak.
        val secondHost = pair()
        before = sockets.last().sent.size
        client.sendPrompt("three")
        assertEquals(1L, decryptControls(secondHost, before).single().getLong("seq"))
    }
}
