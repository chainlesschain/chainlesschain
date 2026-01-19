package com.chainlesschain.android.core.did.crypto

import android.util.Log
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.nio.charset.StandardCharsets

/**
 * Ed25519签名工具
 *
 * 提供消息签名和验证功能
 */
object SignatureUtils {

    private const val TAG = "SignatureUtils"

    /** 签名长度（64字节） */
    const val SIGNATURE_SIZE = 64

    /**
     * 签名消息
     *
     * @param message 消息内容
     * @param keyPair 密钥对（必须包含私钥）
     * @return 签名（64字节）
     */
    fun sign(message: ByteArray, keyPair: Ed25519KeyPair): ByteArray {
        require(keyPair.hasPrivateKey()) {
            "Private key is required for signing"
        }

        Log.d(TAG, "Signing message: ${message.size} bytes")

        val privateKeyParams = Ed25519PrivateKeyParameters(keyPair.privateKey, 0)
        val signer = Ed25519Signer()
        signer.init(true, privateKeyParams)
        signer.update(message, 0, message.size)

        val signature = signer.generateSignature()

        Log.d(TAG, "Signature generated: ${signature.size} bytes")

        return signature
    }

    /**
     * 签名字符串消息
     *
     * @param message 消息字符串
     * @param keyPair 密钥对
     * @return 签名（64字节）
     */
    fun sign(message: String, keyPair: Ed25519KeyPair): ByteArray {
        return sign(message.toByteArray(StandardCharsets.UTF_8), keyPair)
    }

    /**
     * 验证签名
     *
     * @param message 原始消息
     * @param signature 签名（64字节）
     * @param publicKey 公钥（32字节）
     * @return 是否验证通过
     */
    fun verify(message: ByteArray, signature: ByteArray, publicKey: ByteArray): Boolean {
        require(signature.size == SIGNATURE_SIZE) {
            "Signature must be $SIGNATURE_SIZE bytes"
        }
        require(publicKey.size == Ed25519KeyPair.PUBLIC_KEY_SIZE) {
            "Public key must be ${Ed25519KeyPair.PUBLIC_KEY_SIZE} bytes"
        }

        Log.d(TAG, "Verifying signature for message: ${message.size} bytes")

        return try {
            val publicKeyParams = Ed25519PublicKeyParameters(publicKey, 0)
            val verifier = Ed25519Signer()
            verifier.init(false, publicKeyParams)
            verifier.update(message, 0, message.size)

            val isValid = verifier.verifySignature(signature)

            Log.d(TAG, "Signature verification: $isValid")

            isValid
        } catch (e: Exception) {
            Log.e(TAG, "Signature verification failed", e)
            false
        }
    }

    /**
     * 验证字符串消息的签名
     *
     * @param message 原始消息字符串
     * @param signature 签名
     * @param publicKey 公钥
     * @return 是否验证通过
     */
    fun verify(message: String, signature: ByteArray, publicKey: ByteArray): Boolean {
        return verify(message.toByteArray(StandardCharsets.UTF_8), signature, publicKey)
    }

    /**
     * 验证签名（使用密钥对）
     *
     * @param message 原始消息
     * @param signature 签名
     * @param keyPair 密钥对（只需公钥）
     * @return 是否验证通过
     */
    fun verify(message: ByteArray, signature: ByteArray, keyPair: Ed25519KeyPair): Boolean {
        return verify(message, signature, keyPair.publicKey)
    }

    /**
     * 签名并附加时间戳（防重放攻击）
     *
     * @param message 消息内容
     * @param keyPair 密钥对
     * @return 签名结果（包含时间戳）
     */
    fun signWithTimestamp(message: ByteArray, keyPair: Ed25519KeyPair): TimestampedSignature {
        val timestamp = System.currentTimeMillis()
        val messageWithTimestamp = message + timestamp.toString().toByteArray()
        val signature = sign(messageWithTimestamp, keyPair)

        return TimestampedSignature(
            signature = signature,
            timestamp = timestamp
        )
    }

    /**
     * 验证带时间戳的签名
     *
     * @param message 原始消息
     * @param timestampedSignature 带时间戳的签名
     * @param publicKey 公钥
     * @param maxAgeMs 最大时间差（毫秒），防重放
     * @return 是否验证通过
     */
    fun verifyWithTimestamp(
        message: ByteArray,
        timestampedSignature: TimestampedSignature,
        publicKey: ByteArray,
        maxAgeMs: Long = 60000 // 默认60秒
    ): Boolean {
        // 检查时间戳是否过期
        val now = System.currentTimeMillis()
        val age = now - timestampedSignature.timestamp

        if (age > maxAgeMs || age < 0) {
            Log.w(TAG, "Timestamp expired or invalid: age=$age ms, max=$maxAgeMs ms")
            return false
        }

        // 重构带时间戳的消息
        val messageWithTimestamp = message + timestampedSignature.timestamp.toString().toByteArray()

        // 验证签名
        return verify(messageWithTimestamp, timestampedSignature.signature, publicKey)
    }

    /**
     * 创建JWS（JSON Web Signature）格式的签名
     *
     * 格式：base64url(header).base64url(payload).base64url(signature)
     *
     * @param payload 负载数据
     * @param keyPair 密钥对
     * @return JWS字符串
     */
    fun createJWS(payload: String, keyPair: Ed25519KeyPair): String {
        // JWS Header (EdDSA algorithm)
        val header = """{"alg":"EdDSA","typ":"JWT"}"""

        val encodedHeader = header.toByteArray().toBase64Url()
        val encodedPayload = payload.toByteArray().toBase64Url()

        val signingInput = "$encodedHeader.$encodedPayload"
        val signature = sign(signingInput, keyPair)
        val encodedSignature = signature.toBase64Url()

        return "$signingInput.$encodedSignature"
    }

    /**
     * 验证JWS签名
     *
     * @param jws JWS字符串
     * @param publicKey 公钥
     * @return 验证通过返回payload，否则返回null
     */
    fun verifyJWS(jws: String, publicKey: ByteArray): String? {
        val parts = jws.split(".")
        if (parts.size != 3) {
            Log.w(TAG, "Invalid JWS format: expected 3 parts, got ${parts.size}")
            return null
        }

        val signingInput = "${parts[0]}.${parts[1]}"
        val signature = parts[2].fromBase64Url()

        val isValid = verify(signingInput, signature, publicKey)

        return if (isValid) {
            String(parts[1].fromBase64Url(), StandardCharsets.UTF_8)
        } else {
            null
        }
    }
}

/**
 * 带时间戳的签名
 */
data class TimestampedSignature(
    /** 签名数据 */
    val signature: ByteArray,

    /** 时间戳（毫秒） */
    val timestamp: Long
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as TimestampedSignature

        if (!signature.contentEquals(other.signature)) return false
        if (timestamp != other.timestamp) return false

        return true
    }

    override fun hashCode(): Int {
        var result = signature.contentHashCode()
        result = 31 * result + timestamp.hashCode()
        return result
    }
}

/**
 * Base64 URL编码（RFC 4648）
 */
fun ByteArray.toBase64Url(): String {
    return android.util.Base64.encodeToString(this, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP)
}

/**
 * Base64 URL解码
 */
fun String.fromBase64Url(): ByteArray {
    return android.util.Base64.decode(this, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP)
}
