package com.chainlesschain.android.core.e2ee.protocol

import timber.log.Timber
import com.chainlesschain.android.core.e2ee.crypto.Ed25519KeyPair
import com.chainlesschain.android.core.e2ee.crypto.HKDF
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import kotlinx.serialization.Serializable

/**
 * X3DH密钥交换协议
 *
 * Extended Triple Diffie-Hellman Key Agreement
 *
 * X3DH提供：
 * - 异步密钥交换（接收方可以离线）
 * - 前向安全性（Forward Secrecy）
 * - 密钥确认（Key Confirmation）
 * - 身份验证（Authentication）
 *
 * 参考：https://signal.org/docs/specifications/x3dh/
 */
object X3DHKeyExchange {

    /**
     * 生成预密钥包（Pre-Key Bundle）
     *
     * 接收方发布到服务器，发送方获取后进行密钥交换
     *
     * @param identityKeyPair 身份密钥对（长期，X25519用于DH）
     * @param signingKeyPair 签名密钥对（长期，Ed25519用于签名）
     * @param signedPreKeyPair 签名预密钥对（中期）
     * @param oneTimePreKeyPair 一次性预密钥对（短期，可选）
     * @return 预密钥包
     */
    fun generatePreKeyBundle(
        identityKeyPair: X25519KeyPair,
        signingKeyPair: Ed25519KeyPair,
        signedPreKeyPair: X25519KeyPair,
        oneTimePreKeyPair: X25519KeyPair? = null
    ): PreKeyBundle {
        require(identityKeyPair.hasPrivateKey()) {
            "Identity key must have private key"
        }
        require(signingKeyPair.hasPrivateKey()) {
            "Signing key must have private key"
        }
        require(signedPreKeyPair.hasPrivateKey()) {
            "Signed pre-key must have private key"
        }

        Timber.d("Generating pre-key bundle")

        // 使用Ed25519签名对signedPreKey的公钥进行签名
        val signedPreKeySignature = Ed25519KeyPair.sign(
            signingKeyPair.privateKey,
            signedPreKeyPair.publicKey
        )

        return PreKeyBundle(
            identityKey = identityKeyPair.publicKey,
            signingPublicKey = signingKeyPair.publicKey,
            signedPreKey = signedPreKeyPair.publicKey,
            signedPreKeySignature = signedPreKeySignature,
            oneTimePreKey = oneTimePreKeyPair?.publicKey
        )
    }

    /**
     * 发送方执行密钥交换
     *
     * @param senderIdentityKeyPair 发送方身份密钥对
     * @param senderEphemeralKeyPair 发送方临时密钥对
     * @param receiverPreKeyBundle 接收方预密钥包
     * @return (初始密钥, 关联数据)
     */
    fun senderX3DH(
        senderIdentityKeyPair: X25519KeyPair,
        senderEphemeralKeyPair: X25519KeyPair,
        receiverPreKeyBundle: PreKeyBundle
    ): X3DHResult {
        require(senderIdentityKeyPair.hasPrivateKey()) {
            "Sender identity key must have private key"
        }
        require(senderEphemeralKeyPair.hasPrivateKey()) {
            "Sender ephemeral key must have private key"
        }

        Timber.d("Sender executing X3DH")

        // 验证接收方的signedPreKey签名
        if (receiverPreKeyBundle.signingPublicKey != null) {
            val signatureValid = Ed25519KeyPair.verify(
                receiverPreKeyBundle.signingPublicKey,
                receiverPreKeyBundle.signedPreKey,
                receiverPreKeyBundle.signedPreKeySignature
            )
            require(signatureValid) {
                "Receiver's signed pre-key signature verification failed"
            }
            Timber.d("Signed pre-key signature verified successfully")
        }

        // DH1 = DH(IK_A, SPK_B)
        val dh1 = X25519KeyPair.computeSharedSecret(
            senderIdentityKeyPair.privateKey,
            receiverPreKeyBundle.signedPreKey
        )

        // DH2 = DH(EK_A, IK_B)
        val dh2 = X25519KeyPair.computeSharedSecret(
            senderEphemeralKeyPair.privateKey,
            receiverPreKeyBundle.identityKey
        )

        // DH3 = DH(EK_A, SPK_B)
        val dh3 = X25519KeyPair.computeSharedSecret(
            senderEphemeralKeyPair.privateKey,
            receiverPreKeyBundle.signedPreKey
        )

        // DH4 = DH(EK_A, OPK_B) - 如果有一次性预密钥
        val dh4 = if (receiverPreKeyBundle.oneTimePreKey != null) {
            X25519KeyPair.computeSharedSecret(
                senderEphemeralKeyPair.privateKey,
                receiverPreKeyBundle.oneTimePreKey
            )
        } else {
            null
        }

        // 组合所有DH输出
        val dhConcat = concatenateDHOutputs(dh1, dh2, dh3, dh4)

        // 使用HKDF派生密钥
        val sharedSecret = HKDF.deriveSecrets(
            salt = ByteArray(32), // F filled with 0xFF bytes (simplified here)
            ikm = dhConcat,
            info = "X3DH".toByteArray(),
            length = 32
        )

        // 关联数据（用于后续验证）
        val associatedData = concatenateKeys(
            senderIdentityKeyPair.publicKey,
            receiverPreKeyBundle.identityKey
        )

        Timber.d("Sender X3DH complete")

        return X3DHResult(
            sharedSecret = sharedSecret,
            associatedData = associatedData
        )
    }

    /**
     * 接收方执行密钥交换
     *
     * @param receiverIdentityKeyPair 接收方身份密钥对
     * @param receiverSignedPreKeyPair 接收方签名预密钥对
     * @param receiverOneTimePreKeyPair 接收方一次性预密钥对（可选）
     * @param senderIdentityKey 发送方身份公钥
     * @param senderEphemeralKey 发送方临时公钥
     * @return (初始密钥, 关联数据)
     */
    fun receiverX3DH(
        receiverIdentityKeyPair: X25519KeyPair,
        receiverSignedPreKeyPair: X25519KeyPair,
        receiverOneTimePreKeyPair: X25519KeyPair?,
        senderIdentityKey: ByteArray,
        senderEphemeralKey: ByteArray
    ): X3DHResult {
        require(receiverIdentityKeyPair.hasPrivateKey()) {
            "Receiver identity key must have private key"
        }
        require(receiverSignedPreKeyPair.hasPrivateKey()) {
            "Receiver signed pre-key must have private key"
        }

        Timber.d("Receiver executing X3DH")

        // DH1 = DH(SPK_B, IK_A)
        val dh1 = X25519KeyPair.computeSharedSecret(
            receiverSignedPreKeyPair.privateKey,
            senderIdentityKey
        )

        // DH2 = DH(IK_B, EK_A)
        val dh2 = X25519KeyPair.computeSharedSecret(
            receiverIdentityKeyPair.privateKey,
            senderEphemeralKey
        )

        // DH3 = DH(SPK_B, EK_A)
        val dh3 = X25519KeyPair.computeSharedSecret(
            receiverSignedPreKeyPair.privateKey,
            senderEphemeralKey
        )

        // DH4 = DH(OPK_B, EK_A) - 如果有一次性预密钥
        val dh4 = if (receiverOneTimePreKeyPair != null && receiverOneTimePreKeyPair.hasPrivateKey()) {
            X25519KeyPair.computeSharedSecret(
                receiverOneTimePreKeyPair.privateKey,
                senderEphemeralKey
            )
        } else {
            null
        }

        // 组合所有DH输出
        val dhConcat = concatenateDHOutputs(dh1, dh2, dh3, dh4)

        // 使用HKDF派生密钥
        val sharedSecret = HKDF.deriveSecrets(
            salt = ByteArray(32),
            ikm = dhConcat,
            info = "X3DH".toByteArray(),
            length = 32
        )

        // 关联数据
        val associatedData = concatenateKeys(
            senderIdentityKey,
            receiverIdentityKeyPair.publicKey
        )

        Timber.d("Receiver X3DH complete")

        return X3DHResult(
            sharedSecret = sharedSecret,
            associatedData = associatedData
        )
    }

    /**
     * 连接所有DH输出
     */
    private fun concatenateDHOutputs(
        dh1: ByteArray,
        dh2: ByteArray,
        dh3: ByteArray,
        dh4: ByteArray?
    ): ByteArray {
        val size = 32 * 3 + (if (dh4 != null) 32 else 0)
        val result = ByteArray(size)

        System.arraycopy(dh1, 0, result, 0, 32)
        System.arraycopy(dh2, 0, result, 32, 32)
        System.arraycopy(dh3, 0, result, 64, 32)

        if (dh4 != null) {
            System.arraycopy(dh4, 0, result, 96, 32)
        }

        return result
    }

    /**
     * 连接密钥（用于关联数据）
     */
    private fun concatenateKeys(key1: ByteArray, key2: ByteArray): ByteArray {
        val result = ByteArray(key1.size + key2.size)
        System.arraycopy(key1, 0, result, 0, key1.size)
        System.arraycopy(key2, 0, result, key1.size, key2.size)
        return result
    }
}

/**
 * 预密钥包
 *
 * 接收方发布的公钥集合
 */
@Serializable
data class PreKeyBundle(
    /** 身份公钥（长期，X25519用于DH） */
    val identityKey: ByteArray,

    /** 签名公钥（长期，Ed25519用于验签） */
    val signingPublicKey: ByteArray? = null,

    /** 签名预公钥（中期） */
    val signedPreKey: ByteArray,

    /** 签名预公钥的签名（Ed25519签名，64字节） */
    val signedPreKeySignature: ByteArray,

    /** 一次性预公钥（短期，可选） */
    val oneTimePreKey: ByteArray? = null
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as PreKeyBundle

        if (!identityKey.contentEquals(other.identityKey)) return false
        if (signingPublicKey != null) {
            if (other.signingPublicKey == null) return false
            if (!signingPublicKey.contentEquals(other.signingPublicKey)) return false
        } else if (other.signingPublicKey != null) return false
        if (!signedPreKey.contentEquals(other.signedPreKey)) return false
        if (!signedPreKeySignature.contentEquals(other.signedPreKeySignature)) return false
        if (oneTimePreKey != null) {
            if (other.oneTimePreKey == null) return false
            if (!oneTimePreKey.contentEquals(other.oneTimePreKey)) return false
        } else if (other.oneTimePreKey != null) return false

        return true
    }

    override fun hashCode(): Int {
        var result = identityKey.contentHashCode()
        result = 31 * result + (signingPublicKey?.contentHashCode() ?: 0)
        result = 31 * result + signedPreKey.contentHashCode()
        result = 31 * result + signedPreKeySignature.contentHashCode()
        result = 31 * result + (oneTimePreKey?.contentHashCode() ?: 0)
        return result
    }
}

/**
 * X3DH结果
 */
data class X3DHResult(
    /** 共享密钥（32字节） */
    val sharedSecret: ByteArray,

    /** 关联数据（用于验证） */
    val associatedData: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as X3DHResult

        if (!sharedSecret.contentEquals(other.sharedSecret)) return false
        if (!associatedData.contentEquals(other.associatedData)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = sharedSecret.contentHashCode()
        result = 31 * result + associatedData.contentHashCode()
        return result
    }
}
