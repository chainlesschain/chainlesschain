package com.chainlesschain.android.core.e2ee.backup

import timber.log.Timber
import com.chainlesschain.android.core.e2ee.crypto.HKDF
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 密钥备份管理器
 *
 * 提供密钥的安全备份和恢复功能
 */
class KeyBackupManager {

    companion object {
        private const val VERSION = 1
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_LENGTH = 128
        private const val IV_SIZE = 12
        private const val KEY_SIZE = 32 // AES-256

        private val json = Json {
            ignoreUnknownKeys = true
            prettyPrint = true
        }
    }

    /**
     * 创建密钥备份
     *
     * @param identityKeyPair 身份密钥对
     * @param signedPreKeyPair 签名预密钥对
     * @param oneTimePreKeys 一次性预密钥
     * @param passphrase 备份密码（用于加密）
     * @return 加密的备份数据
     */
    fun createBackup(
        identityKeyPair: X25519KeyPair,
        signedPreKeyPair: X25519KeyPair,
        oneTimePreKeys: Map<String, X25519KeyPair>,
        passphrase: String
    ): EncryptedBackup {
        Timber.i("Creating key backup")

        try {
            // 构建备份数据
            val backup = KeyBackup(
                version = VERSION,
                timestamp = System.currentTimeMillis(),
                identityPublicKey = identityKeyPair.publicKey,
                identityPrivateKey = identityKeyPair.privateKey,
                signedPreKeyPublic = signedPreKeyPair.publicKey,
                signedPreKeyPrivate = signedPreKeyPair.privateKey,
                oneTimePreKeys = oneTimePreKeys.map { (id, keyPair) ->
                    PreKeyBackup(id, keyPair.publicKey, keyPair.privateKey)
                }
            )

            // 序列化
            val backupJson = json.encodeToString(backup)

            // 使用密码派生加密密钥
            val salt = ByteArray(32)
            SecureRandom().nextBytes(salt)

            val encryptionKey = deriveKeyFromPassphrase(passphrase, salt)

            // 加密备份数据
            val encryptedData = encryptData(backupJson.toByteArray(Charsets.UTF_8), encryptionKey)

            Timber.i("Key backup created successfully")

            return EncryptedBackup(
                version = VERSION,
                salt = salt,
                encryptedData = encryptedData,
                timestamp = backup.timestamp
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to create backup")
            throw BackupException("Failed to create backup", e)
        }
    }

    /**
     * 恢复密钥备份
     *
     * @param encryptedBackup 加密的备份数据
     * @param passphrase 备份密码
     * @return 恢复的密钥数据
     */
    fun restoreBackup(
        encryptedBackup: EncryptedBackup,
        passphrase: String
    ): RestoredKeys {
        Timber.i("Restoring key backup")

        try {
            // 派生解密密钥
            val encryptionKey = deriveKeyFromPassphrase(passphrase, encryptedBackup.salt)

            // 解密备份数据
            val decryptedData = decryptData(encryptedBackup.encryptedData, encryptionKey)
            val backupJson = String(decryptedData, Charsets.UTF_8)

            // 反序列化
            val backup = json.decodeFromString<KeyBackup>(backupJson)

            // 验证版本
            if (backup.version != VERSION) {
                throw BackupException("Unsupported backup version: ${backup.version}")
            }

            // 构建密钥对
            val identityKeyPair = X25519KeyPair(
                backup.identityPublicKey,
                backup.identityPrivateKey
            )

            val signedPreKeyPair = X25519KeyPair(
                backup.signedPreKeyPublic,
                backup.signedPreKeyPrivate
            )

            val oneTimePreKeys = backup.oneTimePreKeys.associate { preKey ->
                preKey.id to X25519KeyPair(preKey.publicKey, preKey.privateKey)
            }

            Timber.i("Key backup restored successfully")

            return RestoredKeys(
                identityKeyPair = identityKeyPair,
                signedPreKeyPair = signedPreKeyPair,
                oneTimePreKeys = oneTimePreKeys,
                backupTimestamp = backup.timestamp
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to restore backup")
            throw BackupException("Failed to restore backup", e)
        }
    }

    /**
     * 从密码派生加密密钥
     *
     * 使用 HKDF 进行密钥派生
     */
    private fun deriveKeyFromPassphrase(passphrase: String, salt: ByteArray): SecretKey {
        val passphraseBytes = passphrase.toByteArray(Charsets.UTF_8)

        // 使用 HKDF 派生密钥
        val prk = HKDF.extract(salt, passphraseBytes)
        val keyMaterial = HKDF.expand(prk, "E2EE Key Backup v1".toByteArray(), KEY_SIZE)

        return SecretKeySpec(keyMaterial, "AES")
    }

    /**
     * 加密数据
     *
     * 使用 AES-256-GCM
     */
    private fun encryptData(data: ByteArray, key: SecretKey): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)

        val iv = cipher.iv
        val encrypted = cipher.doFinal(data)

        // 格式: IV (12 bytes) + 密文 + Tag (16 bytes)
        return iv + encrypted
    }

    /**
     * 解密数据
     *
     * 使用 AES-256-GCM
     */
    private fun decryptData(encryptedData: ByteArray, key: SecretKey): ByteArray {
        if (encryptedData.size < IV_SIZE) {
            throw IllegalArgumentException("Encrypted data too short")
        }

        // 提取 IV 和密文
        val iv = encryptedData.copyOfRange(0, IV_SIZE)
        val ciphertext = encryptedData.copyOfRange(IV_SIZE, encryptedData.size)

        val cipher = Cipher.getInstance(TRANSFORMATION)
        val spec = GCMParameterSpec(GCM_TAG_LENGTH, iv)
        cipher.init(Cipher.DECRYPT_MODE, key, spec)

        return cipher.doFinal(ciphertext)
    }

    /**
     * 导出备份为 Base64
     */
    fun exportBackupAsBase64(backup: EncryptedBackup): String {
        val backupJson = json.encodeToString(backup)
        return java.util.Base64.getEncoder().encodeToString(
            backupJson.toByteArray(Charsets.UTF_8)
        )
    }

    /**
     * 从 Base64 导入备份
     */
    fun importBackupFromBase64(base64: String): EncryptedBackup {
        val backupJson = String(
            java.util.Base64.getDecoder().decode(base64),
            Charsets.UTF_8
        )
        return json.decodeFromString(backupJson)
    }

    /**
     * 验证备份完整性
     *
     * @return true 如果备份格式有效
     */
    fun validateBackup(encryptedBackup: EncryptedBackup): Boolean {
        return try {
            encryptedBackup.version == VERSION &&
            encryptedBackup.salt.size == 32 &&
            encryptedBackup.encryptedData.isNotEmpty()
        } catch (e: Exception) {
            Timber.e(e, "Backup validation failed")
            false
        }
    }
}

/**
 * 密钥备份数据
 */
@Serializable
private data class KeyBackup(
    val version: Int,
    val timestamp: Long,
    val identityPublicKey: ByteArray,
    val identityPrivateKey: ByteArray,
    val signedPreKeyPublic: ByteArray,
    val signedPreKeyPrivate: ByteArray,
    val oneTimePreKeys: List<PreKeyBackup>
)

/**
 * 预密钥备份
 */
@Serializable
private data class PreKeyBackup(
    val id: String,
    val publicKey: ByteArray,
    val privateKey: ByteArray
)

/**
 * 加密的备份
 */
@Serializable
data class EncryptedBackup(
    val version: Int,
    val salt: ByteArray,
    val encryptedData: ByteArray,
    val timestamp: Long
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as EncryptedBackup

        if (version != other.version) return false
        if (!salt.contentEquals(other.salt)) return false
        if (!encryptedData.contentEquals(other.encryptedData)) return false
        if (timestamp != other.timestamp) return false

        return true
    }

    override fun hashCode(): Int {
        var result = version
        result = 31 * result + salt.contentHashCode()
        result = 31 * result + encryptedData.contentHashCode()
        result = 31 * result + timestamp.hashCode()
        return result
    }
}

/**
 * 恢复的密钥
 */
data class RestoredKeys(
    val identityKeyPair: X25519KeyPair,
    val signedPreKeyPair: X25519KeyPair,
    val oneTimePreKeys: Map<String, X25519KeyPair>,
    val backupTimestamp: Long
)

/**
 * 备份异常
 */
class BackupException(message: String, cause: Throwable? = null) : Exception(message, cause)
