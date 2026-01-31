package com.chainlesschain.android.core.e2ee.test

import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.MessageHeader
import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import com.chainlesschain.android.core.e2ee.protocol.DoubleRatchet

/**
 * E2EE Test Data Factory
 *
 * Provides test data builders for encryption protocol tests
 */
object E2EETestFactory {

    /**
     * Generate a test identity key pair
     */
    fun generateIdentityKeyPair(): X25519KeyPair {
        return X25519KeyPair.generate()
    }

    /**
     * Generate a test signed pre-key pair
     */
    fun generateSignedPreKeyPair(): X25519KeyPair {
        return X25519KeyPair.generate()
    }

    /**
     * Generate a test one-time pre-key pair
     */
    fun generateOneTimePreKeyPair(): X25519KeyPair {
        return X25519KeyPair.generate()
    }

    /**
     * Generate a test ephemeral key pair
     */
    fun generateEphemeralKeyPair(): X25519KeyPair {
        return X25519KeyPair.generate()
    }

    /**
     * Generate a test PreKey bundle
     */
    fun generatePreKeyBundle(
        identityKeyPair: X25519KeyPair = generateIdentityKeyPair(),
        signedPreKeyPair: X25519KeyPair = generateSignedPreKeyPair(),
        oneTimePreKeyPair: X25519KeyPair? = generateOneTimePreKeyPair()
    ): PreKeyBundle {
        return PreKeyBundle(
            identityKey = identityKeyPair.publicKey,
            signedPreKey = signedPreKeyPair.publicKey,
            signedPreKeySignature = ByteArray(64), // Placeholder signature
            oneTimePreKey = oneTimePreKeyPair?.publicKey
        )
    }

    /**
     * Generate a test Ratchet state for sender
     */
    fun generateSenderRatchetState(
        sharedSecret: ByteArray = ByteArray(32) { it.toByte() },
        sendingRatchetKeyPair: X25519KeyPair = generateEphemeralKeyPair(),
        receivingRatchetKey: ByteArray = generateEphemeralKeyPair().publicKey
    ): DoubleRatchet.RatchetState {
        val ratchet = DoubleRatchet()
        return ratchet.initializeSender(
            sharedSecret = sharedSecret,
            sendingRatchetKeyPair = sendingRatchetKeyPair,
            receivingRatchetKey = receivingRatchetKey
        )
    }

    /**
     * Generate a test Ratchet state for receiver
     */
    fun generateReceiverRatchetState(
        sharedSecret: ByteArray = ByteArray(32) { it.toByte() },
        receivingRatchetKeyPair: X25519KeyPair = generateEphemeralKeyPair()
    ): DoubleRatchet.RatchetState {
        val ratchet = DoubleRatchet()
        return ratchet.initializeReceiver(
            sharedSecret = sharedSecret,
            receivingRatchetKeyPair = receivingRatchetKeyPair
        )
    }

    /**
     * Generate a test message header
     */
    fun generateMessageHeader(
        ratchetKey: ByteArray = generateEphemeralKeyPair().publicKey,
        previousChainLength: Int = 0,
        messageNumber: Int = 0
    ): MessageHeader {
        return MessageHeader(
            ratchetKey = ratchetKey,
            previousChainLength = previousChainLength,
            messageNumber = messageNumber
        )
    }

    /**
     * Generate a test RatchetMessage
     */
    fun generateRatchetMessage(
        header: MessageHeader = generateMessageHeader(),
        ciphertext: ByteArray = ByteArray(48) { it.toByte() } // 32 bytes encrypted + 16 bytes MAC
    ): RatchetMessage {
        return RatchetMessage(
            header = header,
            ciphertext = ciphertext
        )
    }

    /**
     * Generate test plaintext data
     */
    fun generatePlaintext(size: Int = 128): ByteArray {
        return ByteArray(size) { (it % 256).toByte() }
    }

    /**
     * Generate a large test message (for performance testing)
     */
    fun generateLargePlaintext(): ByteArray {
        return ByteArray(10 * 1024 * 1024) { (it % 256).toByte() } // 10MB
    }

    /**
     * Generate test associated data
     */
    fun generateAssociatedData(): ByteArray {
        return "test-associated-data".toByteArray()
    }
}
