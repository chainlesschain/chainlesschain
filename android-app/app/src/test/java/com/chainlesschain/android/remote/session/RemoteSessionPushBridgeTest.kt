package com.chainlesschain.android.remote.session

import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Base64

/**
 * Covers the process-wide seam that lets a FirebaseMessagingService onNewToken
 * reach the live Remote Session client.
 */
class RemoteSessionPushBridgeTest {

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

    @After
    fun tearDown() {
        RemoteSessionPushBridge.activeClient = null
    }

    @Test
    fun `onNewToken with no active client is a no-op`() {
        RemoteSessionPushBridge.activeClient = null
        RemoteSessionPushBridge.onNewToken("fcm-token") // must not throw
    }

    @Test
    fun `blank tokens are ignored`() {
        RemoteSessionPushBridge.activeClient =
            RemoteSessionClient(webSocketFactory = { _, _ -> FakeWebSocket() })
        RemoteSessionPushBridge.onNewToken("   ") // must not throw / propagate
    }

    @Test
    fun `onNewToken routes the token into the active client`() {
        val host = RemoteSessionCrypto("session-1", "host-peer")
        val fake = FakeWebSocket()
        var listener: WebSocketListener? = null
        val client = RemoteSessionClient(webSocketFactory = { _, l -> listener = l; fake })
        RemoteSessionPushBridge.activeClient = client

        // Simulate FCM handing us a token before the session pairs.
        RemoteSessionPushBridge.onNewToken("fcm-bridged")

        client.connect(pairingUri(host))
        listener!!.onMessage(fake, JSONObject().put("type", "registered").toString())
        val payload = fake.sent.map { JSONObject(it) }
            .first { it.optJSONObject("payload")?.optString("type") == "remote-session.pair" }
            .getJSONObject("payload")
        host.pair(payload.getString("mobilePublicKey"), "token-abc")
        val join = host.decrypt(
            RemoteEncryptedEnvelope.fromJson(payload.getJSONObject("envelope")),
        )
        assertEquals("fcm-bridged", join.getString("pushToken"))
        assertEquals("fcm", join.getString("pushProvider"))
    }

    @Test
    fun `onNewToken carries a non-default provider tag`() {
        val host = RemoteSessionCrypto("session-1", "host-peer")
        val fake = FakeWebSocket()
        var listener: WebSocketListener? = null
        val client = RemoteSessionClient(webSocketFactory = { _, l -> listener = l; fake })
        RemoteSessionPushBridge.activeClient = client

        // A vivo receiver hands us a regId, tagged with the vivo provider.
        RemoteSessionPushBridge.onNewToken("vivo-regid", VivoTokenProvider.PROVIDER)

        client.connect(pairingUri(host))
        listener!!.onMessage(fake, JSONObject().put("type", "registered").toString())
        val payload = fake.sent.map { JSONObject(it) }
            .first { it.optJSONObject("payload")?.optString("type") == "remote-session.pair" }
            .getJSONObject("payload")
        host.pair(payload.getString("mobilePublicKey"), "token-abc")
        val join = host.decrypt(
            RemoteEncryptedEnvelope.fromJson(payload.getJSONObject("envelope")),
        )
        assertEquals("vivo-regid", join.getString("pushToken"))
        assertEquals("vivo", join.getString("pushProvider"))
    }
}
