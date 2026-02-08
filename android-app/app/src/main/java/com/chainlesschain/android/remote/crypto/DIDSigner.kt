package com.chainlesschain.android.remote.crypto

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import timber.log.Timber
import java.security.MessageDigest
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

            // 3. 使用 Ed25519 计算签名
            val signature = signWithEd25519(dataBytes, privateKey)

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

            // 3. 使用 Ed25519 验证签名
            val isValid = verifyWithEd25519(dataBytes, signatureBytes, publicKeyBytes)

            Timber.d("签名验证结果: $isValid")
            Result.success(isValid)
        } catch (e: Exception) {
            Timber.e(e, "签名验证失败")
            Result.failure(e)
        }
    }

    /**
     * 使用 Ed25519 签名（符合 DID 标准）
     */
    private fun signWithEd25519(data: ByteArray, privateKey: ByteArray): ByteArray {
        // Ed25519 私钥长度必须是 32 字节
        require(privateKey.size == 32) { "Ed25519 private key must be 32 bytes" }

        val privateKeyParams = Ed25519PrivateKeyParameters(privateKey, 0)
        val signer = Ed25519Signer()
        signer.init(true, privateKeyParams)
        signer.update(data, 0, data.size)
        return signer.generateSignature()
    }

    /**
     * 使用 Ed25519 验证签名（符合 DID 标准）
     */
    private fun verifyWithEd25519(
        data: ByteArray,
        signature: ByteArray,
        publicKey: ByteArray
    ): Boolean {
        return try {
            // Ed25519 公钥长度必须是 32 字节
            require(publicKey.size == 32) { "Ed25519 public key must be 32 bytes" }
            // Ed25519 签名长度必须是 64 字节
            require(signature.size == 64) { "Ed25519 signature must be 64 bytes" }

            val publicKeyParams = Ed25519PublicKeyParameters(publicKey, 0)
            val verifier = Ed25519Signer()
            verifier.init(false, publicKeyParams)
            verifier.update(data, 0, data.size)
            verifier.verifySignature(signature)
        } catch (e: Exception) {
            Timber.e(e, "Ed25519 验证异常")
            false
        }
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

    /**
     * 检查是否存在指定 DID 的密钥对
     */
    suspend fun hasKeyPair(did: String): Boolean

    /**
     * 删除指定 DID 的密钥对
     */
    suspend fun removeKeyPair(did: String): Boolean

    /**
     * 获取所有已存储的 DID 标识符
     */
    suspend fun getAllKeyIds(): List<String>
}

/**
 * DID 密钥存储实现（使用 Android KeyStore + EncryptedSharedPreferences）
 *
 * 安全架构：
 * - AES-256-GCM 主密钥由 Android Keystore 硬件安全模块保护
 * - Ed25519 私钥/公钥序列化为 Base64 后存储在 EncryptedSharedPreferences 中
 * - EncryptedSharedPreferences 使用 AES256-SIV 加密键名，AES256-GCM 加密值
 * - 内存缓存用于减少解密开销，应用重启后自动从加密存储恢复
 */
@Singleton
class AndroidDIDKeyStore @Inject constructor(
    @ApplicationContext private val context: Context
) : DIDKeyStore {

    companion object {
        private const val PREFS_NAME = "did_keystore_encrypted_prefs"
        private const val KEY_PREFIX_PRIVATE = "did_private_"
        private const val KEY_PREFIX_PUBLIC = "did_public_"
        private const val KEY_ALL_DIDS = "did_all_ids"
        private const val DID_SEPARATOR = "\u001F" // Unit separator, not valid in DIDs
    }

    /** AES-256-GCM master key stored in Android Keystore hardware */
    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    /** EncryptedSharedPreferences backed by Android Keystore master key */
    private val encryptedPrefs: SharedPreferences by lazy {
        EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /** In-memory cache to avoid repeated decryption; loaded on-demand from encrypted storage */
    private val keyCache = mutableMapOf<String, KeyPairData>()

    override suspend fun getPrivateKey(did: String): ByteArray? {
        // Check memory cache first
        keyCache[did]?.let { return it.privateKey }

        // Fall back to encrypted storage
        val encoded = encryptedPrefs.getString(KEY_PREFIX_PRIVATE + did, null)
            ?: return null
        val privateKey = Base64.decode(encoded, Base64.NO_WRAP)

        // Also load public key into cache while we're at it
        val publicEncoded = encryptedPrefs.getString(KEY_PREFIX_PUBLIC + did, null)
        if (publicEncoded != null) {
            val publicKey = Base64.decode(publicEncoded, Base64.NO_WRAP)
            keyCache[did] = KeyPairData(privateKey, publicKey)
        }

        return privateKey
    }

    override suspend fun getPublicKey(did: String): ByteArray? {
        // Check memory cache first
        keyCache[did]?.let { return it.publicKey }

        // Fall back to encrypted storage
        val encoded = encryptedPrefs.getString(KEY_PREFIX_PUBLIC + did, null)
            ?: return null
        return Base64.decode(encoded, Base64.NO_WRAP)
    }

    override suspend fun storeKeyPair(
        did: String,
        privateKey: ByteArray,
        publicKey: ByteArray
    ) {
        val privateEncoded = Base64.encodeToString(privateKey, Base64.NO_WRAP)
        val publicEncoded = Base64.encodeToString(publicKey, Base64.NO_WRAP)

        // Persist to encrypted storage atomically
        val currentDids = loadAllDids().toMutableSet()
        currentDids.add(did)

        encryptedPrefs.edit()
            .putString(KEY_PREFIX_PRIVATE + did, privateEncoded)
            .putString(KEY_PREFIX_PUBLIC + did, publicEncoded)
            .putString(KEY_ALL_DIDS, currentDids.joinToString(DID_SEPARATOR))
            .apply()

        // Update memory cache
        keyCache[did] = KeyPairData(privateKey, publicKey)

        Timber.d("密钥对已安全存储 (EncryptedSharedPreferences): $did")
    }

    override suspend fun hasKeyPair(did: String): Boolean {
        if (keyCache.containsKey(did)) return true
        return encryptedPrefs.contains(KEY_PREFIX_PRIVATE + did)
    }

    override suspend fun removeKeyPair(did: String): Boolean {
        val existed = hasKeyPair(did)
        if (!existed) return false

        // Remove from encrypted storage
        val currentDids = loadAllDids().toMutableSet()
        currentDids.remove(did)

        encryptedPrefs.edit()
            .remove(KEY_PREFIX_PRIVATE + did)
            .remove(KEY_PREFIX_PUBLIC + did)
            .putString(KEY_ALL_DIDS, currentDids.joinToString(DID_SEPARATOR))
            .apply()

        // Remove from memory cache
        keyCache.remove(did)

        Timber.d("密钥对已删除: $did")
        return true
    }

    override suspend fun getAllKeyIds(): List<String> {
        return loadAllDids()
    }

    /**
     * Load the set of all stored DID identifiers from encrypted storage.
     */
    private fun loadAllDids(): List<String> {
        val raw = encryptedPrefs.getString(KEY_ALL_DIDS, null)
            ?: return emptyList()
        return raw.split(DID_SEPARATOR).filter { it.isNotEmpty() }
    }

    data class KeyPairData(
        val privateKey: ByteArray,
        val publicKey: ByteArray
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is KeyPairData) return false
            return privateKey.contentEquals(other.privateKey) &&
                publicKey.contentEquals(other.publicKey)
        }

        override fun hashCode(): Int {
            var result = privateKey.contentHashCode()
            result = 31 * result + publicKey.contentHashCode()
            return result
        }
    }
}
