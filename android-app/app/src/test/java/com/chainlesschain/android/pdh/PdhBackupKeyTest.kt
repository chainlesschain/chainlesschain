package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.security.strongbox.EncryptResult
import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import com.chainlesschain.android.core.security.strongbox.KeystoreFacadeException
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * §8.3/§7.3 备份密钥 DID 派生与置备测试:alias 确定性(同 DID 同 alias)、缺则生成、幂等
 * 不重建、无 StrongBox 静默降级、DID→key→cipher→信封端到端往返。fake KeystoreFacade。
 */
class PdhBackupKeyTest {

    /** 最小 fake:内存别名表 + 可逆 AES 模拟(reverse),够测置备 + cipher 往返。 */
    private class FakeFacade(private val supportsStrongBox: Boolean = true) : KeystoreFacade {
        val aliases = mutableMapOf<String, KeyTier>()
        override fun isStrongBoxSupported() = supportsStrongBox
        override fun containsAlias(alias: String) = aliases.containsKey(alias)
        override fun generateAesKey(
            alias: String,
            requestedTier: KeyTier,
            requireUserAuthentication: Boolean,
            userAuthenticationValiditySeconds: Int,
        ): KeyTier {
            val landed = if (requestedTier == KeyTier.WRAPPER_STRONGBOX && !supportsStrongBox) {
                KeyTier.WRAPPER_TEE // 无 StrongBox → 静默降级
            } else {
                requestedTier
            }
            aliases[alias] = landed
            return landed
        }
        override fun encryptAesGcm(alias: String, plaintext: ByteArray): EncryptResult {
            if (!aliases.containsKey(alias)) throw KeystoreFacadeException("no key: $alias")
            return EncryptResult(byteArrayOf(7), plaintext.reversedArray())
        }
        override fun decryptAesGcm(alias: String, iv: ByteArray, ciphertext: ByteArray): ByteArray {
            if (!aliases.containsKey(alias)) throw KeystoreFacadeException("no key: $alias")
            return ciphertext.reversedArray()
        }
        override fun isHardwareBackedFor(alias: String) = aliases[alias]?.isHardwareBacked ?: false
        override fun isStrongBoxBackedFor(alias: String) =
            aliases[alias] == KeyTier.WRAPPER_STRONGBOX || aliases[alias] == KeyTier.NATIVE_STRONGBOX
        override fun deleteAlias(alias: String) { aliases.remove(alias) }
    }

    @Test
    fun alias_is_deterministic_and_did_specific() {
        val did = "did:key:z6MkExampleAbc"
        assertEquals(PdhBackupKey.aliasFor(did), PdhBackupKey.aliasFor(did)) // 同 DID 同 alias
        assertTrue(PdhBackupKey.aliasFor(did).startsWith(PdhBackupKey.ALIAS_PREFIX))
        assertTrue(PdhBackupKey.aliasFor(did) != PdhBackupKey.aliasFor("did:key:z6MkOther"))
    }

    @Test
    fun blank_did_is_rejected() {
        assertFailsWith<IllegalArgumentException> { PdhBackupKey.aliasFor("  ") }
    }

    @Test
    fun ensure_key_generates_when_absent_then_is_idempotent() {
        val facade = FakeFacade(supportsStrongBox = true)
        val did = "did:key:z6MkAbc"
        val tier1 = PdhBackupKey.ensureKey(facade, did)
        assertEquals(KeyTier.WRAPPER_STRONGBOX, tier1) // 生成到硬件级
        assertTrue(facade.containsAlias(PdhBackupKey.aliasFor(did)))
        // 再调:已存在 → 报告现 tier,不重建(别名表仍 1 项)
        val tier2 = PdhBackupKey.ensureKey(facade, did)
        assertEquals(KeyTier.WRAPPER_STRONGBOX, tier2)
        assertEquals(1, facade.aliases.size)
    }

    @Test
    fun ensure_key_degrades_without_strongbox() {
        val facade = FakeFacade(supportsStrongBox = false)
        val tier = PdhBackupKey.ensureKey(facade, "did:key:z6MkAbc")
        assertEquals(KeyTier.WRAPPER_TEE, tier) // 静默降级到 TEE
    }

    @Test
    fun ensure_then_cipher_round_trips_via_envelope() {
        val facade = FakeFacade()
        val did = "did:key:z6MkBackupRoot"
        PdhBackupKey.ensureKey(facade, did)
        val cipher = PdhBackupKey.cipherFor(facade, did)
        val block = PdhBackupEnvelope.seal(AssetKind.VAULT, "私人秘密".toByteArray(), cipher)
        // DID → alias → key → cipher → 信封 seal/open 端到端
        assertTrue(PdhBackupEnvelope.open(block, cipher).contentEquals("私人秘密".toByteArray()))
    }
}
