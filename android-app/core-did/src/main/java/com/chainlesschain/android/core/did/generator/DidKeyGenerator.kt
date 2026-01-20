package com.chainlesschain.android.core.did.generator

import android.util.Log
import com.chainlesschain.android.core.did.crypto.Ed25519KeyPair
import com.chainlesschain.android.core.did.crypto.toBase64Url
import com.chainlesschain.android.core.did.model.DIDDocument
import io.ipfs.multibase.Multibase
import java.nio.ByteBuffer

/**
 * did:key生成器
 *
 * did:key是一种简单的DID方法，直接基于公钥生成DID
 * 格式：did:key:z{multibase-encoded-multicodec-public-key}
 *
 * 示例：did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
 *
 * 参考：https://w3c-ccg.github.io/did-method-key/
 */
object DidKeyGenerator {

    private const val TAG = "DidKeyGenerator"

    /** did:key前缀 */
    private const val DID_KEY_PREFIX = "did:key:"

    /** Ed25519公钥的Multicodec前缀（0xed01 = ed25519-pub） */
    private val ED25519_MULTICODEC_PREFIX = byteArrayOf(0xed.toByte(), 0x01)

    /** Base58编码字符集 */
    private const val BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    /**
     * 从Ed25519密钥对生成did:key
     *
     * @param keyPair Ed25519密钥对
     * @return did:key字符串
     */
    fun generate(keyPair: Ed25519KeyPair): String {
        Log.d(TAG, "Generating did:key from Ed25519 public key")

        // 1. 公钥添加Multicodec前缀
        val multicodecKey = ED25519_MULTICODEC_PREFIX + keyPair.publicKey

        // 2. 使用Multibase库进行Base58btc编码（'z'前缀）
        val multibaseKey = Multibase.encode(Multibase.Base.Base58BTC, multicodecKey)

        // 3. 组装did:key
        val didKey = "$DID_KEY_PREFIX$multibaseKey"

        Log.d(TAG, "Generated did:key: $didKey")

        return didKey
    }

    /**
     * 从did:key提取公钥
     *
     * @param didKey did:key字符串
     * @return Ed25519公钥（32字节）
     */
    fun extractPublicKey(didKey: String): ByteArray {
        require(didKey.startsWith(DID_KEY_PREFIX)) {
            "Invalid did:key format: must start with '$DID_KEY_PREFIX'"
        }

        Log.d(TAG, "Extracting public key from did:key")

        // 1. 移除did:key前缀
        val multibaseKey = didKey.removePrefix(DID_KEY_PREFIX)

        // 2. 使用Multibase库解码
        val multicodecKey = try {
            Multibase.decode(multibaseKey)
        } catch (e: Exception) {
            throw IllegalArgumentException("Invalid multibase encoding: ${e.message}", e)
        }

        // 3. 移除Multicodec前缀
        require(multicodecKey.size > ED25519_MULTICODEC_PREFIX.size) {
            "Invalid multicodec key: too short"
        }

        val prefix = multicodecKey.sliceArray(0 until ED25519_MULTICODEC_PREFIX.size)
        require(prefix.contentEquals(ED25519_MULTICODEC_PREFIX)) {
            "Invalid multicodec prefix: expected Ed25519 (0xed01)"
        }

        val publicKey = multicodecKey.sliceArray(ED25519_MULTICODEC_PREFIX.size until multicodecKey.size)

        require(publicKey.size == Ed25519KeyPair.PUBLIC_KEY_SIZE) {
            "Invalid public key size: expected ${Ed25519KeyPair.PUBLIC_KEY_SIZE}, got ${publicKey.size}"
        }

        Log.d(TAG, "Extracted public key: ${publicKey.size} bytes")

        return publicKey
    }

    /**
     * 从did:key生成DID Document
     *
     * @param didKey did:key字符串
     * @return DID Document
     */
    fun generateDocument(didKey: String): DIDDocument {
        val publicKey = extractPublicKey(didKey)

        // 重新生成Multibase公钥（用于DID Document）
        val multicodecKey = ED25519_MULTICODEC_PREFIX + publicKey
        val publicKeyMultibase = Multibase.encode(Multibase.Base.Base58BTC, multicodecKey)

        return DIDDocument.fromDidKey(didKey, publicKeyMultibase)
    }

    /**
     * 验证did:key格式
     *
     * @param didKey did:key字符串
     * @return 是否有效
     */
    fun isValid(didKey: String): Boolean {
        return try {
            extractPublicKey(didKey)
            true
        } catch (e: Exception) {
            Log.w(TAG, "Invalid did:key: ${e.message}")
            false
        }
    }

    /**
     * Base58编码（比特币风格）
     *
     * @param input 输入字节数组
     * @return Base58编码字符串
     */
    private fun encodeBase58(input: ByteArray): String {
        if (input.isEmpty()) return ""

        // 计算前导零的个数
        var zeroCount = 0
        while (zeroCount < input.size && input[zeroCount] == 0.toByte()) {
            zeroCount++
        }

        // 分配足够的空间（base58编码后长度约为原长度*1.38）
        val encoded = ByteArray((input.size * 138 / 100) + 1)
        var outputStart = encoded.size

        // 转换为大整数并编码
        var inputStart = zeroCount
        while (inputStart < input.size) {
            var carry = input[inputStart].toInt() and 0xFF
            var i = encoded.size - 1

            while (i >= outputStart || carry != 0) {
                carry += 256 * (encoded[i].toInt() and 0xFF)
                encoded[i] = (carry % 58).toByte()
                carry /= 58

                if (i == outputStart && carry == 0) {
                    outputStart = i
                    break
                }
                i--
            }

            inputStart++
        }

        // 跳过前导零
        while (outputStart < encoded.size && encoded[outputStart] == 0.toByte()) {
            outputStart++
        }

        // 添加'1'表示前导零
        val output = StringBuilder()
        repeat(zeroCount) {
            output.append('1')
        }

        // 转换为Base58字符
        for (i in outputStart until encoded.size) {
            output.append(BASE58_ALPHABET[encoded[i].toInt()])
        }

        return output.toString()
    }

    /**
     * Base58解码
     *
     * @param input Base58编码字符串
     * @return 解码后的字节数组
     */
    private fun decodeBase58(input: String): ByteArray {
        if (input.isEmpty()) return ByteArray(0)

        // 将Base58字符转换为字节
        val input58 = ByteArray(input.length)
        for (i in input.indices) {
            val c = input[i]
            val digit = BASE58_ALPHABET.indexOf(c)
            require(digit >= 0) {
                "Invalid Base58 character: $c"
            }
            input58[i] = digit.toByte()
        }

        // 计算前导'1'的个数（表示前导零）
        var zeroCount = 0
        while (zeroCount < input58.size && input58[zeroCount] == 0.toByte()) {
            zeroCount++
        }

        // 分配输出空间
        val decoded = ByteArray(input.length)
        var outputStart = decoded.size

        var inputStart = zeroCount
        while (inputStart < input58.size) {
            var carry = input58[inputStart].toInt() and 0xFF
            var i = decoded.size - 1

            while (i >= outputStart || carry != 0) {
                carry += 58 * (decoded[i].toInt() and 0xFF)
                decoded[i] = (carry % 256).toByte()
                carry /= 256

                if (i == outputStart && carry == 0) {
                    outputStart = i
                    break
                }
                i--
            }

            inputStart++
        }

        // 跳过前导零
        while (outputStart < decoded.size && decoded[outputStart] == 0.toByte()) {
            outputStart++
        }

        // 组装结果（前导零 + 解码数据）
        val result = ByteArray(zeroCount + (decoded.size - outputStart))
        System.arraycopy(decoded, outputStart, result, zeroCount, decoded.size - outputStart)

        return result
    }
}
