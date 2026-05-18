package com.chainlesschain.android.remote.crypto

import android.util.Base64
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import timber.log.Timber
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DID 密钥生成器
 *
 * 使用 Ed25519 算法生成符合 DID 标准的密钥对
 */
@Singleton
class DIDKeyGenerator @Inject constructor(
    private val keyStore: DIDKeyStore
) {
    private val secureRandom = SecureRandom()

    /**
     * 生成新的 Ed25519 密钥对
     *
     * @param did DID 标识符
     * @return 密钥对信息（公钥 Base64）
     */
    suspend fun generateKeyPair(did: String): Result<KeyPairInfo> {
        return try {
            Timber.d("开始生成 Ed25519 密钥对: $did")

            // 1. 初始化 Ed25519 密钥生成器
            val keyPairGenerator = Ed25519KeyPairGenerator()
            keyPairGenerator.init(Ed25519KeyGenerationParameters(secureRandom))

            // 2. 生成密钥对
            val keyPair = keyPairGenerator.generateKeyPair()
            val privateKeyParams = keyPair.private as Ed25519PrivateKeyParameters
            val publicKeyParams = keyPair.public as Ed25519PublicKeyParameters

            // 3. 提取密钥字节
            val privateKeyBytes = privateKeyParams.encoded
            val publicKeyBytes = publicKeyParams.encoded

            // 4. 验证密钥长度
            require(privateKeyBytes.size == 32) { "Ed25519 private key must be 32 bytes" }
            require(publicKeyBytes.size == 32) { "Ed25519 public key must be 32 bytes" }

            // 5. 存储密钥对
            keyStore.storeKeyPair(did, privateKeyBytes, publicKeyBytes)

            // 6. 返回公钥信息
            val publicKeyBase64 = Base64.encodeToString(publicKeyBytes, Base64.NO_WRAP)
            Timber.d("Ed25519 密钥对生成成功: ${publicKeyBase64.take(20)}...")

            Result.success(KeyPairInfo(
                did = did,
                publicKey = publicKeyBase64,
                algorithm = "Ed25519"
            ))
        } catch (e: Exception) {
            Timber.e(e, "密钥对生成失败")
            Result.failure(e)
        }
    }

    /**
     * 从现有私钥导入密钥对
     *
     * @param did DID 标识符
     * @param privateKeyBase64 Base64 编码的私钥
     * @return 密钥对信息
     */
    suspend fun importKeyPair(did: String, privateKeyBase64: String): Result<KeyPairInfo> {
        return try {
            Timber.d("开始导入 Ed25519 密钥对: $did")

            // 1. 解码私钥
            val privateKeyBytes = Base64.decode(privateKeyBase64, Base64.DEFAULT)
            require(privateKeyBytes.size == 32) { "Ed25519 private key must be 32 bytes" }

            // 2. 从私钥生成公钥
            val privateKeyParams = Ed25519PrivateKeyParameters(privateKeyBytes, 0)
            val publicKeyParams = privateKeyParams.generatePublicKey()
            val publicKeyBytes = publicKeyParams.encoded

            // 3. 存储密钥对
            keyStore.storeKeyPair(did, privateKeyBytes, publicKeyBytes)

            // 4. 返回公钥信息
            val publicKeyBase64 = Base64.encodeToString(publicKeyBytes, Base64.NO_WRAP)
            Timber.d("Ed25519 密钥对导入成功: ${publicKeyBase64.take(20)}...")

            Result.success(KeyPairInfo(
                did = did,
                publicKey = publicKeyBase64,
                algorithm = "Ed25519"
            ))
        } catch (e: Exception) {
            Timber.e(e, "密钥对导入失败")
            Result.failure(e)
        }
    }

    /**
     * 获取公钥
     *
     * @param did DID 标识符
     * @return Base64 编码的公钥
     */
    suspend fun getPublicKey(did: String): Result<String> {
        return try {
            val publicKeyBytes = keyStore.getPublicKey(did)
                ?: return Result.failure(Exception("Public key not found for DID: $did"))

            val publicKeyBase64 = Base64.encodeToString(publicKeyBytes, Base64.NO_WRAP)
            Result.success(publicKeyBase64)
        } catch (e: Exception) {
            Timber.e(e, "获取公钥失败")
            Result.failure(e)
        }
    }

    /**
     * 密钥对信息
     */
    data class KeyPairInfo(
        val did: String,
        val publicKey: String,
        val algorithm: String
    )
}
