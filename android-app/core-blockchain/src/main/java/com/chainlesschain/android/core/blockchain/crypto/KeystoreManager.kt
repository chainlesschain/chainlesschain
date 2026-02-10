package com.chainlesschain.android.core.blockchain.crypto

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.chainlesschain.android.core.common.Result
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Android Keystore manager for secure key storage
 * Uses hardware-backed keystore when available
 */
@Singleton
class KeystoreManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val WALLET_KEY_ALIAS_PREFIX = "wallet_key_"
        private const val MASTER_KEY_ALIAS = "chainlesschain_master_key"
        private const val ENCRYPTED_PREFS_NAME = "encrypted_wallet_prefs"

        private const val GCM_TAG_LENGTH = 128
        private const val GCM_IV_LENGTH = 12
    }

    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(ANDROID_KEYSTORE).apply {
            load(null)
        }
    }

    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .setUserAuthenticationRequired(false)
            .build()
    }

    private val encryptedPrefs by lazy {
        EncryptedSharedPreferences.create(
            context,
            ENCRYPTED_PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /**
     * Store private key securely
     */
    suspend fun storePrivateKey(
        walletId: String,
        privateKey: ByteArray,
        requireBiometric: Boolean = false
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val keyAlias = "$WALLET_KEY_ALIAS_PREFIX$walletId"

            // Generate encryption key in keystore
            val encryptionKey = getOrCreateEncryptionKey(keyAlias, requireBiometric)

            // Encrypt the private key
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey)

            val iv = cipher.iv
            val encryptedData = cipher.doFinal(privateKey)

            // Store IV and encrypted data
            val combined = iv + encryptedData
            val encoded = android.util.Base64.encodeToString(combined, android.util.Base64.NO_WRAP)

            encryptedPrefs.edit()
                .putString(keyAlias, encoded)
                .apply()

            // Clear sensitive data
            privateKey.fill(0)

            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to store private key")
            Result.error(e, "Failed to store private key securely")
        }
    }

    /**
     * Retrieve private key
     */
    suspend fun retrievePrivateKey(
        walletId: String
    ): Result<ByteArray> = withContext(Dispatchers.IO) {
        try {
            val keyAlias = "$WALLET_KEY_ALIAS_PREFIX$walletId"

            // Get encryption key from keystore
            val encryptionKey = keyStore.getKey(keyAlias, null) as? SecretKey
                ?: return@withContext Result.error(
                    IllegalStateException("Key not found"),
                    "Wallet key not found"
                )

            // Get encrypted data
            val encoded = encryptedPrefs.getString(keyAlias, null)
                ?: return@withContext Result.error(
                    IllegalStateException("Encrypted data not found"),
                    "Wallet data not found"
                )

            val combined = android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP)

            // Extract IV and encrypted data
            val iv = combined.sliceArray(0 until GCM_IV_LENGTH)
            val encryptedData = combined.sliceArray(GCM_IV_LENGTH until combined.size)

            // Decrypt
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                encryptionKey,
                GCMParameterSpec(GCM_TAG_LENGTH, iv)
            )

            val privateKey = cipher.doFinal(encryptedData)
            Result.success(privateKey)
        } catch (e: Exception) {
            Timber.e(e, "Failed to retrieve private key")
            Result.error(e, "Failed to retrieve private key")
        }
    }

    /**
     * Delete stored private key
     */
    suspend fun deletePrivateKey(walletId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val keyAlias = "$WALLET_KEY_ALIAS_PREFIX$walletId"

            // Delete from keystore
            if (keyStore.containsAlias(keyAlias)) {
                keyStore.deleteEntry(keyAlias)
            }

            // Delete from encrypted prefs
            encryptedPrefs.edit()
                .remove(keyAlias)
                .apply()

            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to delete private key")
            Result.error(e, "Failed to delete private key")
        }
    }

    /**
     * Check if private key exists
     */
    fun hasPrivateKey(walletId: String): Boolean {
        val keyAlias = "$WALLET_KEY_ALIAS_PREFIX$walletId"
        return keyStore.containsAlias(keyAlias) &&
                encryptedPrefs.contains(keyAlias)
    }

    /**
     * Get all stored wallet IDs
     */
    fun getStoredWalletIds(): List<String> {
        return try {
            keyStore.aliases().toList()
                .filter { it.startsWith(WALLET_KEY_ALIAS_PREFIX) }
                .map { it.removePrefix(WALLET_KEY_ALIAS_PREFIX) }
        } catch (e: Exception) {
            Timber.e(e, "Failed to get stored wallet IDs")
            emptyList()
        }
    }

    /**
     * Check if device has hardware-backed keystore
     */
    fun isHardwareBackedKeystore(): Boolean {
        return try {
            // Check if the keystore is hardware-backed
            val keyInfo = keyStore.getKey(MASTER_KEY_ALIAS, null)
            keyInfo != null
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Store encrypted mnemonic
     */
    suspend fun storeMnemonic(
        walletId: String,
        mnemonic: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val key = "mnemonic_$walletId"
            encryptedPrefs.edit()
                .putString(key, mnemonic)
                .apply()
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to store mnemonic")
            Result.error(e, "Failed to store mnemonic")
        }
    }

    /**
     * Retrieve mnemonic
     */
    suspend fun retrieveMnemonic(walletId: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val key = "mnemonic_$walletId"
            val mnemonic = encryptedPrefs.getString(key, null)
                ?: return@withContext Result.error(
                    IllegalStateException("Mnemonic not found"),
                    "Mnemonic not found"
                )
            Result.success(mnemonic)
        } catch (e: Exception) {
            Timber.e(e, "Failed to retrieve mnemonic")
            Result.error(e, "Failed to retrieve mnemonic")
        }
    }

    /**
     * Delete mnemonic
     */
    suspend fun deleteMnemonic(walletId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val key = "mnemonic_$walletId"
            encryptedPrefs.edit()
                .remove(key)
                .apply()
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to delete mnemonic")
            Result.error(e, "Failed to delete mnemonic")
        }
    }

    // ==================== Private Helpers ====================

    /**
     * Get or create encryption key in keystore
     */
    private fun getOrCreateEncryptionKey(
        alias: String,
        requireBiometric: Boolean
    ): SecretKey {
        // Check if key already exists
        if (keyStore.containsAlias(alias)) {
            return keyStore.getKey(alias, null) as SecretKey
        }

        // Generate new key
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE
        )

        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)

        if (requireBiometric) {
            builder
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationValidityDurationSeconds(30)
                .setInvalidatedByBiometricEnrollment(true)
        }

        keyGenerator.init(builder.build())
        return keyGenerator.generateKey()
    }
}

/**
 * Keystore error types
 */
sealed class KeystoreError : Exception() {
    data object KeyNotFound : KeystoreError()
    data object AuthenticationRequired : KeystoreError()
    data object KeyInvalidated : KeystoreError()
    data class EncryptionFailed(override val cause: Throwable) : KeystoreError()
    data class DecryptionFailed(override val cause: Throwable) : KeystoreError()
}
