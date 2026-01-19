package com.chainlesschain.android.core.did.generator

import com.chainlesschain.android.core.did.crypto.Ed25519KeyPair
import org.junit.Test
import org.junit.Assert.*

/**
 * DidKeyGenerator单元测试
 */
class DidKeyGeneratorTest {

    @Test
    fun `test generate creates valid did key format`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()

        // When
        val didKey = DidKeyGenerator.generate(keyPair)

        // Then
        assertTrue(didKey.startsWith("did:key:z"))
        assertTrue(didKey.length > 50) // Reasonable length for did:key
    }

    @Test
    fun `test generate creates consistent did key for same key pair`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()

        // When
        val didKey1 = DidKeyGenerator.generate(keyPair)
        val didKey2 = DidKeyGenerator.generate(keyPair)

        // Then
        assertEquals(didKey1, didKey2)
    }

    @Test
    fun `test generate creates different did keys for different key pairs`() {
        // Given
        val keyPair1 = Ed25519KeyPair.generate()
        val keyPair2 = Ed25519KeyPair.generate()

        // When
        val didKey1 = DidKeyGenerator.generate(keyPair1)
        val didKey2 = DidKeyGenerator.generate(keyPair2)

        // Then
        assertNotEquals(didKey1, didKey2)
    }

    @Test
    fun `test extractPublicKey retrieves correct public key`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val didKey = DidKeyGenerator.generate(keyPair)

        // When
        val extractedPublicKey = DidKeyGenerator.extractPublicKey(didKey)

        // Then
        assertArrayEquals(keyPair.publicKey, extractedPublicKey)
    }

    @Test
    fun `test extractPublicKey returns 32 bytes`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val didKey = DidKeyGenerator.generate(keyPair)

        // When
        val publicKey = DidKeyGenerator.extractPublicKey(didKey)

        // Then
        assertEquals(32, publicKey.size)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `test extractPublicKey fails with invalid did key prefix`() {
        // Given
        val invalidDidKey = "did:web:example.com"

        // When
        DidKeyGenerator.extractPublicKey(invalidDidKey)

        // Then - exception thrown
    }

    @Test(expected = IllegalArgumentException::class)
    fun `test extractPublicKey fails with invalid multibase prefix`() {
        // Given
        val invalidDidKey = "did:key:x123456" // 'x' is not 'z'

        // When
        DidKeyGenerator.extractPublicKey(invalidDidKey)

        // Then - exception thrown
    }

    @Test(expected = IllegalArgumentException::class)
    fun `test extractPublicKey fails with corrupted base58`() {
        // Given
        val invalidDidKey = "did:key:z000000" // Invalid base58

        // When
        DidKeyGenerator.extractPublicKey(invalidDidKey)

        // Then - exception thrown
    }

    @Test
    fun `test generateDocument creates valid DID Document`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val didKey = DidKeyGenerator.generate(keyPair)

        // When
        val didDocument = DidKeyGenerator.generateDocument(didKey)

        // Then
        assertEquals(didKey, didDocument.id)
        assertEquals(1, didDocument.verificationMethod.size)
        assertTrue(didDocument.authentication.isNotEmpty())
        assertTrue(didDocument.assertionMethod.isNotEmpty())
        assertTrue(didDocument.keyAgreement.isNotEmpty())
    }

    @Test
    fun `test generateDocument verification method has correct type`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val didKey = DidKeyGenerator.generate(keyPair)

        // When
        val didDocument = DidKeyGenerator.generateDocument(didKey)
        val verificationMethod = didDocument.verificationMethod.first()

        // Then
        assertEquals("Ed25519VerificationKey2020", verificationMethod.type)
        assertEquals(didKey, verificationMethod.controller)
        assertNotNull(verificationMethod.publicKeyMultibase)
        assertTrue(verificationMethod.publicKeyMultibase!!.startsWith("z"))
    }

    @Test
    fun `test generateDocument verification method ID format`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val didKey = DidKeyGenerator.generate(keyPair)

        // When
        val didDocument = DidKeyGenerator.generateDocument(didKey)
        val verificationMethod = didDocument.verificationMethod.first()

        // Then
        assertTrue(verificationMethod.id.startsWith(didKey))
        assertTrue(verificationMethod.id.contains("#"))
    }

    @Test
    fun `test isValid returns true for valid did key`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val didKey = DidKeyGenerator.generate(keyPair)

        // When
        val isValid = DidKeyGenerator.isValid(didKey)

        // Then
        assertTrue(isValid)
    }

    @Test
    fun `test isValid returns false for invalid did key`() {
        // Given
        val invalidDidKeys = listOf(
            "did:web:example.com",
            "did:key:x123",
            "invalid",
            "",
            "did:key:z"
        )

        // When/Then
        invalidDidKeys.forEach { invalidDidKey ->
            assertFalse(
                "Should be invalid: $invalidDidKey",
                DidKeyGenerator.isValid(invalidDidKey)
            )
        }
    }

    @Test
    fun `test roundtrip generate and extract`() {
        // Given
        val originalKeyPair = Ed25519KeyPair.generate()

        // When
        val didKey = DidKeyGenerator.generate(originalKeyPair)
        val extractedPublicKey = DidKeyGenerator.extractPublicKey(didKey)
        val restoredKeyPair = Ed25519KeyPair.fromPublicKey(extractedPublicKey)

        // Then
        assertArrayEquals(originalKeyPair.publicKey, restoredKeyPair.publicKey)
    }

    @Test
    fun `test known test vector`() {
        // Given - Known Ed25519 public key (all zeros for testing)
        val testPublicKey = ByteArray(32) { 0 }
        val testKeyPair = Ed25519KeyPair.fromPublicKey(testPublicKey)

        // When
        val didKey = DidKeyGenerator.generate(testKeyPair)
        val extractedPublicKey = DidKeyGenerator.extractPublicKey(didKey)

        // Then
        assertArrayEquals(testPublicKey, extractedPublicKey)
        assertTrue(didKey.startsWith("did:key:z"))
    }

    @Test
    fun `test multiple generate calls produce same result`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()

        // When
        val results = (1..10).map { DidKeyGenerator.generate(keyPair) }

        // Then
        results.forEach { didKey ->
            assertEquals(results.first(), didKey)
        }
    }

    @Test
    fun `test generateDocument and extract public key match`() {
        // Given
        val keyPair = Ed25519KeyPair.generate()
        val didKey = DidKeyGenerator.generate(keyPair)

        // When
        val didDocument = DidKeyGenerator.generateDocument(didKey)
        val extractedPublicKey = DidKeyGenerator.extractPublicKey(didKey)

        // Then
        assertArrayEquals(keyPair.publicKey, extractedPublicKey)
        assertEquals(didKey, didDocument.id)
    }

    @Test
    fun `test base58 encoding handles all byte values`() {
        // Given
        val allBytesKeyPair = Ed25519KeyPair.fromPublicKey(
            ByteArray(32) { it.toByte() }
        )

        // When
        val didKey = DidKeyGenerator.generate(allBytesKeyPair)
        val extractedPublicKey = DidKeyGenerator.extractPublicKey(didKey)

        // Then
        assertArrayEquals(allBytesKeyPair.publicKey, extractedPublicKey)
    }
}
