package com.chainlesschain.android.core.did.crypto

import org.junit.Test
import org.junit.Assert.*

/**
 * Ed25519KeyPair单元测试
 */
class Ed25519KeyPairTest {

    @Test
    fun `test generate key pair`() {
        // When
        val keyPair = Ed25519KeyPair.generate()

        // Then
        assertEquals(32, keyPair.publicKey.size)
        assertEquals(32, keyPair.privateKey.size)
        assertTrue(keyPair.hasPrivateKey())
    }

    @Test
    fun `test generate multiple key pairs are different`() {
        // When
        val keyPair1 = Ed25519KeyPair.generate()
        val keyPair2 = Ed25519KeyPair.generate()

        // Then
        assertFalse(keyPair1.publicKey.contentEquals(keyPair2.publicKey))
        assertFalse(keyPair1.privateKey.contentEquals(keyPair2.privateKey))
    }

    @Test
    fun `test fromPrivateKey derives correct public key`() {
        // Given
        val originalKeyPair = Ed25519KeyPair.generate()

        // When
        val restoredKeyPair = Ed25519KeyPair.fromPrivateKey(originalKeyPair.privateKey)

        // Then
        assertArrayEquals(originalKeyPair.publicKey, restoredKeyPair.publicKey)
        assertArrayEquals(originalKeyPair.privateKey, restoredKeyPair.privateKey)
    }

    @Test
    fun `test fromPublicKey creates key pair without private key`() {
        // Given
        val originalKeyPair = Ed25519KeyPair.generate()

        // When
        val publicOnlyKeyPair = Ed25519KeyPair.fromPublicKey(originalKeyPair.publicKey)

        // Then
        assertArrayEquals(originalKeyPair.publicKey, publicOnlyKeyPair.publicKey)
        assertEquals(0, publicOnlyKeyPair.privateKey.size)
        assertFalse(publicOnlyKeyPair.hasPrivateKey())
    }

    @Test(expected = IllegalArgumentException::class)
    fun `test fromPrivateKey with invalid size throws exception`() {
        // Given
        val invalidPrivateKey = ByteArray(16) // Wrong size

        // When
        Ed25519KeyPair.fromPrivateKey(invalidPrivateKey)

        // Then - exception thrown
    }

    @Test(expected = IllegalArgumentException::class)
    fun `test fromPublicKey with invalid size throws exception`() {
        // Given
        val invalidPublicKey = ByteArray(16) // Wrong size

        // When
        Ed25519KeyPair.fromPublicKey(invalidPublicKey)

        // Then - exception thrown
    }

    @Test
    fun `test hex conversion`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()

        // When
        val publicKeyHex = keyPair.getPublicKeyHex()
        val privateKeyHex = keyPair.getPrivateKeyHex()

        // Then
        assertEquals(64, publicKeyHex.length) // 32 bytes = 64 hex chars
        assertEquals(64, privateKeyHex.length)
        assertTrue(publicKeyHex.matches(Regex("[0-9a-f]{64}")))
        assertTrue(privateKeyHex.matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun `test hex roundtrip conversion`() {
        // Given
        val originalKeyPair = Ed25519KeyPair.generate()

        // When
        val publicKeyHex = originalKeyPair.getPublicKeyHex()
        val privateKeyHex = originalKeyPair.getPrivateKeyHex()

        val publicKeyBytes = publicKeyHex.hexToByteArray()
        val privateKeyBytes = privateKeyHex.hexToByteArray()

        // Then
        assertArrayEquals(originalKeyPair.publicKey, publicKeyBytes)
        assertArrayEquals(originalKeyPair.privateKey, privateKeyBytes)
    }

    @Test
    fun `test Ed25519KeyPairJson serialization with private key`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()

        // When
        val json = Ed25519KeyPairJson.fromKeyPair(keyPair)
        val restored = json.toKeyPair()

        // Then
        assertArrayEquals(keyPair.publicKey, restored.publicKey)
        assertArrayEquals(keyPair.privateKey, restored.privateKey)
        assertTrue(restored.hasPrivateKey())
    }

    @Test
    fun `test Ed25519KeyPairJson serialization without private key`() {
        // Given
        val originalKeyPair = Ed25519KeyPair.generate()
        val publicOnlyKeyPair = Ed25519KeyPair.fromPublicKey(originalKeyPair.publicKey)

        // When
        val json = Ed25519KeyPairJson.fromKeyPair(publicOnlyKeyPair)

        // Then
        assertNotNull(json.publicKey)
        assertNull(json.privateKey)

        // When restored
        val restored = json.toKeyPair()

        // Then
        assertArrayEquals(publicOnlyKeyPair.publicKey, restored.publicKey)
        assertFalse(restored.hasPrivateKey())
    }

    @Test
    fun `test equals and hashCode`() {
        // Given
        val keyPair1 = Ed25519KeyPair.generate()
        val keyPair2 = Ed25519KeyPair.fromPrivateKey(keyPair1.privateKey)
        val keyPair3 = Ed25519KeyPair.generate()

        // Then
        assertEquals(keyPair1, keyPair2)
        assertEquals(keyPair1.hashCode(), keyPair2.hashCode())
        assertNotEquals(keyPair1, keyPair3)
    }

    @Test
    fun `test toString does not expose private key`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()

        // When
        val string = keyPair.toString()

        // Then
        assertTrue(string.contains("publicKey="))
        assertTrue(string.contains("hasPrivateKey=true"))
        assertFalse(string.contains(keyPair.getPrivateKeyHex())) // Should not expose private key
    }
}
