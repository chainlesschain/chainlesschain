package com.chainlesschain.android.feature.p2p.ui

import com.google.zxing.BarcodeFormat
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * #2 扫码识别 — YUV rowStride 解码修复的单元测试 (纯 JVM, 无需 android.media.Image / 真机)。
 *
 * 相机 Y plane 每行带 padding (rowStride > width)。早先 bug 用 `width` 当 dataWidth →
 * 逐行错位 → 用户表现为"必须完全对齐才偶尔扫得到 / 扫码无法加好友"。修复用 `plane.rowStride`。
 * 这里渲染一张真二维码到带 padding 的亮度缓冲, 断言:
 *   1. 用 rowStride 解码 → 成功还原原文 (修复有效)。
 *   2. 用 width 解码 (旧 bug) → 解不出 (证明该修复确有必要, 非装饰)。
 */
class QrDecodeRowStrideTest {

    /** 把 [text] 编码成 QR, 渲染到 Y-plane 亮度字节: 每行 rowStride 字节 (尾部 padding 列填 0=黑)。 */
    private data class Luma(val bytes: ByteArray, val rowStride: Int, val width: Int, val height: Int)

    private fun renderQrToLuminance(text: String, padding: Int, size: Int = 240): Luma {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
        val w = matrix.width
        val h = matrix.height
        val rowStride = w + padding
        val bytes = ByteArray(rowStride * h)
        for (y in 0 until h) {
            for (x in 0 until w) {
                // QR 模块: 黑=0 (暗), 白=255 (亮)。padding 列保持 0。
                bytes[y * rowStride + x] = if (matrix.get(x, y)) 0 else 255.toByte()
            }
        }
        return Luma(bytes, rowStride, w, h)
    }

    private fun newReader() = MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.TRY_HARDER to true,
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.CHARACTER_SET to "UTF-8",
            ),
        )
    }

    @Test
    fun `decodes add-friend QR when row has padding (rowStride fix)`() {
        val payload = "chainlesschain://add-friend?did=did:key:zAbc12345&sig=deadbeef&ts=1700000000000"
        val luma = renderQrToLuminance(payload, padding = 32)

        val text = decodeQrLuminance(newReader(), luma.bytes, luma.rowStride, luma.width, luma.height)

        assertEquals(payload, text, "用 rowStride 作 dataWidth 应能正确还原二维码内容")
    }

    @Test
    fun `using width-as-dataWidth fails with padding (proves fix is necessary)`() {
        val payload = "chainlesschain://add-friend?did=did:key:zAbc12345&sig=deadbeef&ts=1700000000000"
        val luma = renderQrToLuminance(payload, padding = 32)

        // 旧 bug: 把 width 当 dataWidth (而真实每行是 rowStride 字节) → 逐行错位。
        val text = decodeQrLuminance(newReader(), luma.bytes, luma.width, luma.width, luma.height)

        assertNull(text, "旧路径 (width 当 dataWidth) 在有 padding 时应解不出, 否则修复无意义")
    }

    @Test
    fun `decodes pairing QR with zero padding too`() {
        val payload = "cc-family-invite:eyJ2IjoxLCJnIjoiZ3JwLTEifQ"
        val luma = renderQrToLuminance(payload, padding = 0)

        val text = decodeQrLuminance(newReader(), luma.bytes, luma.rowStride, luma.width, luma.height)

        assertEquals(payload, text, "无 padding (rowStride==width) 时同样应解出")
    }

    @Test
    fun `returns null for a blank (all-white) frame`() {
        val w = 200
        val h = 200
        val rowStride = w + 16
        val bytes = ByteArray(rowStride * h) { 255.toByte() } // 全白 = 无码

        val text = decodeQrLuminance(newReader(), bytes, rowStride, w, h)

        assertNull(text, "空白帧不应误报出二维码")
    }
}
