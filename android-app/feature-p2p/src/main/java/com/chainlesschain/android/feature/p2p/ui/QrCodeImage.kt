package com.chainlesschain.android.feature.p2p.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.WriterException
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import timber.log.Timber

/**
 * QR 码 Compose helper — Android v1.1 W3.3a (issue #19)。
 *
 * 用 com.google.zxing:core 生成 QR BitMatrix → Android Bitmap → Compose ImageBitmap。
 * 不依赖 zxing-android-embedded（避免拉入 ZXing 全套扫描 UI 依赖）。
 *
 * 错误处理：encode 抛 [WriterException] 时（text 过长 / 字符 unsupported）返回 null，
 * 调用方 fallback 到文字展示。
 *
 * **Why** ECC Level H（30% 容错）：QR 在小屏 / 反光 / 远距离扫码下常被部分遮挡，
 * 高容错率显著提升 desktop 摄像头识别成功率，代价是相同 size 容纳数据更少。
 * 配对 payload JSON ~250-300 字节，H 级别足够。
 */
@Composable
fun QrCodeImage(
    text: String,
    size: Dp = 240.dp,
    modifier: Modifier = Modifier,
    eccLevel: ErrorCorrectionLevel = ErrorCorrectionLevel.H,
) {
    if (text.isEmpty()) return

    // remember on text 让相同 payload 不重复 encode，state 变化时自动刷新。
    val bitmap = remember(text, eccLevel) { encodeQrBitmap(text, eccLevel = eccLevel) } ?: return
    Image(
        painter = BitmapPainter(bitmap.asImageBitmap()),
        contentDescription = "QR 配对码",
        modifier = modifier.size(size),
    )
}

/**
 * 纯 JVM encode — 不碰 Android Bitmap，可在标准 JUnit 单测里直接调用验编码。
 * 返回 BitMatrix；调用方再走 [bitMatrixToBitmap] 转 Android Bitmap。
 *
 * 空字符串 / WriterException / IllegalArgumentException 都返回 null。
 */
internal fun encodeBitMatrix(
    text: String,
    sizePx: Int = QR_BITMAP_SIZE_PX,
    eccLevel: ErrorCorrectionLevel = ErrorCorrectionLevel.H,
): BitMatrix? {
    if (text.isEmpty()) {
        Timber.w("[QrCodeImage] encodeBitMatrix: empty text, skipping")
        return null
    }
    return try {
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to eccLevel,
            EncodeHintType.MARGIN to 1, // ECC 自带余量，margin=1 更紧凑
            EncodeHintType.CHARACTER_SET to "UTF-8",
        )
        QRCodeWriter().encode(
            text,
            BarcodeFormat.QR_CODE,
            sizePx,
            sizePx,
            hints,
        )
    } catch (e: WriterException) {
        // payload 过长 / 非法字符 — 走 null fallback
        Timber.w(e, "[QrCodeImage] encode failed, text length=${text.length}")
        null
    } catch (e: IllegalArgumentException) {
        Timber.w(e, "[QrCodeImage] encode IllegalArgumentException")
        null
    }
}

/**
 * BitMatrix → Android Bitmap。Android-only，需 instrumented 或 Robolectric 测试。
 * JVM 单测通过测 [encodeBitMatrix] 间接验证。
 */
internal fun bitMatrixToBitmap(matrix: BitMatrix): Bitmap {
    val w = matrix.width
    val h = matrix.height
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
    for (x in 0 until w) {
        for (y in 0 until h) {
            bmp.setPixel(x, y, if (matrix[x, y]) COLOR_BLACK else COLOR_WHITE)
        }
    }
    return bmp
}

/**
 * Convenience wrapper：encode + convert 一步。Compose 渲染路径用。
 */
internal fun encodeQrBitmap(
    text: String,
    sizePx: Int = QR_BITMAP_SIZE_PX,
    eccLevel: ErrorCorrectionLevel = ErrorCorrectionLevel.H,
): Bitmap? = encodeBitMatrix(text, sizePx, eccLevel)?.let(::bitMatrixToBitmap)

private const val QR_BITMAP_SIZE_PX = 512 // device 上 displayed 自动 scale 到 size Dp
private const val COLOR_BLACK = 0xFF000000.toInt()
private const val COLOR_WHITE = 0xFFFFFFFF.toInt()
