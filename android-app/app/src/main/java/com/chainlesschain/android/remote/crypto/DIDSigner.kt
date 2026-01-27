package com.chainlesschain.android.remote.crypto

import android.util.Base64
import timber.log.Timber
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DID 签名器
 *
 * 提供 DID 签名和验证功能
 * 基于 Ed25519 签名算法
 */
@Singleton
class DIDSigner @Inject constructor(
    private val keyStore: DIDKeyStore
) {
    /**
     * 对数据进行签名
     *
     * @param data 待签名的数据
     * @param did 使用的 DID
     * @return Base64 编码的签名
     */
    suspend fun sign(data: String, did: String): Result<String> {
        return try {
            Timber.d("开始签名数据: ${data.take(50)}...")

            // 1. 获取私钥
            val privateKey = keyStore.getPrivateKey(did)
                ?: return Result.failure(Exception("Private key not found for DID: $did"))

            // 2. 将数据转换为字节
            val dataBytes = data.toByteArray(Charsets.UTF_8)

            // 3. 计算签名
            // TODO: 实际项目中应使用 Ed25519 签名
            // 这里使用 HMAC-SHA256 作为简化实现
            val signature = signWithHMAC(dataBytes, privateKey)

            // 4. Base64 编码
            val signatureBase64 = Base64.encodeToString(signature, Base64.NO_WRAP)

            Timber.d("签名成功: ${signatureBase64.take(20)}...")
            Result.success(signatureBase64)
        } catch (e: Exception) {
            Timber.e(e, "签名失败")
            Result.failure(e)
        }
    }

    /**
     * 验证签名
     *
     * @param data 原始数据
     * @param signature Base64 编码的签名
     * @param publicKey Base64 编码的公钥
     * @return 验证结果
     */
    suspend fun verify(
        data: String,
        signature: String,
        publicKey: String
    ): Result<Boolean> {
        return try {
            Timber.d("开始验证签名")

            // 1. 解码签名和公钥
            val signatureBytes = Base64.decode(signature, Base64.DEFAULT)
            val publicKeyBytes = Base64.decode(publicKey, Base64.DEFAULT)

            // 2. 将数据转换为字节
            val dataBytes = data.toByteArray(Charsets.UTF_8)

            // 3. 验证签名
            // TODO: 实际项目中应使用 Ed25519 验证
            val isValid = verifyWithHMAC(dataBytes, signatureBytes, publicKeyBytes)

            Timber.d("签名验证结果: $isValid")
            Result.success(isValid)
        } catch (e: Exception) {
            Timber.e(e, "签名验证失败")
            Result.failure(e)
        }
    }

    /**
     * 使用 HMAC-SHA256 签名（简化实现）
     *
     * 注意：生产环境应使用 Ed25519
     */
    private fun signWithHMAC(data: ByteArray, key: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        val secretKey = SecretKeySpec(key, "HmacSHA256")
        mac.init(secretKey)
        return mac.doFinal(data)
    }

    /**
     * 使用 HMAC-SHA256 验证（简化实现）
     *
     * 注意：生产环境应使用 Ed25519
     */
    private fun verifyWithHMAC(
        data: ByteArray,
        signature: ByteArray,
        key: ByteArray
    ): Boolean {
        val expectedSignature = signWithHMAC(data, key)
        return signature.contentEquals(expectedSignature)
    }

    /**
     * 生成 SHA-256 哈希
     */
    fun hash(data: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(data.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(hashBytes, Base64.NO_WRAP)
    }
}

/**
 * DID 密钥存储接口
 */
interface DIDKeyStore {
    /**
     * 获取私钥
     */
    suspend fun getPrivateKey(did: String): ByteArray?

    /**
     * 获取公钥
     */
    suspend fun getPublicKey(did: String): ByteArray?

    /**
     * 存储密钥对
     */
    suspend fun storeKeyPair(did: String, privateKey: ByteArray, publicKey: ByteArray)
}

/**
 * DID 密钥存储实现（使用 Android KeyStore）
 */
@Singleton
class AndroidDIDKeyStore @Inject constructor() : DIDKeyStore {
    // 简化实现：使用内存存储
    // 生产环境应使用 Android KeyStore System
    private val keyCache = mutableMapOf<String, KeyPair>()

    override suspend fun getPrivateKey(did: String): ByteArray? {
        return keyCache[did]?.privateKey
    }

    override suspend fun getPublicKey(did: String): ByteArray? {
        return keyCache[did]?.publicKey
    }

    override suspend fun storeKeyPair(
        did: String,
        privateKey: ByteArray,
        publicKey: ByteArray
    ) {
        keyCache[did] = KeyPair(privateKey, publicKey)
        Timber.d("密钥对已存储: $did")
    }

    data class KeyPair(
        val privateKey: ByteArray,
        val publicKey: ByteArray
    )
}
