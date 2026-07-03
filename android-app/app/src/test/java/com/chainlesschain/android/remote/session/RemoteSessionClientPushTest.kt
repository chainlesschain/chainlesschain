package com.chainlesschain.android.remote.session

import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.util.Base64

/**
 * Verifies that a vendor push token set before pairing rides inside the
 * encrypted pair.join — decrypted here with a host-side crypto context to prove
 * the host actually receives pushToken/pushProvider.
 */
class RemoteSessionClientPushTest {

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

    /** Drive connect → registered, returning the decrypted pair.join seen by the host. */
    private fun capturePairJoin(configure: (RemoteSessionClient) -> Unit): JSONObject {
        val host = RemoteSessionCrypto("session-1", "host-peer")
        val fake = FakeWebSocket()
        var listener: WebSocketListener? = null
        val client = RemoteSessionClient(
            webSocketFactory = { _, l -> listener = l; fake },
        )
        configure(client)
        client.connect(pairingUri(host))
        // The relay confirms registration; the client then sends its pair.join.
        listener!!.onMessage(fake, JSONObject().put("type", "registered").toString())

        val pairMessage = fake.sent
            .map { JSONObject(it) }
            .first { it.optJSONObject("payload")?.optString("type") == "remote-session.pair" }
        val payload = pairMessage.getJSONObject("payload")
        host.pair(payload.getString("mobilePublicKey"), "token-abc")
        return host.decrypt(
            RemoteEncryptedEnvelope.fromJson(payload.getJSONObject("envelope")),
        )
    }

    @Test
    fun `push credentials set before pairing are carried in pair join`() {
        val join = capturePairJoin { it.setPushCredentials("fcm-token-xyz", "fcm") }
        assertEquals("pair.join", join.getString("type"))
        assertEquals("token-abc", join.getString("token"))
        assertEquals("fcm-token-xyz", join.getString("pushToken"))
        assertEquals("fcm", join.getString("pushProvider"))
    }

    @Test
    fun `pair join omits push fields when no token is set`() {
        val join = capturePairJoin { /* no push credentials */ }
        assertEquals("pair.join", join.getString("type"))
        assertFalse(join.has("pushToken"))
        assertFalse(join.has("pushProvider"))
    }

    @Test
    fun `clearing the token drops the push fields`() {
        val join = capturePairJoin {
            it.setPushCredentials("fcm-token-xyz", "fcm")
            it.setPushCredentials(null, "fcm")
        }
        assertFalse(join.has("pushToken"))
        assertFalse(join.has("pushProvider"))
    }

    @Test
    fun `updatePushCredentials before pairing only rides the next pair join`() {
        // Not yet paired → nothing is sent inline; the token rides pair.join.
        val join = capturePairJoin { it.updatePushCredentials("fcm-early", "fcm") }
        assertEquals("fcm-early", join.getString("pushToken"))
        assertEquals("fcm", join.getString("pushProvider"))
    }

    @Test
    fun `updatePushCredentials after pairing forwards an encrypted push register`() {
        val host = RemoteSessionCrypto("session-1", "host-peer")
        val fake = FakeWebSocket()
        var listener: WebSocketListener? = null
        val client = RemoteSessionClient(webSocketFactory = { _, l -> listener = l; fake })
        client.connect(pairingUri(host))
        listener!!.onMessage(fake, JSONObject().put("type", "registered").toString())

        // Host finishes pairing (decrypt join, derive key) and confirms.
        val pairPayload = fake.sent.map { JSONObject(it) }
            .first { it.optJSONObject("payload")?.optString("type") == "remote-session.pair" }
            .getJSONObject("payload")
        host.pair(pairPayload.getString("mobilePublicKey"), "token-abc")
        host.decrypt(RemoteEncryptedEnvelope.fromJson(pairPayload.getJSONObject("envelope")))
        val accepted = JSONObject()
            .put("type", "message")
            .put(
                "payload",
                JSONObject()
                    .put("type", "remote-session.encrypted")
                    .put("envelope", host.encrypt(JSONObject().put("type", "pair.accepted")).toJson()),
            )
        listener!!.onMessage(fake, accepted.toString())
        assertEquals(RemoteSessionStatus.CONNECTED, client.status.value)

        // A token rotation now reaches the host as an encrypted push.register.
        val before = fake.sent.size
        client.updatePushCredentials("fcm-rotated", "fcm")
        val control = fake.sent.drop(before).map { JSONObject(it) }
            .first { it.optJSONObject("payload")?.optString("type") == "remote-session.encrypted" }
        val event = host.decrypt(
            RemoteEncryptedEnvelope.fromJson(control.getJSONObject("payload").getJSONObject("envelope")),
        )
        assertEquals("push.register", event.getString("type"))
        assertEquals("fcm-rotated", event.getString("pushToken"))
        assertEquals("fcm", event.getString("pushProvider"))
    }
}
