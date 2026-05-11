package com.chainlesschain.android.core.did.testing

import com.chainlesschain.android.core.security.strongbox.EncryptResult
import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import com.chainlesschain.android.core.security.strongbox.KeystoreFacadeException
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 测试用 [KeystoreFacade] 实现：用标准 JCE AES-256-GCM 模拟 Keystore 行为，
 * 但**所有密钥都驻留在堆内存**，进程结束即丢失。
 *
 * 优点：
 *  - 真实 AES 加解密，可验证 [StrongBoxKeyManager] wrap/unwrap 数据流端到端
 *  - 零 Android 依赖，JVM 单测可用，无需 Robolectric / instrumented test
 *  - 可注入 `strongBoxSupported` flag 控制 tier 探测分支
 *
 * 注意：此 fake **不模拟硬件 backing**——[isHardwareBackedFor] / [isStrongBoxBackedFor]
 * 默认根据 [strongBoxSupported] 返回；测试需要的 tier 上报由参数控制。
 */
class FakeKeystoreFacade(
    private val strongBoxSupported: Boolean = false,
    private val hardwareBacked: Boolean = false,
) : KeystoreFacade {

    private val keys = mutableMapOf<String, SecretKey>()
    private val random = SecureRandom()

    override fun isStrongBoxSupported(): Boolean = strongBoxSupported

    override fun containsAlias(alias: String): Boolean = keys.containsKey(alias)

    override fun generateAesKey(
        alias: String,
        requestedTier: KeyTier,
        requireUserAuthentication: Boolean,
        userAuthenticationValiditySeconds: Int,
    ): KeyTier {
        if (keys.containsKey(alias)) return resolveTierFor(alias)
        val gen = KeyGenerator.getInstance("AES")
        gen.init(KEY_BITS, random)
        keys[alias] = gen.generateKey()
        return resolveTierFor(alias)
    }

    override fun encryptAesGcm(alias: String, plaintext: ByteArray): EncryptResult {
        val key = keys[alias]
            ?: throw KeystoreFacadeException("No key for alias=$alias")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ct = cipher.doFinal(plaintext)
        return EncryptResult(iv = cipher.iv.copyOf(), ciphertext = ct)
    }

    override fun decryptAesGcm(alias: String, iv: ByteArray, ciphertext: ByteArray): ByteArray {
        val key = keys[alias]
            ?: throw KeystoreFacadeException("No key for alias=$alias")
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.doFinal(ciphertext)
        } catch (e: Exception) {
            throw KeystoreFacadeException("Decrypt failed for alias=$alias", e)
        }
    }

    override fun isHardwareBackedFor(alias: String): Boolean = hardwareBacked

    override fun isStrongBoxBackedFor(alias: String): Boolean = strongBoxSupported

    override fun deleteAlias(alias: String) {
        keys.remove(alias)
    }

    private fun resolveTierFor(alias: String): KeyTier = when {
        strongBoxSupported -> KeyTier.WRAPPER_STRONGBOX
        hardwareBacked -> KeyTier.WRAPPER_TEE
        else -> KeyTier.SOFTWARE
    }

    companion object {
        private const val KEY_BITS = 256
        private const val GCM_TAG_BITS = 128
    }
}
