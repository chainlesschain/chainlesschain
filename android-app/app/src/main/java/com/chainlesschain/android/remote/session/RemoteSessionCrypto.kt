package com.chainlesschain.android.remote.session

import org.bouncycastle.math.ec.rfc7748.X25519
import org.json.JSONObject
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

private const val PROTOCOL = "chainlesschain.remote-session.e2ee.v1"
private const val PAIRING_PREFIX = "chainlesschain://remote-session/pair#"

data class RemoteSessionPairing(
    val relayUrl: String,
    val remoteSessionId: String,
    val hostPeerId: String,
    val hostPublicKey: String,
    val pairingToken: String,
    val expiresAt: Long?,
)

data class RemoteEncryptedEnvelope(
    val version: Int = 1,
    val sessionId: String,
    val senderId: String,
    val sequence: Long,
    val nonce: String,
    val ciphertext: String,
    val tag: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("v", version)
        .put("sessionId", sessionId)
        .put("senderId", senderId)
        .put("sequence", sequence)
        .put("nonce", nonce)
        .put("ciphertext", ciphertext)
        .put("tag", tag)

    companion object {
        fun fromJson(json: JSONObject) = RemoteEncryptedEnvelope(
            version = json.getInt("v"),
            sessionId = json.getString("sessionId"),
            senderId = json.getString("senderId"),
            sequence = json.getLong("sequence"),
            nonce = json.getString("nonce"),
            ciphertext = json.getString("ciphertext"),
            tag = json.getString("tag"),
        )
    }
}

object RemoteSessionPairingParser {
    fun parse(uri: String, now: Long = System.currentTimeMillis()): RemoteSessionPairing {
        require(uri.startsWith(PAIRING_PREFIX)) { "Invalid Remote Session pairing URI" }
        val parsed = runCatching {
            val bytes = decode(uri.removePrefix(PAIRING_PREFIX))
            JSONObject(String(bytes, StandardCharsets.UTF_8))
        }.getOrElse { throw IllegalArgumentException("Malformed Remote Session pairing payload", it) }
        require(parsed.optInt("v") == 1) { "Unsupported Remote Session pairing version" }
        val expiresAt = parsed.optLong("expiresAt", 0L).takeIf { it > 0 }
        require(expiresAt == null || expiresAt > now) { "Remote Session pairing payload expired" }
        return RemoteSessionPairing(
            relayUrl = parsed.required("relayUrl"),
            remoteSessionId = parsed.required("remoteSessionId"),
            hostPeerId = parsed.required("hostPeerId"),
            hostPublicKey = parsed.required("hostPublicKey"),
            pairingToken = parsed.required("pairingToken"),
            expiresAt = expiresAt,
        ).also {
            val scheme = runCatching { URI(it.relayUrl).scheme }.getOrNull()
            require(scheme == "ws" || scheme == "wss") { "Remote Session relay must use ws or wss" }
        }
    }

    private fun JSONObject.required(name: String): String =
        optString(name).takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("Missing Remote Session pairing field: $name")
}

class RemoteSessionCrypto(
    private val sessionId: String,
    val localPeerId: String,
    private val random: SecureRandom = SecureRandom(),
) {
    private val privateKey = ByteArray(X25519.SCALAR_SIZE).also { X25519.generatePrivateKey(random, it) }
    val publicKey: ByteArray = ByteArray(X25519.POINT_SIZE).also {
        X25519.generatePublicKey(privateKey, 0, it, 0)
    }
    private var key: ByteArray? = null
    private var sendSequence = 0L
    private val receivedSequences = mutableMapOf<String, Long>()

    fun pair(hostPublicKey: String, pairingToken: String) {
        val encoded = decode(hostPublicKey)
        val raw = if (encoded.size == X25519.POINT_SIZE) encoded else encoded.takeLast(X25519.POINT_SIZE).toByteArray()
        require(raw.size == X25519.POINT_SIZE) { "Invalid X25519 host public key" }
        val shared = ByteArray(X25519.POINT_SIZE)
        require(X25519.calculateAgreement(privateKey, 0, raw, 0, shared, 0)) {
            "Invalid X25519 shared secret"
        }
        val salt = MessageDigest.getInstance("SHA-256")
            .digest(pairingToken.toByteArray(StandardCharsets.UTF_8))
        key = hkdfSha256(shared, salt, "$PROTOCOL:$sessionId".toByteArray(), 32)
        shared.fill(0)
    }

    fun encrypt(message: JSONObject): RemoteEncryptedEnvelope {
        val activeKey = requireNotNull(key) { "Remote Session is not paired" }
        val sequence = ++sendSequence
        val nonce = ByteArray(12).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(activeKey, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad(localPeerId, sequence))
        val sealed = cipher.doFinal(message.toString().toByteArray(StandardCharsets.UTF_8))
        return RemoteEncryptedEnvelope(
            sessionId = sessionId,
            senderId = localPeerId,
            sequence = sequence,
            nonce = encode(nonce),
            ciphertext = encode(sealed.copyOfRange(0, sealed.size - 16)),
            tag = encode(sealed.copyOfRange(sealed.size - 16, sealed.size)),
        )
    }

    fun decrypt(envelope: RemoteEncryptedEnvelope): JSONObject {
        require(envelope.version == 1 && envelope.sessionId == sessionId) { "Invalid Remote Session envelope" }
        val previous = receivedSequences[envelope.senderId] ?: 0L
        require(envelope.sequence > previous) { "Remote Session replay or out-of-order envelope" }
        val activeKey = requireNotNull(key) { "Remote Session is not paired" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(activeKey, "AES"), GCMParameterSpec(128, decode(envelope.nonce)))
        cipher.updateAAD(aad(envelope.senderId, envelope.sequence))
        val sealed = decode(envelope.ciphertext) + decode(envelope.tag)
        val plaintext = cipher.doFinal(sealed)
        receivedSequences[envelope.senderId] = envelope.sequence
        return JSONObject(String(plaintext, StandardCharsets.UTF_8))
    }

    fun publicKeyBase64(): String = encode(publicKey)

    private fun aad(senderId: String, sequence: Long) =
        "$PROTOCOL\n$sessionId\n$senderId\n$sequence".toByteArray(StandardCharsets.UTF_8)
}

private fun hkdfSha256(input: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(salt, "HmacSHA256"))
    val prk = mac.doFinal(input)
    val output = ByteArray(length)
    var previous = ByteArray(0)
    var offset = 0
    var counter = 1
    while (offset < length) {
        mac.init(SecretKeySpec(prk, "HmacSHA256"))
        mac.update(previous)
        mac.update(info)
        mac.update(counter.toByte())
        previous = mac.doFinal()
        val count = minOf(previous.size, length - offset)
        previous.copyInto(output, offset, 0, count)
        offset += count
        counter += 1
    }
    prk.fill(0)
    return output
}

private fun encode(value: ByteArray): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(value)

private fun decode(value: String): ByteArray = Base64.getUrlDecoder().decode(value)
