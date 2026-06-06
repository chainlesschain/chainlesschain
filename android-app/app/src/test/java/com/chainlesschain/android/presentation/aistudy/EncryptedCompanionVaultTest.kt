package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.core.security.strongbox.EncryptResult
import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import com.chainlesschain.android.core.security.strongbox.KeystoreFacadeException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 用真 AES-256-GCM (javax.crypto) 的内存 [KeystoreFacade] 替代 AndroidKeystore，
 * 在 JVM 上跑透金库的加解密 + 持久化 + 防篡改逻辑。真机只差 Keystore key 落硬件。
 */
class EncryptedCompanionVaultTest {

    private class FakeKeystoreFacade : KeystoreFacade {
        private val keys = mutableMapOf<String, SecretKey>()
        private val rnd = SecureRandom()

        override fun isStrongBoxSupported() = false
        override fun containsAlias(alias: String) = keys.containsKey(alias)
        override fun generateAesKey(
            alias: String,
            requestedTier: KeyTier,
            requireUserAuthentication: Boolean,
            userAuthenticationValiditySeconds: Int,
        ): KeyTier {
            keys[alias] = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
            return KeyTier.WRAPPER_TEE
        }

        override fun encryptAesGcm(alias: String, plaintext: ByteArray): EncryptResult {
            val key = keys[alias] ?: throw KeystoreFacadeException("no key $alias")
            val iv = ByteArray(12).also { rnd.nextBytes(it) }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
            }
            return EncryptResult(iv, cipher.doFinal(plaintext))
        }

        override fun decryptAesGcm(alias: String, iv: ByteArray, ciphertext: ByteArray): ByteArray {
            val key = keys[alias] ?: throw KeystoreFacadeException("no key $alias")
            return try {
                Cipher.getInstance("AES/GCM/NoPadding").apply {
                    init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
                }.doFinal(ciphertext)
            } catch (e: Exception) {
                throw KeystoreFacadeException("decrypt failed", e)
            }
        }

        override fun isHardwareBackedFor(alias: String) = false
        override fun isStrongBoxBackedFor(alias: String) = false
        override fun deleteAlias(alias: String) { keys.remove(alias) }
    }

    private class InMemoryVaultStorage : VaultStorage {
        var blob: ByteArray? = null
        override fun read(): ByteArray? = blob
        override fun write(bytes: ByteArray) { blob = bytes }
        override fun delete() { blob = null }
    }

    @Test
    fun `append then load round-trips`() = runTest {
        val vault = EncryptedCompanionVault(FakeKeystoreFacade(), InMemoryVaultStorage())
        vault.append(CompanionChatRecord(true, "妈妈我害怕", 1L))
        vault.append(CompanionChatRecord(false, "别怕，我在", 2L))

        val loaded = vault.load()
        assertEquals(2, loaded.size)
        assertEquals("妈妈我害怕", loaded[0].content)
        assertTrue(loaded[0].isUser)
        assertFalse(loaded[1].isUser)
    }

    @Test
    fun `persisted blob is ciphertext, not plaintext`() = runTest {
        val storage = InMemoryVaultStorage()
        val vault = EncryptedCompanionVault(FakeKeystoreFacade(), storage)
        vault.append(CompanionChatRecord(true, "SECRET_TEXT_12345", 1L))

        val onDisk = String(storage.blob!!, Charsets.ISO_8859_1)
        assertFalse("plaintext must not appear on disk", onDisk.contains("SECRET_TEXT_12345"))
    }

    @Test
    fun `history survives reopen (new vault instance, same storage and keystore)`() = runTest {
        val keystore = FakeKeystoreFacade()
        val storage = InMemoryVaultStorage()
        EncryptedCompanionVault(keystore, storage).append(CompanionChatRecord(true, "记住我", 1L))

        val reopened = EncryptedCompanionVault(keystore, storage).load()
        assertEquals(1, reopened.size)
        assertEquals("记住我", reopened[0].content)
    }

    @Test
    fun `tampered blob decrypts to empty, never crashes`() = runTest {
        val storage = InMemoryVaultStorage()
        val vault = EncryptedCompanionVault(FakeKeystoreFacade(), storage)
        vault.append(CompanionChatRecord(true, "原文", 1L))

        // 翻转密文最后一字节 → GCM tag 校验必失败。
        storage.blob = storage.blob!!.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
        assertTrue(vault.load().isEmpty())
    }

    @Test
    fun `wrong keystore cannot read another keystore's blob`() = runTest {
        val storage = InMemoryVaultStorage()
        EncryptedCompanionVault(FakeKeystoreFacade(), storage).append(CompanionChatRecord(true, "私密", 1L))

        // 另一个 keystore (不同 key) 读同一密文 → 解密失败 → 空 (模拟家长换设备/换 key)。
        val otherKeystore = FakeKeystoreFacade()
        assertTrue(EncryptedCompanionVault(otherKeystore, storage).load().isEmpty())
    }

    @Test
    fun `clear empties the vault`() = runTest {
        val vault = EncryptedCompanionVault(FakeKeystoreFacade(), InMemoryVaultStorage())
        vault.append(CompanionChatRecord(true, "x", 1L))
        vault.clear()
        assertTrue(vault.load().isEmpty())
    }
}
