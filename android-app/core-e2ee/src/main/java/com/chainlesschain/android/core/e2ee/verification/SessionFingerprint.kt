package com.chainlesschain.android.core.e2ee.verification

import android.util.Log
import java.security.MessageDigest

/**
 * 会话指纹
 *
 * 用于验证会话的完整性和真实性
 */
object SessionFingerprint {

    private const val TAG = "SessionFingerprint"

    /**
     * 生成会话指纹
     *
     * 基于双方的身份密钥和会话的关联数据生成唯一指纹
     *
     * @param localPublicKey 本地公钥
     * @param remotePublicKey 远程公钥
     * @param associatedData 关联数据（X3DH 生成）
     * @return 指纹字符串（16进制）
     */
    fun generate(
        localPublicKey: ByteArray,
        remotePublicKey: ByteArray,
        associatedData: ByteArray
    ): String {
        Log.d(TAG, "Generating session fingerprint")

        // 确保顺序一致
        val (firstKey, secondKey) = if (compareKeys(localPublicKey, remotePublicKey) < 0) {
            Pair(localPublicKey, remotePublicKey)
        } else {
            Pair(remotePublicKey, localPublicKey)
        }

        // 组合数据
        val combinedData = firstKey + secondKey + associatedData

        // SHA-256 哈希
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(combinedData)

        // 转换为 16 进制字符串
        return hash.joinToString("") { "%02x".format(it) }
    }

    /**
     * 生成简短指纹
     *
     * 用于 UI 显示的简短版本（前 16 个字符）
     *
     * @param fullFingerprint 完整指纹
     * @return 简短指纹
     */
    fun generateShort(fullFingerprint: String): String {
        require(fullFingerprint.length >= 16) { "Fingerprint too short" }
        return fullFingerprint.substring(0, 16)
    }

    /**
     * 格式化指纹
     *
     * 将指纹格式化为易读的形式
     *
     * @param fingerprint 指纹
     * @param groupSize 每组的字符数（默认4）
     * @return 格式化的指纹
     */
    fun format(fingerprint: String, groupSize: Int = 4): String {
        return fingerprint.chunked(groupSize).joinToString(" ")
    }

    /**
     * 验证指纹
     *
     * @param localPublicKey 本地公钥
     * @param remotePublicKey 远程公钥
     * @param associatedData 关联数据
     * @param expectedFingerprint 期望的指纹
     * @return 是否匹配
     */
    fun verify(
        localPublicKey: ByteArray,
        remotePublicKey: ByteArray,
        associatedData: ByteArray,
        expectedFingerprint: String
    ): Boolean {
        val actualFingerprint = generate(localPublicKey, remotePublicKey, associatedData)
        return actualFingerprint.equals(expectedFingerprint, ignoreCase = true)
    }

    /**
     * 比较两个密钥的字典序
     */
    private fun compareKeys(key1: ByteArray, key2: ByteArray): Int {
        val minLength = minOf(key1.size, key2.size)
        for (i in 0 until minLength) {
            val cmp = (key1[i].toInt() and 0xFF).compareTo(key2[i].toInt() and 0xFF)
            if (cmp != 0) return cmp
        }
        return key1.size.compareTo(key2.size)
    }

    /**
     * 生成彩色指纹（用于 UI 可视化）
     *
     * @param fingerprint 指纹
     * @return 颜色数组（RGB）
     */
    fun generateColorFingerprint(fingerprint: String): List<FingerprintColor> {
        val colors = mutableListOf<FingerprintColor>()

        // 取前 24 个字符（8 组，每组 3 个字符）
        val colorData = fingerprint.take(24)

        for (i in 0 until 8) {
            if (i * 3 + 2 < colorData.length) {
                val colorValue = colorData.substring(i * 3, i * 3 + 3)
                val rgb = colorValue.toInt(16)
                colors.add(
                    FingerprintColor(
                        r = (rgb shr 8) and 0xF,
                        g = (rgb shr 4) and 0xF,
                        b = rgb and 0xF
                    )
                )
            }
        }

        return colors
    }
}

/**
 * 指纹颜色
 */
data class FingerprintColor(
    val r: Int, // 0-15
    val g: Int, // 0-15
    val b: Int  // 0-15
) {
    /**
     * 转换为 Android Color
     */
    fun toAndroidColor(): Int {
        val r8 = (r * 255) / 15
        val g8 = (g * 255) / 15
        val b8 = (b * 255) / 15
        return android.graphics.Color.rgb(r8, g8, b8)
    }

    /**
     * 转换为 CSS 颜色
     */
    fun toCssColor(): String {
        val r8 = (r * 255) / 15
        val g8 = (g * 255) / 15
        val b8 = (b * 255) / 15
        return "rgb($r8, $g8, $b8)"
    }
}

/**
 * 会话验证信息
 */
data class SessionVerificationInfo(
    /** 会话指纹 */
    val fingerprint: String,

    /** 简短指纹 */
    val shortFingerprint: String,

    /** 格式化指纹 */
    val formattedFingerprint: String,

    /** 彩色指纹 */
    val colorFingerprint: List<FingerprintColor>,

    /** 本地公钥 */
    val localPublicKey: ByteArray,

    /** 远程公钥 */
    val remotePublicKey: ByteArray,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as SessionVerificationInfo

        if (fingerprint != other.fingerprint) return false
        if (shortFingerprint != other.shortFingerprint) return false
        if (formattedFingerprint != other.formattedFingerprint) return false
        if (colorFingerprint != other.colorFingerprint) return false
        if (!localPublicKey.contentEquals(other.localPublicKey)) return false
        if (!remotePublicKey.contentEquals(other.remotePublicKey)) return false
        if (createdAt != other.createdAt) return false

        return true
    }

    override fun hashCode(): Int {
        var result = fingerprint.hashCode()
        result = 31 * result + shortFingerprint.hashCode()
        result = 31 * result + formattedFingerprint.hashCode()
        result = 31 * result + colorFingerprint.hashCode()
        result = 31 * result + localPublicKey.contentHashCode()
        result = 31 * result + remotePublicKey.contentHashCode()
        result = 31 * result + createdAt.hashCode()
        return result
    }
}
