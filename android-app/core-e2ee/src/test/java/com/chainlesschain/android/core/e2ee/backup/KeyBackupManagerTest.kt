package com.chainlesschain.android.core.e2ee.backup

import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

/**
 * KeyBackupManager 测试
 */
class KeyBackupManagerTest {

    private lateinit var backupManager: KeyBackupManager

    @Before
    fun setup() {
        backupManager = KeyBackupManager()
    }

    @Test
    fun `test create and restore backup`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = mapOf(
            "key1" to X25519KeyPair.generate(),
            "key2" to X25519KeyPair.generate(),
            "key3" to X25519KeyPair.generate()
        )
        val passphrase = "strong_passphrase_123"

        // When - Create backup
        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        // Then - Backup should be valid
        assertTrue(backupManager.validateBackup(backup))

        // When - Restore backup
        val restored = backupManager.restoreBackup(backup, passphrase)

        // Then - Keys should match
        assertArrayEquals(identityKeyPair.publicKey, restored.identityKeyPair.publicKey)
        assertArrayEquals(identityKeyPair.privateKey, restored.identityKeyPair.privateKey)
        assertArrayEquals(signedPreKeyPair.publicKey, restored.signedPreKeyPair.publicKey)
        assertArrayEquals(signedPreKeyPair.privateKey, restored.signedPreKeyPair.privateKey)

        assertEquals(3, restored.oneTimePreKeys.size)
        oneTimePreKeys.forEach { (id, keyPair) ->
            val restoredKeyPair = restored.oneTimePreKeys[id]
            assertNotNull(restoredKeyPair)
            assertArrayEquals(keyPair.publicKey, restoredKeyPair!!.publicKey)
            assertArrayEquals(keyPair.privateKey, restoredKeyPair.privateKey)
        }
    }

    @Test(expected = BackupException::class)
    fun `test restore with wrong passphrase throws exception`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = emptyMap<String, X25519KeyPair>()
        val passphrase = "correct_passphrase"

        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        // When - Try to restore with wrong passphrase
        backupManager.restoreBackup(backup, "wrong_passphrase")

        // Then - Should throw BackupException
    }

    @Test
    fun `test export and import backup as Base64`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = emptyMap<String, X25519KeyPair>()
        val passphrase = "test_passphrase"

        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        // When - Export as Base64
        val base64 = backupManager.exportBackupAsBase64(backup)
        assertNotNull(base64)
        assertTrue(base64.isNotEmpty())

        // When - Import from Base64
        val importedBackup = backupManager.importBackupFromBase64(base64)

        // Then - Should be able to restore
        val restored = backupManager.restoreBackup(importedBackup, passphrase)

        assertArrayEquals(identityKeyPair.publicKey, restored.identityKeyPair.publicKey)
        assertArrayEquals(identityKeyPair.privateKey, restored.identityKeyPair.privateKey)
    }

    @Test
    fun `test backup with empty one-time pre-keys`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = emptyMap<String, X25519KeyPair>()
        val passphrase = "test_passphrase"

        // When
        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        val restored = backupManager.restoreBackup(backup, passphrase)

        // Then
        assertTrue(restored.oneTimePreKeys.isEmpty())
        assertArrayEquals(identityKeyPair.publicKey, restored.identityKeyPair.publicKey)
    }

    @Test
    fun `test backup with many one-time pre-keys`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = (1..50).associate {
            "key_$it" to X25519KeyPair.generate()
        }
        val passphrase = "test_passphrase"

        // When
        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        val restored = backupManager.restoreBackup(backup, passphrase)

        // Then
        assertEquals(50, restored.oneTimePreKeys.size)
    }

    @Test
    fun `test validate backup structure`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = emptyMap<String, X25519KeyPair>()
        val passphrase = "test_passphrase"

        // When
        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        // Then
        assertTrue(backupManager.validateBackup(backup))
        assertEquals(1, backup.version)
        assertEquals(32, backup.salt.size)
        assertTrue(backup.encryptedData.isNotEmpty())
        assertTrue(backup.timestamp > 0)
    }

    @Test
    fun `test different passphrases produce different backups`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = emptyMap<String, X25519KeyPair>()

        // When
        val backup1 = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            "passphrase1"
        )

        val backup2 = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            "passphrase2"
        )

        // Then - Encrypted data should be different
        assertFalse(backup1.encryptedData.contentEquals(backup2.encryptedData))

        // But both should be valid
        assertTrue(backupManager.validateBackup(backup1))
        assertTrue(backupManager.validateBackup(backup2))
    }

    @Test
    fun `test backup timestamp`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = emptyMap<String, X25519KeyPair>()
        val passphrase = "test_passphrase"

        val timestampBefore = System.currentTimeMillis()

        // When
        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        val timestampAfter = System.currentTimeMillis()

        // Then
        assertTrue(backup.timestamp >= timestampBefore)
        assertTrue(backup.timestamp <= timestampAfter)

        // Restore should preserve timestamp
        val restored = backupManager.restoreBackup(backup, passphrase)
        assertEquals(backup.timestamp, restored.backupTimestamp)
    }

    @Test
    fun `test multiple backup and restore cycles`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = mapOf("key1" to X25519KeyPair.generate())
        val passphrase = "test_passphrase"

        // When - Multiple backup/restore cycles
        var currentIdentity = identityKeyPair
        var currentSignedPreKey = signedPreKeyPair
        var currentOneTimeKeys = oneTimePreKeys

        repeat(5) {
            val backup = backupManager.createBackup(
                currentIdentity,
                currentSignedPreKey,
                currentOneTimeKeys,
                passphrase
            )

            val restored = backupManager.restoreBackup(backup, passphrase)

            currentIdentity = restored.identityKeyPair
            currentSignedPreKey = restored.signedPreKeyPair
            currentOneTimeKeys = restored.oneTimePreKeys
        }

        // Then - Final keys should match original
        assertArrayEquals(identityKeyPair.publicKey, currentIdentity.publicKey)
        assertArrayEquals(identityKeyPair.privateKey, currentIdentity.privateKey)
        assertArrayEquals(signedPreKeyPair.publicKey, currentSignedPreKey.publicKey)
        assertArrayEquals(signedPreKeyPair.privateKey, currentSignedPreKey.privateKey)
    }

    @Test
    fun `test backup with special characters in passphrase`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = emptyMap<String, X25519KeyPair>()
        val passphrase = "P@ssw0rd!#\$%^&*()_+-=[]{}|;:'\",.<>?/~`"

        // When
        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        val restored = backupManager.restoreBackup(backup, passphrase)

        // Then
        assertArrayEquals(identityKeyPair.publicKey, restored.identityKeyPair.publicKey)
        assertArrayEquals(identityKeyPair.privateKey, restored.identityKeyPair.privateKey)
    }

    @Test
    fun `test backup with UTF-8 passphrase`() {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys = emptyMap<String, X25519KeyPair>()
        val passphrase = "密码123 паролю مرور"

        // When
        val backup = backupManager.createBackup(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeys,
            passphrase
        )

        val restored = backupManager.restoreBackup(backup, passphrase)

        // Then
        assertArrayEquals(identityKeyPair.publicKey, restored.identityKeyPair.publicKey)
    }
}
