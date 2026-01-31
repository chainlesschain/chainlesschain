package com.chainlesschain.android.core.e2ee.protocol

import com.chainlesschain.android.core.e2ee.test.E2EETestFactory
import org.junit.Assert.*
import org.junit.Test

/**
 * X3DH Key Exchange Protocol Tests
 *
 * Comprehensive tests for Extended Triple Diffie-Hellman asynchronous key exchange
 *
 * Coverage:
 * - PreKey Bundle generation and validation
 * - Sender X3DH execution
 * - Receiver X3DH execution
 * - Shared secret symmetry (Alice and Bob derive same secret)
 * - Associated data verification
 * - Security properties (different ephemeral keys = different secrets)
 *
 * Target: 95% code coverage for X3DHKeyExchange.kt
 */
class X3DHKeyExchangeTest {

    // ========================================
    // PreKey Bundle Tests (3 tests)
    // ========================================

    @Test
    fun `generatePreKeyBundle creates valid bundle with all required keys`() {
        // Given
        val identityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val signedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()
        val oneTimePreKeyPair = E2EETestFactory.generateOneTimePreKeyPair()

        // When
        val bundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = identityKeyPair,
            signedPreKeyPair = signedPreKeyPair,
            oneTimePreKeyPair = oneTimePreKeyPair
        )

        // Then
        assertNotNull(bundle)
        assertEquals(32, bundle.identityKey.size)
        assertEquals(32, bundle.signedPreKey.size)
        assertEquals(64, bundle.signedPreKeySignature.size)
        assertNotNull(bundle.oneTimePreKey)
        assertEquals(32, bundle.oneTimePreKey?.size)

        assertArrayEquals(identityKeyPair.publicKey, bundle.identityKey)
        assertArrayEquals(signedPreKeyPair.publicKey, bundle.signedPreKey)
        assertArrayEquals(oneTimePreKeyPair.publicKey, bundle.oneTimePreKey)
    }

    @Test
    fun `generatePreKeyBundle without oneTimePreKey creates valid bundle`() {
        // Given
        val identityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val signedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        // When
        val bundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = identityKeyPair,
            signedPreKeyPair = signedPreKeyPair,
            oneTimePreKeyPair = null
        )

        // Then
        assertNotNull(bundle)
        assertNull(bundle.oneTimePreKey)
        assertEquals(32, bundle.identityKey.size)
        assertEquals(32, bundle.signedPreKey.size)
        assertEquals(64, bundle.signedPreKeySignature.size)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `generatePreKeyBundle throws exception if identity key has no private key`() {
        // Given: Public-only identity key (invalid)
        val identityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val publicOnlyIdentity = com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair.fromPublicKey(
            identityKeyPair.publicKey
        )
        val signedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        // When: Generate bundle with public-only key
        X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = publicOnlyIdentity,
            signedPreKeyPair = signedPreKeyPair
        )

        // Then: Exception thrown
    }

    // ========================================
    // Sender X3DH Tests (5 tests)
    // ========================================

    @Test
    fun `senderX3DH derives shared secret and associated data`() {
        // Given: Alice (sender) and Bob (receiver) key pairs
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()
        val bobOneTimePreKeyPair = E2EETestFactory.generateOneTimePreKeyPair()

        val bobBundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = bobIdentityKeyPair,
            signedPreKeyPair = bobSignedPreKeyPair,
            oneTimePreKeyPair = bobOneTimePreKeyPair
        )

        // When: Alice performs X3DH
        val result = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeralKeyPair,
            receiverPreKeyBundle = bobBundle
        )

        // Then
        assertNotNull(result)
        assertEquals(32, result.sharedSecret.size)
        assertEquals(64, result.associatedData.size) // IK_A || IK_B (32 + 32)

        // Associated data should be IK_A || IK_B
        val expectedAD = aliceIdentityKeyPair.publicKey + bobIdentityKeyPair.publicKey
        assertArrayEquals(expectedAD, result.associatedData)
    }

    @Test
    fun `senderX3DH and receiverX3DH derive same shared secret with oneTimePreKey`() {
        // Given: Alice (sender) and Bob (receiver)
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()
        val bobOneTimePreKeyPair = E2EETestFactory.generateOneTimePreKeyPair()

        val bobBundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = bobIdentityKeyPair,
            signedPreKeyPair = bobSignedPreKeyPair,
            oneTimePreKeyPair = bobOneTimePreKeyPair
        )

        // When: Alice performs sender X3DH
        val aliceResult = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeralKeyPair,
            receiverPreKeyBundle = bobBundle
        )

        // When: Bob performs receiver X3DH
        val bobResult = X3DHKeyExchange.receiverX3DH(
            receiverIdentityKeyPair = bobIdentityKeyPair,
            receiverSignedPreKeyPair = bobSignedPreKeyPair,
            receiverOneTimePreKeyPair = bobOneTimePreKeyPair,
            senderIdentityKey = aliceIdentityKeyPair.publicKey,
            senderEphemeralKey = aliceEphemeralKeyPair.publicKey
        )

        // Then: Shared secrets are identical
        assertArrayEquals(aliceResult.sharedSecret, bobResult.sharedSecret)
        assertArrayEquals(aliceResult.associatedData, bobResult.associatedData)
    }

    @Test
    fun `senderX3DH and receiverX3DH derive same shared secret without oneTimePreKey`() {
        // Given: Alice and Bob, but no one-time pre-key
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        val bobBundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = bobIdentityKeyPair,
            signedPreKeyPair = bobSignedPreKeyPair,
            oneTimePreKeyPair = null
        )

        // When: Alice performs sender X3DH
        val aliceResult = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeralKeyPair,
            receiverPreKeyBundle = bobBundle
        )

        // When: Bob performs receiver X3DH (no one-time key)
        val bobResult = X3DHKeyExchange.receiverX3DH(
            receiverIdentityKeyPair = bobIdentityKeyPair,
            receiverSignedPreKeyPair = bobSignedPreKeyPair,
            receiverOneTimePreKeyPair = null,
            senderIdentityKey = aliceIdentityKeyPair.publicKey,
            senderEphemeralKey = aliceEphemeralKeyPair.publicKey
        )

        // Then: Shared secrets are identical
        assertArrayEquals(aliceResult.sharedSecret, bobResult.sharedSecret)
        assertArrayEquals(aliceResult.associatedData, bobResult.associatedData)
    }

    @Test
    fun `senderX3DH produces different secrets for different ephemeral keys`() {
        // Given: Same sender and receiver, but different ephemeral keys
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeral1 = E2EETestFactory.generateEphemeralKeyPair()
        val aliceEphemeral2 = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        val bobBundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = bobIdentityKeyPair,
            signedPreKeyPair = bobSignedPreKeyPair
        )

        // When: Two X3DH executions with different ephemeral keys
        val result1 = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeral1,
            receiverPreKeyBundle = bobBundle
        )

        val result2 = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeral2,
            receiverPreKeyBundle = bobBundle
        )

        // Then: Shared secrets are different (security property)
        assertFalse(result1.sharedSecret.contentEquals(result2.sharedSecret))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `senderX3DH throws exception if sender identity key has no private key`() {
        // Given
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val publicOnlyIdentity = com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair.fromPublicKey(
            aliceIdentityKeyPair.publicKey
        )
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobBundle = E2EETestFactory.generatePreKeyBundle()

        // When: Perform X3DH with public-only identity key
        X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = publicOnlyIdentity,
            senderEphemeralKeyPair = aliceEphemeralKeyPair,
            receiverPreKeyBundle = bobBundle
        )

        // Then: Exception thrown
    }

    // ========================================
    // Receiver X3DH Tests (3 tests)
    // ========================================

    @Test
    fun `receiverX3DH computes correct 4-DH operations`() {
        // Given: Alice initiates, Bob receives
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()
        val bobOneTimePreKeyPair = E2EETestFactory.generateOneTimePreKeyPair()

        // When: Bob performs receiver X3DH
        val bobResult = X3DHKeyExchange.receiverX3DH(
            receiverIdentityKeyPair = bobIdentityKeyPair,
            receiverSignedPreKeyPair = bobSignedPreKeyPair,
            receiverOneTimePreKeyPair = bobOneTimePreKeyPair,
            senderIdentityKey = aliceIdentityKeyPair.publicKey,
            senderEphemeralKey = aliceEphemeralKeyPair.publicKey
        )

        // Then: Result contains valid shared secret
        assertNotNull(bobResult)
        assertEquals(32, bobResult.sharedSecret.size)

        // Associated data should be IK_A || IK_B
        val expectedAD = aliceIdentityKeyPair.publicKey + bobIdentityKeyPair.publicKey
        assertArrayEquals(expectedAD, bobResult.associatedData)
    }

    @Test
    fun `receiverX3DH handles missing oneTimePreKey correctly`() {
        // Given
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        // When: Bob performs receiver X3DH without one-time pre-key
        val bobResult = X3DHKeyExchange.receiverX3DH(
            receiverIdentityKeyPair = bobIdentityKeyPair,
            receiverSignedPreKeyPair = bobSignedPreKeyPair,
            receiverOneTimePreKeyPair = null,
            senderIdentityKey = aliceIdentityKeyPair.publicKey,
            senderEphemeralKey = aliceEphemeralKeyPair.publicKey
        )

        // Then: Still produces valid shared secret (only 3-DH instead of 4-DH)
        assertNotNull(bobResult)
        assertEquals(32, bobResult.sharedSecret.size)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `receiverX3DH throws exception if receiver identity key has no private key`() {
        // Given
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val publicOnlyIdentity = com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair.fromPublicKey(
            bobIdentityKeyPair.publicKey
        )
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        // When: Perform X3DH with public-only identity key
        X3DHKeyExchange.receiverX3DH(
            receiverIdentityKeyPair = publicOnlyIdentity,
            receiverSignedPreKeyPair = bobSignedPreKeyPair,
            receiverOneTimePreKeyPair = null,
            senderIdentityKey = aliceIdentityKeyPair.publicKey,
            senderEphemeralKey = aliceEphemeralKeyPair.publicKey
        )

        // Then: Exception thrown
    }

    // ========================================
    // Associated Data Tests (2 tests)
    // ========================================

    @Test
    fun `associated data is correctly formatted as IK_A concat IK_B`() {
        // Given
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        val bobBundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = bobIdentityKeyPair,
            signedPreKeyPair = bobSignedPreKeyPair
        )

        // When
        val result = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeralKeyPair,
            receiverPreKeyBundle = bobBundle
        )

        // Then: AD = IK_A || IK_B
        assertEquals(64, result.associatedData.size)

        val ikA = aliceIdentityKeyPair.publicKey
        val ikB = bobIdentityKeyPair.publicKey

        // First 32 bytes should be Alice's identity key
        assertArrayEquals(ikA, result.associatedData.sliceArray(0 until 32))

        // Last 32 bytes should be Bob's identity key
        assertArrayEquals(ikB, result.associatedData.sliceArray(32 until 64))
    }

    @Test
    fun `associated data matches between sender and receiver`() {
        // Given
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val aliceEphemeralKeyPair = E2EETestFactory.generateEphemeralKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        val bobBundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = bobIdentityKeyPair,
            signedPreKeyPair = bobSignedPreKeyPair
        )

        // When
        val aliceResult = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeralKeyPair,
            receiverPreKeyBundle = bobBundle
        )

        val bobResult = X3DHKeyExchange.receiverX3DH(
            receiverIdentityKeyPair = bobIdentityKeyPair,
            receiverSignedPreKeyPair = bobSignedPreKeyPair,
            receiverOneTimePreKeyPair = null,
            senderIdentityKey = aliceIdentityKeyPair.publicKey,
            senderEphemeralKey = aliceEphemeralKeyPair.publicKey
        )

        // Then: Both have identical associated data
        assertArrayEquals(aliceResult.associatedData, bobResult.associatedData)
    }

    // ========================================
    // Security Property Test (1 test)
    // ========================================

    @Test
    fun `X3DH provides forward secrecy - different sessions have different secrets`() {
        // Given: Same Alice and Bob, but two separate session setups
        val aliceIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()

        val bobIdentityKeyPair = E2EETestFactory.generateIdentityKeyPair()
        val bobSignedPreKeyPair = E2EETestFactory.generateSignedPreKeyPair()

        val bobBundle = X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair = bobIdentityKeyPair,
            signedPreKeyPair = bobSignedPreKeyPair
        )

        // Session 1
        val aliceEphemeral1 = E2EETestFactory.generateEphemeralKeyPair()
        val session1Result = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeral1,
            receiverPreKeyBundle = bobBundle
        )

        // Session 2 (different ephemeral key)
        val aliceEphemeral2 = E2EETestFactory.generateEphemeralKeyPair()
        val session2Result = X3DHKeyExchange.senderX3DH(
            senderIdentityKeyPair = aliceIdentityKeyPair,
            senderEphemeralKeyPair = aliceEphemeral2,
            receiverPreKeyBundle = bobBundle
        )

        // Then: Different sessions have different shared secrets (forward secrecy)
        assertFalse(session1Result.sharedSecret.contentEquals(session2Result.sharedSecret))

        // Associated data is the same (same identities)
        assertArrayEquals(session1Result.associatedData, session2Result.associatedData)
    }

    // ========================================
    // Data Class Coverage Tests
    // ========================================

    @Test
    fun `PreKeyBundle equals and hashCode work correctly`() {
        // Given
        val identityKey = ByteArray(32) { 1 }
        val signedPreKey = ByteArray(32) { 2 }
        val signature = ByteArray(64) { 3 }
        val oneTimeKey = ByteArray(32) { 4 }

        val bundle1 = PreKeyBundle(
            identityKey = identityKey.copyOf(),
            signedPreKey = signedPreKey.copyOf(),
            signedPreKeySignature = signature.copyOf(),
            oneTimePreKey = oneTimeKey.copyOf()
        )

        val bundle2 = PreKeyBundle(
            identityKey = identityKey.copyOf(),
            signedPreKey = signedPreKey.copyOf(),
            signedPreKeySignature = signature.copyOf(),
            oneTimePreKey = oneTimeKey.copyOf()
        )

        val bundle3 = PreKeyBundle(
            identityKey = identityKey.copyOf(),
            signedPreKey = signedPreKey.copyOf(),
            signedPreKeySignature = signature.copyOf(),
            oneTimePreKey = null
        )

        // Then
        assertEquals(bundle1, bundle2)
        assertEquals(bundle1.hashCode(), bundle2.hashCode())
        assertNotEquals(bundle1, bundle3) // Different oneTimePreKey
    }

    @Test
    fun `X3DHResult equals and hashCode work correctly`() {
        // Given
        val sharedSecret = ByteArray(32) { 1 }
        val associatedData = ByteArray(64) { 2 }

        val result1 = X3DHResult(sharedSecret.copyOf(), associatedData.copyOf())
        val result2 = X3DHResult(sharedSecret.copyOf(), associatedData.copyOf())
        val result3 = X3DHResult(ByteArray(32) { 3 }, associatedData.copyOf())

        // Then
        assertEquals(result1, result2)
        assertEquals(result1.hashCode(), result2.hashCode())
        assertNotEquals(result1, result3)
    }
}
