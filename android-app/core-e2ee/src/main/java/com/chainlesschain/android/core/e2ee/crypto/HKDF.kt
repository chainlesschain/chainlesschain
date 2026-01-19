package com.chainlesschain.android.core.e2ee.crypto

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * HKDF (HMAC-based Key Derivation Function)
 *
 * RFC 5869标准实现
 * 用于从共享密钥派生多个加密密钥
 *
 * Signal Protocol使用HKDF-SHA256
 */
object HKDF {

    private const val HASH_OUTPUT_SIZE = 32 // SHA-256 output size

    /**
     * HKDF提取步骤
     *
     * PRK = HMAC-Hash(salt, IKM)
     *
     * @param salt 盐值（可选，如果为null则使用零字节）
     * @param ikm 输入密钥材料（Input Keying Material）
     * @return 伪随机密钥（Pseudo-Random Key）
     */
    fun extract(salt: ByteArray?, ikm: ByteArray): ByteArray {
        val actualSalt = salt ?: ByteArray(HASH_OUTPUT_SIZE) // 如果没有salt，使用零字节

        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(actualSalt, "HmacSHA256"))

        return mac.doFinal(ikm)
    }

    /**
     * HKDF扩展步骤
     *
     * OKM = HMAC-Hash(PRK, info | 0x01) | HMAC-Hash(PRK, prev | info | 0x02) | ...
     *
     * @param prk 伪随机密钥（从extract步骤获得）
     * @param info 上下文信息（可选）
     * @param length 输出密钥材料长度
     * @return 输出密钥材料（Output Keying Material）
     */
    fun expand(prk: ByteArray, info: ByteArray?, length: Int): ByteArray {
        require(length <= 255 * HASH_OUTPUT_SIZE) {
            "Output length too large"
        }

        val actualInfo = info ?: ByteArray(0)
        val iterations = (length + HASH_OUTPUT_SIZE - 1) / HASH_OUTPUT_SIZE

        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(prk, "HmacSHA256"))

        val okm = ByteArray(length)
        var prev = ByteArray(0)
        var offset = 0

        for (i in 0 until iterations) {
            mac.update(prev)
            mac.update(actualInfo)
            mac.update((i + 1).toByte())

            prev = mac.doFinal()

            val copyLength = minOf(HASH_OUTPUT_SIZE, length - offset)
            System.arraycopy(prev, 0, okm, offset, copyLength)
            offset += copyLength
        }

        return okm
    }

    /**
     * 完整的HKDF（提取+扩展）
     *
     * @param salt 盐值
     * @param ikm 输入密钥材料
     * @param info 上下文信息
     * @param length 输出长度
     * @return 派生的密钥
     */
    fun deriveSecrets(salt: ByteArray?, ikm: ByteArray, info: ByteArray?, length: Int): ByteArray {
        val prk = extract(salt, ikm)
        return expand(prk, info, length)
    }

    /**
     * Signal Protocol使用的3输出HKDF
     *
     * 从输入密钥材料派生3个32字节密钥
     *
     * @param ikm 输入密钥材料
     * @param salt 盐值
     * @param info 上下文信息
     * @return 3个32字节密钥的数组
     */
    fun deriveSecretsSignal(
        ikm: ByteArray,
        salt: ByteArray = ByteArray(32),
        info: ByteArray = ByteArray(0)
    ): Triple<ByteArray, ByteArray, ByteArray> {
        val output = deriveSecrets(salt, ikm, info, 96) // 3 * 32 bytes

        val key1 = output.copyOfRange(0, 32)
        val key2 = output.copyOfRange(32, 64)
        val key3 = output.copyOfRange(64, 96)

        return Triple(key1, key2, key3)
    }

    /**
     * 派生根密钥和链密钥
     *
     * Signal Protocol中用于Double Ratchet
     *
     * @param rootKey 当前根密钥
     * @param dhOutput DH输出
     * @return (新根密钥, 链密钥)
     */
    fun deriveRootKey(rootKey: ByteArray, dhOutput: ByteArray): Pair<ByteArray, ByteArray> {
        val output = deriveSecrets(rootKey, dhOutput, "WhisperRatchet".toByteArray(), 64)

        val newRootKey = output.copyOfRange(0, 32)
        val chainKey = output.copyOfRange(32, 64)

        return Pair(newRootKey, chainKey)
    }

    /**
     * 派生消息密钥
     *
     * Signal Protocol中用于从链密钥派生消息密钥
     *
     * @param chainKey 链密钥
     * @return 消息密钥（加密密钥 + MAC密钥）
     */
    fun deriveMessageKey(chainKey: ByteArray): MessageKeys {
        val output = deriveSecrets(null, chainKey, "WhisperMessageKeys".toByteArray(), 80)

        return MessageKeys(
            cipherKey = output.copyOfRange(0, 32),
            macKey = output.copyOfRange(32, 64),
            iv = output.copyOfRange(64, 80)
        )
    }

    /**
     * 派生下一个链密钥
     *
     * @param chainKey 当前链密钥
     * @return 下一个链密钥
     */
    fun deriveNextChainKey(chainKey: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(chainKey, "HmacSHA256"))
        mac.update(0x02.toByte()) // Constant 0x02

        return mac.doFinal()
    }
}

/**
 * 消息密钥
 */
data class MessageKeys(
    /** 加密密钥（32字节） */
    val cipherKey: ByteArray,

    /** MAC密钥（32字节） */
    val macKey: ByteArray,

    /** 初始化向量（16字节） */
    val iv: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as MessageKeys

        if (!cipherKey.contentEquals(other.cipherKey)) return false
        if (!macKey.contentEquals(other.macKey)) return false
        if (!iv.contentEquals(other.iv)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = cipherKey.contentHashCode()
        result = 31 * result + macKey.contentHashCode()
        result = 31 * result + iv.contentHashCode()
        return result
    }
}
