package com.chainlesschain.android.core.e2ee.verification

import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import java.security.Security

/**
 * SessionFingerprint 测试
 */
class SessionFingerprintTest {

    @Before
    fun setupBouncyCastle() {
        // 注册BouncyCastle安全提供者（用于X25519加密）
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(BouncyCastleProvider())
        }
    }

    @Test
    fun `test generate fingerprint`() {
        // Given
        val localKeyPair = X25519KeyPair.generate()
        val remoteKeyPair = X25519KeyPair.generate()
        val associatedData = ByteArray(32) { it.toByte() }

        // When
        val fingerprint = SessionFingerprint.generate(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData
        )

        // Then
        assertNotNull(fingerprint)
        assertEquals(64, fingerprint.length) // SHA-256 = 64 hex chars
        assertTrue(fingerprint.matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun `test fingerprint is symmetric`() {
        // Given
        val aliceKeyPair = X25519KeyPair.generate()
        val bobKeyPair = X25519KeyPair.generate()
        val associatedData = ByteArray(32) { it.toByte() }

        // When - Alice 和 Bob 生成的指纹应该相同
        val aliceFingerprint = SessionFingerprint.generate(
            aliceKeyPair.publicKey,
            bobKeyPair.publicKey,
            associatedData
        )

        val bobFingerprint = SessionFingerprint.generate(
            bobKeyPair.publicKey,
            aliceKeyPair.publicKey,
            associatedData
        )

        // Then
        assertEquals(aliceFingerprint, bobFingerprint)
    }

    @Test
    fun `test different associated data produces different fingerprint`() {
        // Given
        val localKeyPair = X25519KeyPair.generate()
        val remoteKeyPair = X25519KeyPair.generate()
        val associatedData1 = ByteArray(32) { 1 }
        val associatedData2 = ByteArray(32) { 2 }

        // When
        val fingerprint1 = SessionFingerprint.generate(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData1
        )

        val fingerprint2 = SessionFingerprint.generate(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData2
        )

        // Then
        assertNotEquals(fingerprint1, fingerprint2)
    }

    @Test
    fun `test generate short fingerprint`() {
        // Given
        val fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

        // When
        val shortFingerprint = SessionFingerprint.generateShort(fingerprint)

        // Then
        assertEquals(16, shortFingerprint.length)
        assertEquals("0123456789abcdef", shortFingerprint)
    }

    @Test
    fun `test format fingerprint`() {
        // Given
        val fingerprint = "0123456789abcdef"

        // When
        val formatted = SessionFingerprint.format(fingerprint, groupSize = 4)

        // Then
        assertEquals("0123 4567 89ab cdef", formatted)
    }

    @Test
    fun `test verify fingerprint success`() {
        // Given
        val localKeyPair = X25519KeyPair.generate()
        val remoteKeyPair = X25519KeyPair.generate()
        val associatedData = ByteArray(32) { it.toByte() }

        val expectedFingerprint = SessionFingerprint.generate(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData
        )

        // When
        val isValid = SessionFingerprint.verify(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData,
            expectedFingerprint
        )

        // Then
        assertTrue(isValid)
    }

    @Test
    fun `test verify fingerprint failure`() {
        // Given
        val localKeyPair = X25519KeyPair.generate()
        val remoteKeyPair = X25519KeyPair.generate()
        val associatedData = ByteArray(32) { it.toByte() }
        val wrongFingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

        // When
        val isValid = SessionFingerprint.verify(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData,
            wrongFingerprint
        )

        // Then
        assertFalse(isValid)
    }

    @Test
    fun `test generate color fingerprint`() {
        // Given
        val fingerprint = "123456789abcdef012345"

        // When
        val colorFingerprint = SessionFingerprint.generateColorFingerprint(fingerprint)

        // Then
        assertEquals(8, colorFingerprint.size)
        colorFingerprint.forEach { color ->
            assertTrue(color.r in 0..15)
            assertTrue(color.g in 0..15)
            assertTrue(color.b in 0..15)
        }
    }

    @Test
    fun `test fingerprint color to android color`() {
        // Given
        val color = FingerprintColor(15, 15, 15) // 白色

        // When
        val androidColor = color.toAndroidColor()

        // Then
        assertEquals(android.graphics.Color.WHITE, androidColor)
    }

    @Test
    fun `test fingerprint color to CSS color`() {
        // Given
        val color = FingerprintColor(15, 0, 0) // 红色

        // When
        val cssColor = color.toCssColor()

        // Then
        assertEquals("rgb(255, 0, 0)", cssColor)
    }

    @Test
    fun `test fingerprint is deterministic`() {
        // Given
        val localKeyPair = X25519KeyPair.generate()
        val remoteKeyPair = X25519KeyPair.generate()
        val associatedData = ByteArray(32) { it.toByte() }

        // When - 多次生成应该得到相同的指纹
        val fingerprint1 = SessionFingerprint.generate(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData
        )

        val fingerprint2 = SessionFingerprint.generate(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData
        )

        // Then
        assertEquals(fingerprint1, fingerprint2)
    }

    @Test
    fun `test format with different group sizes`() {
        // Given
        val fingerprint = "0123456789abcdef"

        // When
        val formatted2 = SessionFingerprint.format(fingerprint, groupSize = 2)
        val formatted4 = SessionFingerprint.format(fingerprint, groupSize = 4)
        val formatted8 = SessionFingerprint.format(fingerprint, groupSize = 8)

        // Then
        assertEquals("01 23 45 67 89 ab cd ef", formatted2)
        assertEquals("0123 4567 89ab cdef", formatted4)
        assertEquals("01234567 89abcdef", formatted8)
    }

    @Test
    fun `test verify is case insensitive`() {
        // Given
        val localKeyPair = X25519KeyPair.generate()
        val remoteKeyPair = X25519KeyPair.generate()
        val associatedData = ByteArray(32) { it.toByte() }

        val fingerprint = SessionFingerprint.generate(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData
        )

        val uppercaseFingerprint = fingerprint.uppercase()

        // When
        val isValid = SessionFingerprint.verify(
            localKeyPair.publicKey,
            remoteKeyPair.publicKey,
            associatedData,
            uppercaseFingerprint
        )

        // Then
        assertTrue(isValid)
    }

    @Test
    fun `test different keys produce different fingerprints`() {
        // Given
        val aliceKeyPair = X25519KeyPair.generate()
        val bobKeyPair = X25519KeyPair.generate()
        val charlieKeyPair = X25519KeyPair.generate()
        val associatedData = ByteArray(32) { it.toByte() }

        // When
        val fingerprint1 = SessionFingerprint.generate(
            aliceKeyPair.publicKey,
            bobKeyPair.publicKey,
            associatedData
        )

        val fingerprint2 = SessionFingerprint.generate(
            aliceKeyPair.publicKey,
            charlieKeyPair.publicKey,
            associatedData
        )

        // Then
        assertNotEquals(fingerprint1, fingerprint2)
    }
}
