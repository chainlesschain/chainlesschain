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
    private val biometricRequiredAliases = mutableSetOf<String>()
    private val random = SecureRandom()

    /**
     * 模拟 biometric 认证状态：
     *  - true（默认）：所有 decrypt 通过，相当于"用户刚在 BiometricPrompt 中通过认证"
     *  - false：对要求 biometric 的 alias 的 decrypt 抛 [KeystoreFacadeException]，
     *    模拟 Android Keystore 在 auth 窗口外拒绝解密的行为
     *
     * 测试可以通过 `fake.simulateBiometricAuthenticated = false` 验证"未认证时
     * unwrap 失败"的路径。
     */
    var simulateBiometricAuthenticated: Boolean = true

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
        if (requireUserAuthentication) {
            biometricRequiredAliases.add(alias)
        }
        return resolveTierFor(alias)
    }

    override fun encryptAesGcm(alias: String, plaintext: ByteArray): EncryptResult {
        val key = keys[alias]
            ?: throw KeystoreFacadeException("No key for alias=$alias")
        // Encryption is allowed even if biometric required (Android Keystore behavior:
        // setUserAuthenticationRequired affects only PRIVATE/DECRYPT operations on
        // signing keys; for symmetric AES, ENCRYPT also requires auth in API 31+).
        // We model this strictly for D3: if biometric required AND not authenticated,
        // any cipher op fails. Real Android requires auth for both directions on
        // symmetric keys when setUserAuthenticationRequired(true).
        guardBiometric(alias)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ct = cipher.doFinal(plaintext)
        return EncryptResult(iv = cipher.iv.copyOf(), ciphertext = ct)
    }

    override fun decryptAesGcm(alias: String, iv: ByteArray, ciphertext: ByteArray): ByteArray {
        val key = keys[alias]
            ?: throw KeystoreFacadeException("No key for alias=$alias")
        guardBiometric(alias)
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.doFinal(ciphertext)
        } catch (e: Exception) {
            throw KeystoreFacadeException("Decrypt failed for alias=$alias", e)
        }
    }

    /** Throws if [alias] requires biometric and [simulateBiometricAuthenticated] is false. */
    private fun guardBiometric(alias: String) {
        if (alias in biometricRequiredAliases && !simulateBiometricAuthenticated) {
            throw KeystoreFacadeException(
                "Alias $alias requires user authentication (BiometricPrompt) — simulated denial"
            )
        }
    }

    override fun isHardwareBackedFor(alias: String): Boolean = hardwareBacked

    override fun isStrongBoxBackedFor(alias: String): Boolean = strongBoxSupported

    override fun deleteAlias(alias: String) {
        keys.remove(alias)
        biometricRequiredAliases.remove(alias)
    }

    /** True iff [alias] was created with requireUserAuthentication=true. */
    fun requiresBiometric(alias: String): Boolean = alias in biometricRequiredAliases

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
