package com.chainlesschain.android.core.e2ee.storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import timber.log.Timber
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 加密存储
 *
 * 使用 Android Keystore 提供设备绑定的加密存储
 */
object EncryptedStorage {

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "chainlesschain_e2ee_master_key"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_LENGTH = 128
    private const val IV_SIZE = 12 // GCM 标准 IV 大小

    /**
     * 加密数据
     *
     * @param context Android 上下文
     * @param data 原始数据
     * @return 加密后的数据 (IV + 密文 + Tag)
     */
    fun encrypt(context: Context, data: ByteArray): ByteArray {
        try {
            val secretKey = getOrCreateSecretKey()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey)

            val iv = cipher.iv
            val encrypted = cipher.doFinal(data)

            // 格式: IV (12 bytes) + 密文 + Tag (16 bytes, GCM 自动添加)
            return iv + encrypted
        } catch (e: Exception) {
            Timber.e(e, "Encryption failed")
            throw SecurityException("Failed to encrypt data", e)
        }
    }

    /**
     * 解密数据
     *
     * @param context Android 上下文
     * @param encryptedData 加密的数据 (IV + 密文 + Tag)
     * @return 原始数据
     */
    fun decrypt(context: Context, encryptedData: ByteArray): ByteArray {
        try {
            if (encryptedData.size < IV_SIZE) {
                throw IllegalArgumentException("Encrypted data too short")
            }

            val secretKey = getOrCreateSecretKey()

            // 提取 IV 和密文
            val iv = encryptedData.copyOfRange(0, IV_SIZE)
            val ciphertext = encryptedData.copyOfRange(IV_SIZE, encryptedData.size)

            val cipher = Cipher.getInstance(TRANSFORMATION)
            val spec = GCMParameterSpec(GCM_TAG_LENGTH, iv)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)

            return cipher.doFinal(ciphertext)
        } catch (e: Exception) {
            Timber.e(e, "Decryption failed")
            throw SecurityException("Failed to decrypt data", e)
        }
    }

    /**
     * 获取或创建 Secret Key
     *
     * 使用 Android Keystore 生成设备绑定的密钥
     */
    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)

        // 检查密钥是否已存在
        if (keyStore.containsAlias(KEY_ALIAS)) {
            val entry = keyStore.getEntry(KEY_ALIAS, null)
            if (entry is KeyStore.SecretKeyEntry) {
                return entry.secretKey
            }
        }

        // 生成新密钥
        return generateSecretKey()
    }

    /**
     * 生成 Secret Key
     */
    private fun generateSecretKey(): SecretKey {
        Timber.d("Generating new secret key")

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE
        )

        val keyGenParameterSpec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(false) // 不需要用户认证（可根据需求调整）
            .setRandomizedEncryptionRequired(true)
            .build()

        keyGenerator.init(keyGenParameterSpec)
        return keyGenerator.generateKey()
    }

    /**
     * 删除 Secret Key
     *
     * 用于清除所有加密数据的访问权限
     */
    fun deleteSecretKey() {
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)

            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS)
                Timber.d("Secret key deleted")
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to delete secret key")
        }
    }

    /**
     * 检查密钥是否存在
     */
    fun keyExists(): Boolean {
        return try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)
            keyStore.containsAlias(KEY_ALIAS)
        } catch (e: Exception) {
            Timber.e(e, "Failed to check key existence")
            false
        }
    }
}
