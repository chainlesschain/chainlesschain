package com.chainlesschain.android.core.e2ee.crypto

import timber.log.Timber
import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.generators.X25519KeyPairGenerator
import org.bouncycastle.crypto.params.X25519KeyGenerationParameters
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import java.security.SecureRandom

/**
 * X25519密钥对（用于ECDH密钥协商）
 *
 * X25519是Curve25519的变体，专门用于密钥交换
 * 特点：
 * - 高性能ECDH密钥协商
 * - 128位安全级别
 * - 公钥/私钥均32字节
 * - 抗侧信道攻击
 */
data class X25519KeyPair(
    /** 公钥（32字节） */
    val publicKey: ByteArray,

    /** 私钥（32字节） */
    val privateKey: ByteArray
) {
    companion object {
        /** 公钥长度 */
        const val PUBLIC_KEY_SIZE = 32

        /** 私钥长度 */
        const val PRIVATE_KEY_SIZE = 32

        /** 共享密钥长度 */
        const val SHARED_SECRET_SIZE = 32

        /**
         * 生成新的X25519密钥对
         *
         * @return 密钥对
         */
        fun generate(): X25519KeyPair {
            Timber.d("Generating X25519 key pair")

            val secureRandom = SecureRandom()
            val keyPairGenerator = X25519KeyPairGenerator()
            keyPairGenerator.init(X25519KeyGenerationParameters(secureRandom))

            val keyPair = keyPairGenerator.generateKeyPair()

            val publicKeyParams = keyPair.public as X25519PublicKeyParameters
            val privateKeyParams = keyPair.private as X25519PrivateKeyParameters

            val publicKey = publicKeyParams.encoded
            val privateKey = privateKeyParams.encoded

            Timber.d("Key pair generated: publicKey=${publicKey.size} bytes, privateKey=${privateKey.size} bytes")

            return X25519KeyPair(
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
        fun fromPrivateKey(privateKey: ByteArray): X25519KeyPair {
            require(privateKey.size == PRIVATE_KEY_SIZE) {
                "Private key must be $PRIVATE_KEY_SIZE bytes"
            }

            val privateKeyParams = X25519PrivateKeyParameters(privateKey, 0)
            val publicKeyParams = privateKeyParams.generatePublicKey()

            return X25519KeyPair(
                publicKey = publicKeyParams.encoded,
                privateKey = privateKey
            )
        }

        /**
         * 从公钥创建仅公钥的密钥对（用于验证/协商）
         *
         * @param publicKey 公钥（32字节）
         * @return 密钥对（私钥为空）
         */
        fun fromPublicKey(publicKey: ByteArray): X25519KeyPair {
            require(publicKey.size == PUBLIC_KEY_SIZE) {
                "Public key must be $PUBLIC_KEY_SIZE bytes"
            }

            return X25519KeyPair(
                publicKey = publicKey,
                privateKey = ByteArray(0) // 空私钥
            )
        }

        /**
         * 执行ECDH密钥协商
         *
         * @param privateKey 本地私钥
         * @param publicKey 远程公钥
         * @return 共享密钥（32字节）
         */
        fun computeSharedSecret(privateKey: ByteArray, publicKey: ByteArray): ByteArray {
            require(privateKey.size == PRIVATE_KEY_SIZE) {
                "Private key must be $PRIVATE_KEY_SIZE bytes"
            }
            require(publicKey.size == PUBLIC_KEY_SIZE) {
                "Public key must be $PUBLIC_KEY_SIZE bytes"
            }

            val privateKeyParams = X25519PrivateKeyParameters(privateKey, 0)
            val publicKeyParams = X25519PublicKeyParameters(publicKey, 0)

            val agreement = X25519Agreement()
            agreement.init(privateKeyParams)

            val sharedSecret = ByteArray(SHARED_SECRET_SIZE)
            agreement.calculateAgreement(publicKeyParams, sharedSecret, 0)

            Timber.d("Shared secret computed: ${sharedSecret.size} bytes")

            return sharedSecret
        }
    }

    /**
     * 是否有私钥
     */
    fun hasPrivateKey(): Boolean {
        return privateKey.isNotEmpty()
    }

    /**
     * 计算与远程公钥的共享密钥
     *
     * @param remotePublicKey 远程公钥
     * @return 共享密钥（32字节）
     */
    fun computeSharedSecret(remotePublicKey: ByteArray): ByteArray {
        require(hasPrivateKey()) {
            "Private key is required for key agreement"
        }

        return computeSharedSecret(privateKey, remotePublicKey)
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

        other as X25519KeyPair

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
        return "X25519KeyPair(publicKey=${getPublicKeyHex()}, hasPrivateKey=${hasPrivateKey()})"
    }
}

/**
 * ByteArray扩展：转换为十六进制字符串
 */
fun ByteArray.toHexString(): String {
    return joinToString("") { "%02x".format(it) }
}

/**
 * String扩展：从十六进制字符串转换为ByteArray
 */
fun String.hexToByteArray(): ByteArray {
    require(length % 2 == 0) { "Hex string must have even length" }

    return chunked(2)
        .map { it.toInt(16).toByte() }
        .toByteArray()
}

/**
 * 密钥对存储格式（JSON）
 */
@kotlinx.serialization.Serializable
data class X25519KeyPairJson(
    /** 公钥（十六进制） */
    val publicKey: String,

    /** 私钥（十六进制，可选） */
    val privateKey: String? = null
) {
    companion object {
        fun fromKeyPair(keyPair: X25519KeyPair): X25519KeyPairJson {
            return X25519KeyPairJson(
                publicKey = keyPair.getPublicKeyHex(),
                privateKey = if (keyPair.hasPrivateKey()) {
                    keyPair.getPrivateKeyHex()
                } else {
                    null
                }
            )
        }
    }

    fun toKeyPair(): X25519KeyPair {
        return if (privateKey != null) {
            X25519KeyPair.fromPrivateKey(privateKey.hexToByteArray())
        } else {
            X25519KeyPair.fromPublicKey(publicKey.hexToByteArray())
        }
    }
}
