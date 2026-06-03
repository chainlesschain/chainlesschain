package com.chainlesschain.android.core.e2ee.crypto

import org.junit.Test
import org.junit.Assert.*

/**
 * X25519KeyPair单元测试
 */
class X25519KeyPairTest {

    @Test
    fun `test generate key pair`() {
        // When
        val keyPair = X25519KeyPair.generate()

        // Then
        assertEquals(32, keyPair.publicKey.size)
        assertEquals(32, keyPair.privateKey.size)
        assertTrue(keyPair.hasPrivateKey())
    }

    @Test
    fun `test generate multiple key pairs are different`() {
        // When
        val keyPair1 = X25519KeyPair.generate()
        val keyPair2 = X25519KeyPair.generate()

        // Then
        assertFalse(keyPair1.publicKey.contentEquals(keyPair2.publicKey))
        assertFalse(keyPair1.privateKey.contentEquals(keyPair2.privateKey))
    }

    @Test
    fun `test fromPrivateKey derives correct public key`() {
        // Given
        val originalKeyPair = X25519KeyPair.generate()

        // When
        val restoredKeyPair = X25519KeyPair.fromPrivateKey(originalKeyPair.privateKey)

        // Then
        assertArrayEquals(originalKeyPair.publicKey, restoredKeyPair.publicKey)
        assertArrayEquals(originalKeyPair.privateKey, restoredKeyPair.privateKey)
    }

    @Test
    fun `test ECDH key agreement produces same shared secret`() {
        // Given
        val alice = X25519KeyPair.generate()
        val bob = X25519KeyPair.generate()

        // When
        val aliceShared = alice.computeSharedSecret(bob.publicKey)
        val bobShared = bob.computeSharedSecret(alice.publicKey)

        // Then
        assertEquals(32, aliceShared.size)
        assertEquals(32, bobShared.size)
        assertArrayEquals(aliceShared, bobShared)
    }

    @Test
    fun `test static ECDH key agreement`() {
        // Given
        val alice = X25519KeyPair.generate()
        val bob = X25519KeyPair.generate()

        // When
        val shared1 = X25519KeyPair.computeSharedSecret(alice.privateKey, bob.publicKey)
        val shared2 = X25519KeyPair.computeSharedSecret(bob.privateKey, alice.publicKey)

        // Then
        assertArrayEquals(shared1, shared2)
    }

    @Test
    fun `test different key pairs produce different shared secrets`() {
        // Given
        val alice = X25519KeyPair.generate()
        val bob = X25519KeyPair.generate()
        val charlie = X25519KeyPair.generate()

        // When
        val aliceBobShared = alice.computeSharedSecret(bob.publicKey)
        val aliceCharlieShared = alice.computeSharedSecret(charlie.publicKey)

        // Then
        assertFalse(aliceBobShared.contentEquals(aliceCharlieShared))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `test computeSharedSecret without private key throws exception`() {
        // Given
        val alice = X25519KeyPair.generate()
        val publicOnlyKeyPair = X25519KeyPair.fromPublicKey(alice.publicKey)
        val bob = X25519KeyPair.generate()

        // When
        publicOnlyKeyPair.computeSharedSecret(bob.publicKey)

        // Then - exception thrown
    }

    @Test
    fun `test hex conversion`() {
        // Given
        val keyPair = X25519KeyPair.generate()

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
    fun `test JSON serialization with private key`() {
        // Given
        val keyPair = X25519KeyPair.generate()

        // When
        val json = X25519KeyPairJson.fromKeyPair(keyPair)
        val restored = json.toKeyPair()

        // Then
        assertArrayEquals(keyPair.publicKey, restored.publicKey)
        assertArrayEquals(keyPair.privateKey, restored.privateKey)
    }

    @Test
    fun `test JSON serialization without private key`() {
        // Given
        val fullKeyPair = X25519KeyPair.generate()
        val publicOnlyKeyPair = X25519KeyPair.fromPublicKey(fullKeyPair.publicKey)

        // When
        val json = X25519KeyPairJson.fromKeyPair(publicOnlyKeyPair)

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
        val keyPair1 = X25519KeyPair.generate()
        val keyPair2 = X25519KeyPair.fromPrivateKey(keyPair1.privateKey)
        val keyPair3 = X25519KeyPair.generate()

        // Then
        assertEquals(keyPair1, keyPair2)
        assertEquals(keyPair1.hashCode(), keyPair2.hashCode())
        assertNotEquals(keyPair1, keyPair3)
    }

    @Test
    fun `test toString does not expose private key`() {
        // Given
        val keyPair = X25519KeyPair.generate()

        // When
        val string = keyPair.toString()

        // Then
        assertTrue(string.contains("publicKey="))
        assertTrue(string.contains("hasPrivateKey=true"))
        assertFalse(string.contains(keyPair.getPrivateKeyHex()))
    }

    @Test
    fun `test shared secret is deterministic`() {
        // Given
        val alice = X25519KeyPair.generate()
        val bob = X25519KeyPair.generate()

        // When
        val shared1 = alice.computeSharedSecret(bob.publicKey)
        val shared2 = alice.computeSharedSecret(bob.publicKey)

        // Then
        assertArrayEquals(shared1, shared2)
    }
}
