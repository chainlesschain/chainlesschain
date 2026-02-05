package com.chainlesschain.android.core.e2ee

import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import java.security.Security

/**
 * 诊断测试 - 验证密钥推导一致性
 */
class DiagnosticTest {

    @Before
    fun setupBouncyCastle() {
        // 注册BouncyCastle安全提供者
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(BouncyCastleProvider())
        }
    }

    @Test
    fun `X3DH should produce same shared secret for both parties`() {
        // Given - Generate keys
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val aliceEphemeralKeyPair = X25519KeyPair.generate()

        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        // Bob publishes pre-key bundle
        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        // When - Alice performs X3DH
        val aliceResult = X3DHKeyExchange.senderX3DH(
            aliceIdentityKeyPair,
            aliceEphemeralKeyPair,
            bobPreKeyBundle
        )

        // Bob performs X3DH
        val bobResult = X3DHKeyExchange.receiverX3DH(
            bobIdentityKeyPair,
            bobSignedPreKeyPair,
            null,
            aliceIdentityKeyPair.publicKey,
            aliceEphemeralKeyPair.publicKey
        )

        // Then - Shared secrets should match
        println("Alice shared secret: ${aliceResult.sharedSecret.joinToString("") { "%02x".format(it) }}")
        println("Bob shared secret:   ${bobResult.sharedSecret.joinToString("") { "%02x".format(it) }}")

        assertArrayEquals(
            "X3DH shared secrets should match",
            aliceResult.sharedSecret,
            bobResult.sharedSecret
        )

        // Associated data should also match
        assertArrayEquals(
            "Associated data should match",
            aliceResult.associatedData,
            bobResult.associatedData
        )
    }

    @Test
    fun `DH key agreement should be symmetric`() {
        // Given
        val keyPair1 = X25519KeyPair.generate()
        val keyPair2 = X25519KeyPair.generate()

        // When
        val secret1 = keyPair1.computeSharedSecret(keyPair2.publicKey)
        val secret2 = keyPair2.computeSharedSecret(keyPair1.publicKey)

        // Then
        println("Secret 1: ${secret1.joinToString("") { "%02x".format(it) }}")
        println("Secret 2: ${secret2.joinToString("") { "%02x".format(it) }}")

        assertArrayEquals("DH shared secrets should be symmetric", secret1, secret2)
        assertEquals("DH secret should be 32 bytes", 32, secret1.size)
    }
}
