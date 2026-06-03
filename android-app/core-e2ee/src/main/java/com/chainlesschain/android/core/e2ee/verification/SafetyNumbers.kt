package com.chainlesschain.android.core.e2ee.verification

import timber.log.Timber
import java.security.MessageDigest
import java.util.*

/**
 * Safety Numbers（安全码）
 *
 * 类似 Signal 的安全码系统，用于验证端到端加密会话的真实性
 */
object SafetyNumbers {

    private const val VERSION = 1
    private const val ITERATION_COUNT = 5200 // 迭代次数

    /**
     * 生成安全码
     *
     * @param localIdentifier 本地标识符（DID 或用户名）
     * @param localPublicKey 本地公钥（身份密钥）
     * @param remoteIdentifier 远程标识符（DID 或用户名）
     * @param remotePublicKey 远程公钥（身份密钥）
     * @return 安全码字符串（60位数字，分5组）
     */
    fun generate(
        localIdentifier: String,
        localPublicKey: ByteArray,
        remoteIdentifier: String,
        remotePublicKey: ByteArray
    ): String {
        Timber.d("Generating safety number for $localIdentifier <-> $remoteIdentifier")

        // 确保顺序一致（字典序）
        val (firstIdentifier, firstKey, secondIdentifier, secondKey) = if (localIdentifier < remoteIdentifier) {
            arrayOf(localIdentifier, localPublicKey, remoteIdentifier, remotePublicKey)
        } else {
            arrayOf(remoteIdentifier, remotePublicKey, localIdentifier, localPublicKey)
        }

        // 生成第一个指纹
        val firstFingerprint = generateFingerprint(VERSION, firstIdentifier as String, firstKey as ByteArray)

        // 生成第二个指纹
        val secondFingerprint = generateFingerprint(VERSION, secondIdentifier as String, secondKey as ByteArray)

        // 组合指纹
        val combinedFingerprint = firstFingerprint + secondFingerprint

        // 格式化为 60 位数字，分 5 组
        return formatSafetyNumber(combinedFingerprint)
    }

    /**
     * 生成二维码数据
     *
     * @param localIdentifier 本地标识符
     * @param localPublicKey 本地公钥
     * @param remoteIdentifier 远程标识符
     * @param remotePublicKey 远程公钥
     * @return Base64 编码的二维码数据
     */
    fun generateQRCodeData(
        localIdentifier: String,
        localPublicKey: ByteArray,
        remoteIdentifier: String,
        remotePublicKey: ByteArray
    ): String {
        // 格式: version|localId|localKey|remoteId|remoteKey
        val data = buildString {
            append(VERSION)
            append("|")
            append(localIdentifier)
            append("|")
            append(Base64.getEncoder().encodeToString(localPublicKey))
            append("|")
            append(remoteIdentifier)
            append("|")
            append(Base64.getEncoder().encodeToString(remotePublicKey))
        }

        return Base64.getEncoder().encodeToString(data.toByteArray(Charsets.UTF_8))
    }

    /**
     * 验证二维码数据
     *
     * 扫描对方的二维码后，验证安全码是否匹配
     *
     * @param qrCodeData 扫描的二维码数据
     * @param localIdentifier 本地标识符
     * @param localPublicKey 本地公钥
     * @return 验证结果
     */
    fun verifyQRCodeData(
        qrCodeData: String,
        localIdentifier: String,
        localPublicKey: ByteArray
    ): VerificationResult {
        return try {
            val decodedData = String(Base64.getDecoder().decode(qrCodeData), Charsets.UTF_8)
            val parts = decodedData.split("|")

            if (parts.size != 5) {
                return VerificationResult.Invalid("Invalid QR code format")
            }

            val version = parts[0].toInt()
            if (version != VERSION) {
                return VerificationResult.Invalid("Unsupported version: $version")
            }

            val remoteIdentifier = parts[1]
            val remotePublicKey = Base64.getDecoder().decode(parts[2])
            val expectedLocalIdentifier = parts[3]
            val expectedLocalPublicKey = Base64.getDecoder().decode(parts[4])

            // 验证本地信息是否匹配
            if (expectedLocalIdentifier != localIdentifier) {
                return VerificationResult.Mismatch("Identifier mismatch")
            }

            if (!expectedLocalPublicKey.contentEquals(localPublicKey)) {
                return VerificationResult.Mismatch("Public key mismatch")
            }

            // 生成安全码
            val safetyNumber = generate(localIdentifier, localPublicKey, remoteIdentifier, remotePublicKey)

            VerificationResult.Valid(
                remoteIdentifier = remoteIdentifier,
                remotePublicKey = remotePublicKey,
                safetyNumber = safetyNumber
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to verify QR code data")
            VerificationResult.Invalid("Failed to parse QR code: ${e.message}")
        }
    }

    /**
     * 生成指纹
     *
     * @param version 版本号
     * @param identifier 标识符
     * @param publicKey 公钥
     * @return 30 位数字的指纹
     */
    private fun generateFingerprint(
        version: Int,
        identifier: String,
        publicKey: ByteArray
    ): String {
        // 构建输入数据
        val versionBytes = ByteArray(4)
        versionBytes[0] = (version shr 24).toByte()
        versionBytes[1] = (version shr 16).toByte()
        versionBytes[2] = (version shr 8).toByte()
        versionBytes[3] = version.toByte()

        val identifierBytes = identifier.toByteArray(Charsets.UTF_8)

        val inputData = versionBytes + identifierBytes + publicKey

        // 使用 SHA-512 进行迭代哈希
        var hash = inputData
        repeat(ITERATION_COUNT) {
            val digest = MessageDigest.getInstance("SHA-512")
            digest.update(hash)
            hash = digest.digest()
        }

        // 转换为 30 位数字
        return convertToNumericString(hash, 30)
    }

    /**
     * 将字节数组转换为数字字符串
     *
     * @param data 字节数组
     * @param length 目标长度
     * @return 数字字符串
     */
    private fun convertToNumericString(data: ByteArray, length: Int): String {
        val result = StringBuilder()

        var i = 0
        while (result.length < length && i < data.size - 4) {
            // 读取 5 个字节（40 bits）
            val chunk = ((data[i].toLong() and 0xFF) shl 32) or
                        ((data[i + 1].toLong() and 0xFF) shl 24) or
                        ((data[i + 2].toLong() and 0xFF) shl 16) or
                        ((data[i + 3].toLong() and 0xFF) shl 8) or
                        (data[i + 4].toLong() and 0xFF)

            // 40 bits 可以表示 0 到 1099511627775
            // 我们取模到 100000（5位数字）
            val number = (chunk % 100000).toString().padStart(5, '0')
            result.append(number)

            i += 5
        }

        return result.substring(0, length)
    }

    /**
     * 格式化安全码
     *
     * 将 60 位数字分成 5 组，每组 12 位
     *
     * @param fingerprint 60 位数字指纹
     * @return 格式化的安全码
     */
    private fun formatSafetyNumber(fingerprint: String): String {
        require(fingerprint.length == 60) { "Fingerprint must be 60 digits" }

        return buildString {
            for (i in 0 until 5) {
                if (i > 0) append(" ")
                append(fingerprint.substring(i * 12, (i + 1) * 12))
            }
        }
    }

    /**
     * 比较两个安全码是否相同
     *
     * @param safetyNumber1 安全码1
     * @param safetyNumber2 安全码2
     * @return 是否相同
     */
    fun compare(safetyNumber1: String, safetyNumber2: String): Boolean {
        // 移除空格进行比较
        val normalized1 = safetyNumber1.replace(" ", "")
        val normalized2 = safetyNumber2.replace(" ", "")

        return normalized1 == normalized2
    }
}

/**
 * 验证结果
 */
sealed class VerificationResult {
    /**
     * 验证成功
     */
    data class Valid(
        val remoteIdentifier: String,
        val remotePublicKey: ByteArray,
        val safetyNumber: String
    ) : VerificationResult()

    /**
     * 验证失败（信息不匹配）
     */
    data class Mismatch(val reason: String) : VerificationResult()

    /**
     * 无效的二维码
     */
    data class Invalid(val reason: String) : VerificationResult()
}
