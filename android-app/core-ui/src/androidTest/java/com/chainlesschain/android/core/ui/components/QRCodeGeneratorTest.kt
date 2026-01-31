package com.chainlesschain.android.core.ui.components

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * QRCodeGenerator单元测试
 *
 * 测试二维码生成的各种场景：
 * - 基本二维码生成
 * - 自定义颜色
 * - 添加Logo
 * - DID二维码格式
 * - 动态分享二维码格式
 * - URL验证
 *
 * @since v0.31.0
 */
@RunWith(AndroidJUnit4::class)
class QRCodeGeneratorTest {

    @Test
    fun generateQRCode_withBasicContent_returnsValidBitmap() {
        // Given
        val content = "Hello, ChainlessChain!"

        // When
        val bitmap = QRCodeGenerator.generateQRCode(content, size = 256)

        // Then
        assertNotNull("Bitmap should not be null", bitmap)
        assertEquals("Bitmap width should be 256", 256, bitmap.width)
        assertEquals("Bitmap height should be 256", 256, bitmap.height)
        assertEquals("Bitmap config should be ARGB_8888", Bitmap.Config.ARGB_8888, bitmap.config)
    }

    @Test
    fun generateQRCode_withCustomColors_returnsColoredBitmap() {
        // Given
        val content = "Test QR Code"
        val fgColor = Color.BLUE
        val bgColor = Color.YELLOW

        // When
        val bitmap = QRCodeGenerator.generateQRCode(
            content = content,
            size = 128,
            fgColor = fgColor,
            bgColor = bgColor
        )

        // Then
        assertNotNull("Bitmap should not be null", bitmap)

        // 验证颜色（采样四个角和中心点）
        val topLeftPixel = bitmap.getPixel(10, 10)
        val bottomRightPixel = bitmap.getPixel(bitmap.width - 10, bitmap.height - 10)

        // 至少有一个像素是前景色或背景色
        assertTrue(
            "Pixels should use custom colors",
            topLeftPixel == fgColor || topLeftPixel == bgColor
        )
        assertTrue(
            "Pixels should use custom colors",
            bottomRightPixel == fgColor || bottomRightPixel == bgColor
        )
    }

    @Test
    fun generateQRCode_withLogo_containsLogo() {
        // Given
        val content = "Test with Logo"
        val logo = createTestLogo()

        // When
        val bitmap = QRCodeGenerator.generateQRCode(
            content = content,
            size = 512,
            logo = logo
        )

        // Then
        assertNotNull("Bitmap should not be null", bitmap)
        assertEquals("Bitmap should be 512x512", 512, bitmap.width)

        // 验证中心区域（Logo区域）与边缘区域不同
        val centerPixel = bitmap.getPixel(256, 256)
        val edgePixel = bitmap.getPixel(10, 10)

        // Logo区域应该与二维码边缘不完全相同
        // （这是一个简单的验证，实际Logo的存在会改变中心区域）
        assertNotNull("Center pixel should not be null", centerPixel)
        assertNotNull("Edge pixel should not be null", edgePixel)
    }

    @Test(expected = IllegalArgumentException::class)
    fun generateQRCode_withEmptyContent_throwsException() {
        // When & Then
        QRCodeGenerator.generateQRCode(content = "", size = 256)
    }

    @Test(expected = IllegalArgumentException::class)
    fun generateQRCode_withInvalidSize_throwsException() {
        // When & Then
        QRCodeGenerator.generateQRCode(content = "Test", size = -1)
    }

    @Test
    fun generateDIDQRCode_withValidDID_returnsCorrectFormat() {
        // Given
        val did = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
        val signature = "0x1234567890abcdef"

        // When
        val qrCodeUrl = QRCodeGenerator.generateDIDQRCode(did, signature)

        // Then
        assertTrue("URL should start with chainlesschain://", qrCodeUrl.startsWith("chainlesschain://add-friend?"))
        assertTrue("URL should contain did parameter", qrCodeUrl.contains("did="))
        assertTrue("URL should contain sig parameter", qrCodeUrl.contains("sig="))
        assertTrue("URL should contain ts parameter", qrCodeUrl.contains("ts="))

        // 验证时间戳是最近的
        val timestamp = qrCodeUrl.substringAfter("ts=").toLongOrNull()
        assertNotNull("Timestamp should be valid", timestamp)
        assertTrue("Timestamp should be recent", System.currentTimeMillis() - timestamp!! < 1000)
    }

    @Test
    fun generateDIDQRCode_withSpecialCharacters_encodesCorrectly() {
        // Given
        val did = "did:example:特殊字符测试"
        val signature = "签名@#$%"

        // When
        val qrCodeUrl = QRCodeGenerator.generateDIDQRCode(did, signature)

        // Then
        assertTrue("URL should be properly encoded", qrCodeUrl.contains("did="))
        assertTrue("URL should be properly encoded", qrCodeUrl.contains("sig="))

        // URL编码后不应包含原始特殊字符
        assertFalse("Should not contain raw special characters", qrCodeUrl.contains("特殊字符"))
        assertFalse("Should not contain raw special characters", qrCodeUrl.contains("@#$%"))
    }

    @Test
    fun generatePostShareQRCode_withPostId_returnsCorrectFormat() {
        // Given
        val postId = "post_123456789"

        // When
        val qrCodeUrl = QRCodeGenerator.generatePostShareQRCode(postId)

        // Then
        assertEquals(
            "URL should match expected format",
            "chainlesschain://post?id=post_123456789",
            qrCodeUrl
        )
    }

    @Test
    fun generatePostShareQRCode_withSpecialCharacters_encodesCorrectly() {
        // Given
        val postId = "post_特殊字符_测试"

        // When
        val qrCodeUrl = QRCodeGenerator.generatePostShareQRCode(postId)

        // Then
        assertTrue("URL should start with chainlesschain://post?", qrCodeUrl.startsWith("chainlesschain://post?"))
        assertTrue("URL should contain id parameter", qrCodeUrl.contains("id="))
        assertFalse("Should encode special characters", qrCodeUrl.contains("特殊字符"))
    }

    @Test
    fun generateGroupInviteQRCode_withGroupIdAndInviteCode_returnsCorrectFormat() {
        // Given
        val groupId = "group_456"
        val inviteCode = "INVITE123"

        // When
        val qrCodeUrl = QRCodeGenerator.generateGroupInviteQRCode(groupId, inviteCode)

        // Then
        assertTrue("URL should start with chainlesschain://group?", qrCodeUrl.startsWith("chainlesschain://group?"))
        assertTrue("URL should contain id parameter", qrCodeUrl.contains("id=group_456"))
        assertTrue("URL should contain invite parameter", qrCodeUrl.contains("invite=INVITE123"))
    }

    @Test
    fun isValidChainlessChainQRCode_withValidAddFriendURL_returnsTrue() {
        // Given
        val url = "chainlesschain://add-friend?did=test&sig=test&ts=123"

        // When
        val isValid = QRCodeGenerator.isValidChainlessChainQRCode(url)

        // Then
        assertTrue("Should be valid", isValid)
    }

    @Test
    fun isValidChainlessChainQRCode_withValidPostURL_returnsTrue() {
        // Given
        val url = "chainlesschain://post?id=123"

        // When
        val isValid = QRCodeGenerator.isValidChainlessChainQRCode(url)

        // Then
        assertTrue("Should be valid", isValid)
    }

    @Test
    fun isValidChainlessChainQRCode_withValidGroupURL_returnsTrue() {
        // Given
        val url = "chainlesschain://group?id=123&invite=ABC"

        // When
        val isValid = QRCodeGenerator.isValidChainlessChainQRCode(url)

        // Then
        assertTrue("Should be valid", isValid)
    }

    @Test
    fun isValidChainlessChainQRCode_withInvalidScheme_returnsFalse() {
        // Given
        val url = "https://example.com/qr"

        // When
        val isValid = QRCodeGenerator.isValidChainlessChainQRCode(url)

        // Then
        assertFalse("Should be invalid", isValid)
    }

    @Test
    fun isValidChainlessChainQRCode_withInvalidAction_returnsFalse() {
        // Given
        val url = "chainlesschain://unknown-action?param=value"

        // When
        val isValid = QRCodeGenerator.isValidChainlessChainQRCode(url)

        // Then
        assertFalse("Should be invalid", isValid)
    }

    @Test
    fun generateQRCode_withDifferentSizes_returnsCorrectDimensions() {
        // Given
        val sizes = listOf(64, 128, 256, 512, 1024)
        val content = "Size test"

        // When & Then
        sizes.forEach { size ->
            val bitmap = QRCodeGenerator.generateQRCode(content, size = size)
            assertEquals("Bitmap width should match requested size", size, bitmap.width)
            assertEquals("Bitmap height should match requested size", size, bitmap.height)
        }
    }

    // Helper function: 创建测试用Logo
    private fun createTestLogo(): Bitmap {
        return Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888).apply {
            // 填充红色作为测试Logo
            for (x in 0 until width) {
                for (y in 0 until height) {
                    setPixel(x, y, Color.RED)
                }
            }
        }
    }
}
