package com.chainlesschain.android.core.did.crypto

import org.junit.Test
import org.junit.Assert.*

/**
 * SignatureUtils单元测试
 */
class SignatureUtilsTest {

    @Test
    fun `test sign and verify with byte array`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val message = "Hello, DID!".toByteArray()

        // When
        val signature = SignatureUtils.sign(message, keyPair)

        // Then
        assertEquals(64, signature.size)

        // When verifying
        val isValid = SignatureUtils.verify(message, signature, keyPair.publicKey)

        // Then
        assertTrue(isValid)
    }

    @Test
    fun `test sign and verify with string`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val message = "Test message for signing"

        // When
        val signature = SignatureUtils.sign(message, keyPair)
        val isValid = SignatureUtils.verify(message, signature, keyPair.publicKey)

        // Then
        assertEquals(64, signature.size)
        assertTrue(isValid)
    }

    @Test
    fun `test verify fails with wrong message`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val originalMessage = "Original message"
        val tamperedMessage = "Tampered message"

        // When
        val signature = SignatureUtils.sign(originalMessage, keyPair)
        val isValid = SignatureUtils.verify(tamperedMessage, signature, keyPair.publicKey)

        // Then
        assertFalse(isValid)
    }

    @Test
    fun `test verify fails with wrong public key`() {
        // Given
        val keyPair1 = Ed25519KeyPair.generate()
        val keyPair2 = Ed25519KeyPair.generate()
        val message = "Test message"

        // When
        val signature = SignatureUtils.sign(message, keyPair1)
        val isValid = SignatureUtils.verify(message, signature, keyPair2.publicKey)

        // Then
        assertFalse(isValid)
    }

    @Test
    fun `test verify fails with tampered signature`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val message = "Test message"

        // When
        val signature = SignatureUtils.sign(message, keyPair)
        signature[0] = (signature[0].toInt() xor 0xFF).toByte() // Tamper with signature
        val isValid = SignatureUtils.verify(message, signature, keyPair.publicKey)

        // Then
        assertFalse(isValid)
    }

    @Test
    fun `test sign with KeyPair containing only public key fails`() {
        // Given
        val fullKeyPair = Ed25519KeyPair.generate()
        val publicOnlyKeyPair = Ed25519KeyPair.fromPublicKey(fullKeyPair.publicKey)
        val message = "Test message"

        // When/Then
        try {
            SignatureUtils.sign(message, publicOnlyKeyPair)
            fail("Should throw IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!.contains("Private key is required"))
        }
    }

    @Test
    fun `test signWithTimestamp creates valid timestamped signature`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val message = "Test message".toByteArray()

        // When
        val timestampedSig = SignatureUtils.signWithTimestamp(message, keyPair)

        // Then
        assertEquals(64, timestampedSig.signature.size)
        assertTrue(timestampedSig.timestamp > 0)
        assertTrue(timestampedSig.timestamp <= System.currentTimeMillis())
    }

    @Test
    fun `test verifyWithTimestamp succeeds within time window`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val message = "Test message".toByteArray()

        // When
        val timestampedSig = SignatureUtils.signWithTimestamp(message, keyPair)
        val isValid = SignatureUtils.verifyWithTimestamp(
            message,
            timestampedSig,
            keyPair.publicKey,
            maxAgeMs = 60000 // 60 seconds
        )

        // Then
        assertTrue(isValid)
    }

    @Test
    fun `test verifyWithTimestamp fails when timestamp expired`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val message = "Test message".toByteArray()

        // When
        val oldTimestampedSig = TimestampedSignature(
            signature = SignatureUtils.sign(message + "0".toByteArray(), keyPair), // Old timestamp
            timestamp = System.currentTimeMillis() - 120000 // 2 minutes ago
        )

        val isValid = SignatureUtils.verifyWithTimestamp(
            message,
            oldTimestampedSig,
            keyPair.publicKey,
            maxAgeMs = 60000 // 60 seconds max
        )

        // Then
        assertFalse(isValid)
    }

    @Test
    fun `test verifyWithTimestamp fails with future timestamp`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val message = "Test message".toByteArray()

        // When
        val futureTimestampedSig = TimestampedSignature(
            signature = ByteArray(64),
            timestamp = System.currentTimeMillis() + 120000 // 2 minutes in future
        )

        val isValid = SignatureUtils.verifyWithTimestamp(
            message,
            futureTimestampedSig,
            keyPair.publicKey,
            maxAgeMs = 60000
        )

        // Then
        assertFalse(isValid)
    }

    @Test
    fun `test createJWS generates valid format`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val payload = """{"sub":"user123","name":"Test User"}"""

        // When
        val jws = SignatureUtils.createJWS(payload, keyPair)

        // Then
        val parts = jws.split(".")
        assertEquals(3, parts.size)
        assertTrue(parts[0].isNotEmpty()) // Header
        assertTrue(parts[1].isNotEmpty()) // Payload
        assertTrue(parts[2].isNotEmpty()) // Signature
    }

    @Test
    fun `test verifyJWS succeeds with valid signature`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val payload = """{"sub":"user123","name":"Test User"}"""

        // When
        val jws = SignatureUtils.createJWS(payload, keyPair)
        val verifiedPayload = SignatureUtils.verifyJWS(jws, keyPair.publicKey)

        // Then
        assertNotNull(verifiedPayload)
        assertEquals(payload, verifiedPayload)
    }

    @Test
    fun `test verifyJWS fails with tampered payload`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val payload = """{"sub":"user123","name":"Test User"}"""

        // When
        val jws = SignatureUtils.createJWS(payload, keyPair)
        val parts = jws.split(".")
        val tamperedJws = "${parts[0]}.${parts[1]}X.${parts[2]}" // Tamper payload

        val verifiedPayload = SignatureUtils.verifyJWS(tamperedJws, keyPair.publicKey)

        // Then
        assertNull(verifiedPayload)
    }

    @Test
    fun `test verifyJWS fails with wrong public key`() {
        // Given
        val keyPair1 = Ed25519KeyPair.generate()
        val keyPair2 = Ed25519KeyPair.generate()
        val payload = """{"sub":"user123"}"""

        // When
        val jws = SignatureUtils.createJWS(payload, keyPair1)
        val verifiedPayload = SignatureUtils.verifyJWS(jws, keyPair2.publicKey)

        // Then
        assertNull(verifiedPayload)
    }

    @Test
    fun `test verifyJWS fails with invalid format`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val invalidJws = "invalid.jws"

        // When
        val verifiedPayload = SignatureUtils.verifyJWS(invalidJws, keyPair.publicKey)

        // Then
        assertNull(verifiedPayload)
    }

    @Test
    fun `test base64url encoding and decoding`() {
        // Given
        val original = "Hello, World! This is a test message with special chars: +/="
        val bytes = original.toByteArray()

        // When
        val encoded = bytes.toBase64Url()
        val decoded = encoded.fromBase64Url()
        val result = String(decoded)

        // Then
        assertEquals(original, result)
        assertFalse(encoded.contains("+"))
        assertFalse(encoded.contains("/"))
        assertFalse(encoded.contains("="))
    }

    @Test
    fun `test TimestampedSignature equals and hashCode`() {
        // Given
        val sig1 = TimestampedSignature(ByteArray(64) { 1 }, 12345L)
        val sig2 = TimestampedSignature(ByteArray(64) { 1 }, 12345L)
        val sig3 = TimestampedSignature(ByteArray(64) { 2 }, 12345L)

        // Then
        assertEquals(sig1, sig2)
        assertEquals(sig1.hashCode(), sig2.hashCode())
        assertNotEquals(sig1, sig3)
    }
}
