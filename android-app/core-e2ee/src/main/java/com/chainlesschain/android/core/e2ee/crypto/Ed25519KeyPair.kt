package com.chainlesschain.android.core.e2ee.crypto

import android.util.Log
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.SecureRandom

/**
 * Ed25519密钥对（用于数字签名）
 *
 * Ed25519是EdDSA签名方案的一种，基于Curve25519
 * 特点：
 * - 高性能数字签名
 * - 128位安全级别
 * - 公钥32字节，私钥32字节，签名64字节
 * - 确定性签名（相同输入产生相同签名）
 * - 抗侧信道攻击
 *
 * 注意：Ed25519用于签名，X25519用于密钥交换，两者不可混用。
 */
data class Ed25519KeyPair(
    /** 公钥（32字节） */
    val publicKey: ByteArray,

    /** 私钥（32字节） */
    val privateKey: ByteArray
) {
    companion object {
        private const val TAG = "Ed25519KeyPair"

        /** 公钥长度 */
        const val PUBLIC_KEY_SIZE = 32

        /** 私钥长度 */
        const val PRIVATE_KEY_SIZE = 32

        /** 签名长度 */
        const val SIGNATURE_SIZE = 64

        /**
         * 生成新的Ed25519密钥对
         *
         * @return 密钥对
         */
        fun generate(): Ed25519KeyPair {
            Log.d(TAG, "Generating Ed25519 key pair")

            val secureRandom = SecureRandom()
            val keyPairGenerator = Ed25519KeyPairGenerator()
            keyPairGenerator.init(Ed25519KeyGenerationParameters(secureRandom))

            val keyPair = keyPairGenerator.generateKeyPair()

            val publicKeyParams = keyPair.public as Ed25519PublicKeyParameters
            val privateKeyParams = keyPair.private as Ed25519PrivateKeyParameters

            val publicKey = publicKeyParams.encoded
            val privateKey = privateKeyParams.encoded

            Log.d(TAG, "Key pair generated: publicKey=${publicKey.size} bytes, privateKey=${privateKey.size} bytes")

            return Ed25519KeyPair(
                publicKey = publicKey,
                privateKey = privateKey
            )
        }

        /**
         * 从私钥恢复密钥对
         *
         * @param privateKey 私钥（32字节）
         * @return 密钥对
         */
        fun fromPrivateKey(privateKey: ByteArray): Ed25519KeyPair {
            require(privateKey.size == PRIVATE_KEY_SIZE) {
                "Private key must be $PRIVATE_KEY_SIZE bytes"
            }

            val privateKeyParams = Ed25519PrivateKeyParameters(privateKey, 0)
            val publicKeyParams = privateKeyParams.generatePublicKey()

            return Ed25519KeyPair(
                publicKey = publicKeyParams.encoded,
                privateKey = privateKey
            )
        }

        /**
         * 从公钥创建仅公钥的密钥对（用于验签）
         *
         * @param publicKey 公钥（32字节）
         * @return 密钥对（私钥为空）
         */
        fun fromPublicKey(publicKey: ByteArray): Ed25519KeyPair {
            require(publicKey.size == PUBLIC_KEY_SIZE) {
                "Public key must be $PUBLIC_KEY_SIZE bytes"
            }

            return Ed25519KeyPair(
                publicKey = publicKey,
                privateKey = ByteArray(0)
            )
        }

        /**
         * 使用私钥对数据签名
         *
         * @param privateKey 私钥（32字节）
         * @param data 待签名数据
         * @return 签名（64字节）
         */
        fun sign(privateKey: ByteArray, data: ByteArray): ByteArray {
            require(privateKey.size == PRIVATE_KEY_SIZE) {
                "Private key must be $PRIVATE_KEY_SIZE bytes"
            }

            val privateKeyParams = Ed25519PrivateKeyParameters(privateKey, 0)
            val signer = Ed25519Signer()
            signer.init(true, privateKeyParams)
            signer.update(data, 0, data.size)
            return signer.generateSignature()
        }

        /**
         * 使用公钥验证签名
         *
         * @param publicKey 公钥（32字节）
         * @param data 原始数据
         * @param signature 签名（64字节）
         * @return 签名是否有效
         */
        fun verify(publicKey: ByteArray, data: ByteArray, signature: ByteArray): Boolean {
            require(publicKey.size == PUBLIC_KEY_SIZE) {
                "Public key must be $PUBLIC_KEY_SIZE bytes"
            }
            require(signature.size == SIGNATURE_SIZE) {
                "Signature must be $SIGNATURE_SIZE bytes"
            }

            return try {
                val publicKeyParams = Ed25519PublicKeyParameters(publicKey, 0)
                val verifier = Ed25519Signer()
                verifier.init(false, publicKeyParams)
                verifier.update(data, 0, data.size)
                verifier.verifySignature(signature)
            } catch (e: Exception) {
                Log.w(TAG, "Signature verification failed", e)
                false
            }
        }
    }

    /**
     * 是否有私钥
     */
    fun hasPrivateKey(): Boolean {
        return privateKey.isNotEmpty()
    }

    /**
     * 对数据签名
     *
     * @param data 待签名数据
     * @return 签名（64字节）
     */
    fun sign(data: ByteArray): ByteArray {
        require(hasPrivateKey()) {
            "Private key is required for signing"
        }

        return sign(privateKey, data)
    }

    /**
     * 验证签名
     *
     * @param data 原始数据
     * @param signature 签名
     * @return 签名是否有效
     */
    fun verify(data: ByteArray, signature: ByteArray): Boolean {
        return verify(publicKey, data, signature)
    }

    /**
     * 获取公钥的十六进制表示
     */
    fun getPublicKeyHex(): String {
        return publicKey.toHexString()
    }

    /**
     * 获取私钥的十六进制表示
     */
    fun getPrivateKeyHex(): String {
        return privateKey.toHexString()
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as Ed25519KeyPair

        if (!publicKey.contentEquals(other.publicKey)) return false
        if (!privateKey.contentEquals(other.privateKey)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = publicKey.contentHashCode()
        result = 31 * result + privateKey.contentHashCode()
        return result
    }

    override fun toString(): String {
        return "Ed25519KeyPair(publicKey=${getPublicKeyHex()}, hasPrivateKey=${hasPrivateKey()})"
    }
}

/**
 * Ed25519密钥对存储格式（JSON）
 */
@kotlinx.serialization.Serializable
data class Ed25519KeyPairJson(
    /** 公钥（十六进制） */
    val publicKey: String,

    /** 私钥（十六进制，可选） */
    val privateKey: String? = null
) {
    companion object {
        fun fromKeyPair(keyPair: Ed25519KeyPair): Ed25519KeyPairJson {
            return Ed25519KeyPairJson(
                publicKey = keyPair.getPublicKeyHex(),
                privateKey = if (keyPair.hasPrivateKey()) {
                    keyPair.getPrivateKeyHex()
                } else {
                    null
                }
            )
        }
    }

    fun toKeyPair(): Ed25519KeyPair {
        return if (privateKey != null) {
            Ed25519KeyPair.fromPrivateKey(privateKey.hexToByteArray())
        } else {
            Ed25519KeyPair.fromPublicKey(publicKey.hexToByteArray())
        }
    }
}
