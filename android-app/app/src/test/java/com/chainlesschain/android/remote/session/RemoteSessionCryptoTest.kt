package com.chainlesschain.android.remote.session

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Base64

class RemoteSessionCryptoTest {
    @Test
    fun `pairing parser accepts valid fragment payload and rejects expiry`() {
        val payload = JSONObject()
            .put("v", 1)
            .put("relayUrl", "wss://relay.example.test")
            .put("remoteSessionId", "remote-1")
            .put("hostPeerId", "desktop")
            .put("hostPublicKey", "key")
            .put("pairingToken", "secret")
            .put("expiresAt", 2_000L)
        val encoded = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.toString().toByteArray())
        val uri = "chainlesschain://remote-session/pair#$encoded"

        assertEquals("remote-1", RemoteSessionPairingParser.parse(uri, 1_000L).remoteSessionId)
        assertThrows(IllegalArgumentException::class.java) {
            RemoteSessionPairingParser.parse(uri, 2_001L)
        }
    }

    @Test
    fun `x25519 hkdf and aes gcm round trip between peers`() {
        val host = RemoteSessionCrypto("remote-1", "host")
        val phone = RemoteSessionCrypto("remote-1", "phone")
        host.pair(phone.publicKeyBase64(), "pairing-secret")
        phone.pair(host.publicKeyBase64(), "pairing-secret")

        val envelope = host.encrypt(JSONObject().put("type", "assistant.delta").put("content", "hello"))
        assertFalse(envelope.ciphertext.contains("hello"))
        assertEquals("hello", phone.decrypt(envelope).getString("content"))
    }

    @Test
    fun `replay and tampering are rejected without consuming valid envelope`() {
        val host = RemoteSessionCrypto("remote-1", "host")
        val phone = RemoteSessionCrypto("remote-1", "phone")
        host.pair(phone.publicKeyBase64(), "pairing-secret")
        phone.pair(host.publicKeyBase64(), "pairing-secret")
        val envelope = host.encrypt(JSONObject().put("type", "ping"))
        val tampered = envelope.copy(ciphertext = envelope.ciphertext.dropLast(1) + "A")

        assertThrows(Exception::class.java) { phone.decrypt(tampered) }
        assertEquals("ping", phone.decrypt(envelope).getString("type"))
        assertThrows(IllegalArgumentException::class.java) { phone.decrypt(envelope) }
    }
}
