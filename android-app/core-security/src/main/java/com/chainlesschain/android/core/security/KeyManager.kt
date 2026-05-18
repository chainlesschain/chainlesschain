package com.chainlesschain.android.core.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 密钥管理器
 *
 * 负责管理所有加密密钥：
 * 1. 数据库加密密钥
 * 2. API密钥加密存储
 * 3. 用户数据加密
 */
@Singleton
class KeyManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply {
        load(null)
    }

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val encryptedPrefs = EncryptedSharedPreferences.create(
        context,
        "chainlesschain_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    companion object {
        private const val DATABASE_KEY_ALIAS = "database_encryption_key"
        private const val DATABASE_KEY_PREF = "database_key_encrypted"
    }

    /**
     * 获取数据库加密密钥
     *
     * 如果不存在则生成新密钥
     */
    fun getDatabaseKey(): String {
        // 尝试从加密SharedPreferences读取
        var key = encryptedPrefs.getString(DATABASE_KEY_PREF, null)

        if (key.isNullOrEmpty()) {
            // 生成新密钥（32字节=256位）
            key = generateRandomKey()
            encryptedPrefs.edit().putString(DATABASE_KEY_PREF, key).apply()
            Timber.d("Generated new database encryption key")
        }

        return key
    }

    /**
     * 生成Keystore保护的加密密钥
     */
    fun generateKeystoreKey(alias: String, requireAuth: Boolean = false) {
        if (keyStore.containsAlias(alias)) {
            Timber.d("Key $alias already exists")
            return
        }

        val keyGenParameterSpec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .apply {
                if (requireAuth) {
                    setUserAuthenticationRequired(true)
                    setUserAuthenticationValidityDurationSeconds(30)
                }
            }
            .build()

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        keyGenerator.init(keyGenParameterSpec)
        keyGenerator.generateKey()

        Timber.d("Generated Keystore key: $alias")
    }

    /**
     * 使用Keystore密钥加密数据
     */
    fun encryptWithKeystore(alias: String, data: ByteArray): ByteArray {
        val key = keyStore.getKey(alias, null) as SecretKey
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)

        val iv = cipher.iv
        val ciphertext = cipher.doFinal(data)

        // 返回格式：IV长度(4字节) + IV + 密文
        return byteArrayOf(
            (iv.size shr 24).toByte(),
            (iv.size shr 16).toByte(),
            (iv.size shr 8).toByte(),
            iv.size.toByte()
        ) + iv + ciphertext
    }

    /**
     * 使用Keystore密钥解密数据
     */
    fun decryptWithKeystore(alias: String, encryptedData: ByteArray): ByteArray {
        // 解析IV长度
        val ivLength = (encryptedData[0].toInt() and 0xFF shl 24) or
                (encryptedData[1].toInt() and 0xFF shl 16) or
                (encryptedData[2].toInt() and 0xFF shl 8) or
                (encryptedData[3].toInt() and 0xFF)

        // 提取IV和密文
        val iv = encryptedData.copyOfRange(4, 4 + ivLength)
        val ciphertext = encryptedData.copyOfRange(4 + ivLength, encryptedData.size)

        // 解密
        val key = keyStore.getKey(alias, null) as SecretKey
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))

        return cipher.doFinal(ciphertext)
    }

    /**
     * 生成随机密钥（Hex字符串）
     */
    private fun generateRandomKey(length: Int = 32): String {
        val bytes = ByteArray(length)
        java.security.SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
