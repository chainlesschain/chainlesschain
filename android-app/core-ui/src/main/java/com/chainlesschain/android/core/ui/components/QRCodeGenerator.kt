package com.chainlesschain.android.core.ui.components

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.net.URLEncoder

/**
 * 二维码生成工具类
 * 基于ZXing库实现二维码生成和内容编码
 *
 * @since v0.31.0
 */
object QRCodeGenerator {
    /**
     * 生成二维码图片
     *
     * @param content 二维码内容
     * @param size 二维码尺寸（像素），默认512px
     * @param fgColor 前景色（二维码颜色），默认黑色
     * @param bgColor 背景色，默认白色
     * @param logo 中心Logo（可选），建议尺寸为二维码的1/5
     * @return 生成的二维码Bitmap
     * @throws IllegalArgumentException 如果内容为空或尺寸无效
     */
    fun generateQRCode(
        content: String,
        size: Int = 512,
        fgColor: Int = Color.BLACK,
        bgColor: Int = Color.WHITE,
        logo: Bitmap? = null
    ): Bitmap {
        require(content.isNotEmpty()) { "QR code content cannot be empty" }
        require(size > 0) { "QR code size must be positive" }

        // 配置ZXing编码参数
        val hints = hashMapOf<EncodeHintType, Any>()
        hints[EncodeHintType.CHARACTER_SET] = "UTF-8"
        hints[EncodeHintType.ERROR_CORRECTION] = ErrorCorrectionLevel.H // 高纠错级别（30%容错）
        hints[EncodeHintType.MARGIN] = 1 // 边距（最小值）

        // 生成二维码矩阵
        val bitMatrix = MultiFormatWriter().encode(
            content,
            BarcodeFormat.QR_CODE,
            size,
            size,
            hints
        )

        // 将矩阵转换为Bitmap
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        for (x in 0 until size) {
            for (y in 0 until size) {
                bitmap.setPixel(x, y, if (bitMatrix[x, y]) fgColor else bgColor)
            }
        }

        // 添加中心Logo（可选）
        logo?.let {
            addLogoToBitmap(bitmap, it, bgColor)
        }

        return bitmap
    }

    /**
     * 在二维码中心添加Logo
     *
     * @param qrBitmap 二维码Bitmap
     * @param logo Logo Bitmap
     * @param bgColor 背景色（用于Logo周围的白色边框）
     */
    private fun addLogoToBitmap(qrBitmap: Bitmap, logo: Bitmap, bgColor: Int) {
        val qrSize = qrBitmap.width
        val logoSize = qrSize / 5
        val scaledLogo = Bitmap.createScaledBitmap(logo, logoSize, logoSize, false)

        val canvas = Canvas(qrBitmap)

        // 绘制Logo背景（白色边框，避免与二维码冲突）
        val paint = Paint().apply {
            color = bgColor
            style = Paint.Style.FILL
            isAntiAlias = true
        }
        val logoBackgroundSize = logoSize + 20
        canvas.drawRect(
            (qrSize - logoBackgroundSize) / 2f,
            (qrSize - logoBackgroundSize) / 2f,
            (qrSize + logoBackgroundSize) / 2f,
            (qrSize + logoBackgroundSize) / 2f,
            paint
        )

        // 绘制Logo
        canvas.drawBitmap(
            scaledLogo,
            (qrSize - logoSize) / 2f,
            (qrSize - logoSize) / 2f,
            null
        )

        scaledLogo.recycle()
    }

    /**
     * 生成DID二维码（包含签名验证）
     *
     * URL格式: chainlesschain://add-friend?did={did}&sig={signature}&ts={timestamp}
     *
     * @param did 用户DID
     * @param signature 签名（用户私钥对时间戳的签名）
     * @return 二维码URL格式字符串
     */
    fun generateDIDQRCode(did: String, signature: String): String {
        return buildString {
            append("chainlesschain://add-friend?")
            append("did=").append(URLEncoder.encode(did, "UTF-8"))
            append("&sig=").append(URLEncoder.encode(signature, "UTF-8"))
            append("&ts=").append(System.currentTimeMillis())
        }
    }

    /**
     * 生成动态分享二维码
     *
     * URL格式: chainlesschain://post?id={postId}
     *
     * @param postId 动态ID
     * @return 二维码URL格式字符串
     */
    fun generatePostShareQRCode(postId: String): String {
        return buildString {
            append("chainlesschain://post?")
            append("id=").append(URLEncoder.encode(postId, "UTF-8"))
        }
    }

    /**
     * 生成群组邀请二维码
     *
     * URL格式: chainlesschain://group?id={groupId}&invite={inviteCode}
     *
     * @param groupId 群组ID
     * @param inviteCode 邀请码
     * @return 二维码URL格式字符串
     */
    fun generateGroupInviteQRCode(groupId: String, inviteCode: String): String {
        return buildString {
            append("chainlesschain://group?")
            append("id=").append(URLEncoder.encode(groupId, "UTF-8"))
            append("&invite=").append(URLEncoder.encode(inviteCode, "UTF-8"))
        }
    }

    /**
     * 验证二维码URL格式是否有效
     *
     * @param url 二维码URL
     * @return true=有效，false=无效
     */
    fun isValidChainlessChainQRCode(url: String): Boolean {
        return url.startsWith("chainlesschain://") &&
               (url.contains("add-friend") || url.contains("post") || url.contains("group"))
    }
}
