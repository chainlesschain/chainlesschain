package com.chainlesschain.android.core.e2ee.verification

import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import org.junit.Test
import org.junit.Assert.*

/**
 * SafetyNumbers 测试
 */
class SafetyNumbersTest {

    @Test
    fun `test generate safety number`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()

        // When
        val safetyNumber = SafetyNumbers.generate(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Then
        assertNotNull(safetyNumber)
        // Safety number 应该是 60 位数字 + 4 个空格
        assertEquals(64, safetyNumber.length)
        assertTrue(safetyNumber.matches(Regex("\\d{12} \\d{12} \\d{12} \\d{12} \\d{12}")))
    }

    @Test
    fun `test safety number is symmetric`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()

        // When - Alice 和 Bob 生成的安全码应该相同
        val aliceSafetyNumber = SafetyNumbers.generate(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        val bobSafetyNumber = SafetyNumbers.generate(
            bobIdentifier,
            bobKeyPair.publicKey,
            aliceIdentifier,
            aliceKeyPair.publicKey
        )

        // Then
        assertEquals(aliceSafetyNumber, bobSafetyNumber)
    }

    @Test
    fun `test different keys produce different safety numbers`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair1 = X25519KeyPair.generate()
        val aliceKeyPair2 = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()

        // When
        val safetyNumber1 = SafetyNumbers.generate(
            aliceIdentifier,
            aliceKeyPair1.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        val safetyNumber2 = SafetyNumbers.generate(
            aliceIdentifier,
            aliceKeyPair2.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Then
        assertNotEquals(safetyNumber1, safetyNumber2)
    }

    @Test
    fun `test generate QR code data`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()

        // When
        val qrCodeData = SafetyNumbers.generateQRCodeData(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Then
        assertNotNull(qrCodeData)
        assertTrue(qrCodeData.isNotEmpty())
    }

    @Test
    fun `test verify QR code data success`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()

        // Alice 生成二维码
        val aliceQRCode = SafetyNumbers.generateQRCodeData(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // When - Bob 扫描 Alice 的二维码
        val result = SafetyNumbers.verifyQRCodeData(
            aliceQRCode,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Then
        assertTrue(result is VerificationResult.Valid)
        val validResult = result as VerificationResult.Valid
        assertEquals(aliceIdentifier, validResult.remoteIdentifier)
        assertArrayEquals(aliceKeyPair.publicKey, validResult.remotePublicKey)
    }

    @Test
    fun `test verify QR code data with wrong identifier`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()
        val charlieIdentifier = "did:key:charlie"

        // Alice 生成二维码（预期 Bob 扫描）
        val aliceQRCode = SafetyNumbers.generateQRCodeData(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // When - Charlie 扫描 Alice 的二维码（预期是 Bob 扫描）
        val result = SafetyNumbers.verifyQRCodeData(
            aliceQRCode,
            charlieIdentifier, // Wrong identifier
            bobKeyPair.publicKey
        )

        // Then
        assertTrue(result is VerificationResult.Mismatch)
    }

    @Test
    fun `test verify QR code data with wrong public key`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()
        val wrongKeyPair = X25519KeyPair.generate()

        // Alice 生成二维码
        val aliceQRCode = SafetyNumbers.generateQRCodeData(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // When - Bob 使用错误的密钥验证
        val result = SafetyNumbers.verifyQRCodeData(
            aliceQRCode,
            bobIdentifier,
            wrongKeyPair.publicKey // Wrong key
        )

        // Then
        assertTrue(result is VerificationResult.Mismatch)
    }

    @Test
    fun `test verify invalid QR code data`() {
        // Given
        val invalidQRCode = "invalid_base64_data"
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()

        // When
        val result = SafetyNumbers.verifyQRCodeData(
            invalidQRCode,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Then
        assertTrue(result is VerificationResult.Invalid)
    }

    @Test
    fun `test compare safety numbers`() {
        // Given
        val safetyNumber1 = "123456789012 234567890123 345678901234 456789012345 567890123456"
        val safetyNumber2 = "123456789012 234567890123 345678901234 456789012345 567890123456"
        val safetyNumber3 = "123456789012 234567890123 345678901234 456789012345 567890123457"

        // When/Then
        assertTrue(SafetyNumbers.compare(safetyNumber1, safetyNumber2))
        assertFalse(SafetyNumbers.compare(safetyNumber1, safetyNumber3))
    }

    @Test
    fun `test compare safety numbers ignores spaces`() {
        // Given
        val safetyNumber1 = "123456789012 234567890123 345678901234 456789012345 567890123456"
        val safetyNumber2 = "123456789012234567890123345678901234456789012345567890123456"

        // When/Then
        assertTrue(SafetyNumbers.compare(safetyNumber1, safetyNumber2))
    }

    @Test
    fun `test safety number is deterministic`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()

        // When - 多次生成应该得到相同的安全码
        val safetyNumber1 = SafetyNumbers.generate(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        val safetyNumber2 = SafetyNumbers.generate(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Then
        assertEquals(safetyNumber1, safetyNumber2)
    }

    @Test
    fun `test full workflow - Alice and Bob verify each other`() {
        // Given
        val aliceIdentifier = "did:key:alice"
        val aliceKeyPair = X25519KeyPair.generate()
        val bobIdentifier = "did:key:bob"
        val bobKeyPair = X25519KeyPair.generate()

        // Alice 生成她的安全码
        val aliceSafetyNumber = SafetyNumbers.generate(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Bob 生成他的安全码
        val bobSafetyNumber = SafetyNumbers.generate(
            bobIdentifier,
            bobKeyPair.publicKey,
            aliceIdentifier,
            aliceKeyPair.publicKey
        )

        // Alice 生成二维码
        val aliceQRCode = SafetyNumbers.generateQRCodeData(
            aliceIdentifier,
            aliceKeyPair.publicKey,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Bob 扫描 Alice 的二维码
        val bobVerification = SafetyNumbers.verifyQRCodeData(
            aliceQRCode,
            bobIdentifier,
            bobKeyPair.publicKey
        )

        // Then
        // 1. 安全码应该相同
        assertTrue(SafetyNumbers.compare(aliceSafetyNumber, bobSafetyNumber))

        // 2. 二维码验证应该成功
        assertTrue(bobVerification is VerificationResult.Valid)

        // 3. 验证结果中的安全码应该匹配
        val validResult = bobVerification as VerificationResult.Valid
        assertTrue(SafetyNumbers.compare(validResult.safetyNumber, aliceSafetyNumber))
    }
}
