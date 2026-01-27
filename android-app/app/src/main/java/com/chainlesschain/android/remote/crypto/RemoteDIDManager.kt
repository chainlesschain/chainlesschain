package com.chainlesschain.android.remote.crypto

import android.content.Context
import android.content.SharedPreferences
import timber.log.Timber
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 远程控制专用 DID 管理器
 *
 * 提供 DID 身份管理和签名功能
 */
@Singleton
class RemoteDIDManager @Inject constructor(
    private val context: Context,
    private val didSigner: DIDSigner,
    private val keyStore: DIDKeyStore
) {
    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences("remote_did_prefs", Context.MODE_PRIVATE)
    }

    private var currentDID: String? = null
    private var isInitialized = false

    companion object {
        private const val KEY_CURRENT_DID = "current_did"
        private const val DID_PREFIX = "did:chainlesschain:"
    }

    /**
     * 初始化 DID 管理器
     */
    suspend fun initialize(): Result<Unit> {
        return try {
            Timber.d("初始化 DID 管理器")

            // 1. 加载已有的 DID
            currentDID = prefs.getString(KEY_CURRENT_DID, null)

            // 2. 如果没有 DID，创建新的
            if (currentDID == null) {
                val result = createIdentity()
                if (result.isFailure) {
                    return Result.failure(result.exceptionOrNull() ?: Exception("Failed to create identity"))
                }
                currentDID = result.getOrNull()
            }

            isInitialized = true
            Timber.d("DID 管理器初始化完成: $currentDID")

            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "DID 管理器初始化失败")
            Result.failure(e)
        }
    }

    /**
     * 创建新的 DID 身份
     */
    suspend fun createIdentity(): Result<String> {
        return try {
            Timber.d("创建新的 DID 身份")

            // 1. 生成密钥对
            val keyPair = generateKeyPair()

            // 2. 生成 DID 标识符
            val identifier = generateIdentifier(keyPair.publicKey)
            val did = "$DID_PREFIX$identifier"

            // 3. 存储密钥对
            keyStore.storeKeyPair(did, keyPair.privateKey, keyPair.publicKey)

            // 4. 保存为当前 DID
            prefs.edit()
                .putString(KEY_CURRENT_DID, did)
                .apply()

            currentDID = did

            Timber.d("DID 身份已创建: $did")
            Result.success(did)
        } catch (e: Exception) {
            Timber.e(e, "创建 DID 身份失败")
            Result.failure(e)
        }
    }

    /**
     * 获取当前 DID
     */
    suspend fun getCurrentDID(): String {
        if (!isInitialized) {
            throw IllegalStateException("DIDManager not initialized. Call initialize() first.")
        }

        return currentDID ?: throw IllegalStateException("No DID identity found")
    }

    /**
     * 签名数据
     */
    suspend fun sign(data: String): String {
        val did = getCurrentDID()
        val result = didSigner.sign(data, did)

        if (result.isFailure) {
            throw result.exceptionOrNull() ?: Exception("Signature failed")
        }

        return result.getOrThrow()
    }

    /**
     * 验证签名
     */
    suspend fun verify(data: String, signature: String, publicKey: String): Boolean {
        val result = didSigner.verify(data, signature, publicKey)

        if (result.isFailure) {
            throw result.exceptionOrNull() ?: Exception("Verification failed")
        }

        return result.getOrThrow()
    }

    /**
     * 获取公钥
     */
    suspend fun getPublicKey(): String? {
        val did = getCurrentDID()
        val publicKeyBytes = keyStore.getPublicKey(did)

        return publicKeyBytes?.let {
            android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP)
        }
    }

    /**
     * 生成密钥对
     */
    private fun generateKeyPair(): KeyPairData {
        // 简化实现：生成随机密钥
        // 生产环境应使用 Ed25519 密钥生成
        val random = SecureRandom()
        val privateKey = ByteArray(32)
        val publicKey = ByteArray(32)

        random.nextBytes(privateKey)
        random.nextBytes(publicKey)

        return KeyPairData(privateKey, publicKey)
    }

    /**
     * 生成 DID 标识符（基于公钥哈希）
     */
    private fun generateIdentifier(publicKey: ByteArray): String {
        val publicKeyBase64 = android.util.Base64.encodeToString(
            publicKey,
            android.util.Base64.NO_WRAP
        )
        return didSigner.hash(publicKeyBase64).take(32)
    }

    /**
     * 检查是否已初始化
     */
    fun isInitialized(): Boolean = isInitialized

    data class KeyPairData(
        val privateKey: ByteArray,
        val publicKey: ByteArray
    )
}
