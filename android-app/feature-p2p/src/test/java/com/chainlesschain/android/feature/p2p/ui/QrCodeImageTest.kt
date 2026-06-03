package com.chainlesschain.android.feature.p2p.ui

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * QrCodeImage 单元测试 — Android v1.1 W3.3a (issue #19)。
 *
 * 只测纯 JVM `encodeBitMatrix`（不涉及 Android Bitmap），Bitmap 转换走
 * instrumented 或手动验证。
 */
class QrCodeImageTest {

    @Test
    fun `encodeBitMatrix returns null for empty text`() {
        assertNull(encodeBitMatrix(""))
    }

    @Test
    fun `encodeBitMatrix returns BitMatrix with requested dimensions`() {
        val matrix = encodeBitMatrix("hello", sizePx = 256)
        assertNotNull(matrix)
        assertEquals(256, matrix!!.width)
        assertEquals(256, matrix.height)
    }

    @Test
    fun `encodeBitMatrix handles Chinese UTF-8 text`() {
        val matrix = encodeBitMatrix("中文配对码-测试")
        assertNotNull(matrix)
        // 不空 — zxing 编码 UTF-8 byte 序列
        assertTrue(matrix!!.width > 0 && matrix.height > 0)
    }

    @Test
    fun `encodeBitMatrix handles JSON-like payload (real-world W3 case)`() {
        // 模拟 PairingQrPayload.encodeToString 的输出形状
        val payload = """{"type":"device-pairing","code":"123456","did":"did:cc:test","deviceInfo":{"deviceId":"abc","name":"Test","platform":"android"},"timestamp":1700000000000}"""
        val matrix = encodeBitMatrix(payload, sizePx = 512)
        assertNotNull(matrix)
        assertEquals(512, matrix!!.width)
    }

    @Test
    fun `encodeBitMatrix produces deterministic output for same input`() {
        val a = encodeBitMatrix("stable-input", sizePx = 256)
        val b = encodeBitMatrix("stable-input", sizePx = 256)
        assertNotNull(a)
        assertNotNull(b)
        // 同 input + size + hints → 同 BitMatrix 内容
        for (x in 0 until a!!.width) {
            for (y in 0 until a.height) {
                assertEquals(a[x, y], b!![x, y], "Mismatch at ($x, $y)")
            }
        }
    }
}
