package com.chainlesschain.android.core.security.strongbox

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 真实的 Android Keystore 实现，调用 `KeyStore.getInstance("AndroidKeyStore")`。
 *
 * 设计选择：
 *  - StrongBox 不可用时**静默**降级到 TEE，不抛异常（业务侧总能拿到 working key）
 *  - 上层（[StrongBoxKeyManager]）负责 tier 判定 + UI 上报
 *  - 失败路径只有 Keystore 整体崩坏（设备出厂签名重置 / SE Linux 拒绝等）
 *
 * 仅在 Android 设备上能正常运行；JVM 单测请走 mock 路径。
 */
@Singleton
class AndroidKeystoreFacade @Inject constructor(
    @ApplicationContext private val context: Context,
) : KeystoreFacade {

    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    override fun isStrongBoxSupported(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        return context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
    }

    override fun containsAlias(alias: String): Boolean = keyStore.containsAlias(alias)

    override fun generateAesKey(
        alias: String,
        requestedTier: KeyTier,
        requireUserAuthentication: Boolean,
        userAuthenticationValiditySeconds: Int,
    ): KeyTier {
        if (keyStore.containsAlias(alias)) {
            return actualTierFor(alias)
        }

        val preferStrongBox = requestedTier == KeyTier.WRAPPER_STRONGBOX ||
            requestedTier == KeyTier.NATIVE_STRONGBOX

        return try {
            buildAndStoreKey(
                alias = alias,
                preferStrongBox = preferStrongBox,
                requireUserAuthentication = requireUserAuthentication,
                userAuthenticationValiditySeconds = userAuthenticationValiditySeconds,
            )
        } catch (e: Exception) {
            if (preferStrongBox && isStrongBoxUnavailable(e)) {
                Timber.w(e, "StrongBox unavailable for alias=$alias, falling back to TEE")
                buildAndStoreKey(
                    alias = alias,
                    preferStrongBox = false,
                    requireUserAuthentication = requireUserAuthentication,
                    userAuthenticationValiditySeconds = userAuthenticationValiditySeconds,
                )
            } else {
                throw e
            }
        }
    }

    /**
     * 按类名匹配 StrongBoxUnavailableException，避免直接 import API 28+ 的类
     * 在 minSdk=26 上引发的 ART 类加载边界问题。
     */
    private fun isStrongBoxUnavailable(t: Throwable): Boolean {
        var cur: Throwable? = t
        while (cur != null) {
            if (cur.javaClass.name == "android.security.keystore.StrongBoxUnavailableException") {
                return true
            }
            cur = cur.cause
        }
        return false
    }

    override fun encryptAesGcm(alias: String, plaintext: ByteArray): EncryptResult {
        val key = keyStore.getKey(alias, null) as? SecretKey
            ?: throw KeystoreFacadeException("No key for alias=$alias")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, key)
        }
        val ciphertext = cipher.doFinal(plaintext)
        return EncryptResult(iv = cipher.iv.copyOf(), ciphertext = ciphertext)
    }

    override fun decryptAesGcm(alias: String, iv: ByteArray, ciphertext: ByteArray): ByteArray {
        val key = keyStore.getKey(alias, null) as? SecretKey
            ?: throw KeystoreFacadeException("No key for alias=$alias")
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            }
            cipher.doFinal(ciphertext)
        } catch (e: Exception) {
            throw KeystoreFacadeException("Decrypt failed for alias=$alias", e)
        }
    }

    override fun isHardwareBackedFor(alias: String): Boolean {
        val info = keyInfoFor(alias) ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            @Suppress("DEPRECATION")
            info.securityLevel != KeyProperties.SECURITY_LEVEL_SOFTWARE
        } else {
            @Suppress("DEPRECATION")
            info.isInsideSecureHardware
        }
    }

    override fun isStrongBoxBackedFor(alias: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        val info = keyInfoFor(alias) ?: return false
        return info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
    }

    override fun deleteAlias(alias: String) {
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    }

    private fun buildAndStoreKey(
        alias: String,
        preferStrongBox: Boolean,
        requireUserAuthentication: Boolean,
        userAuthenticationValiditySeconds: Int,
    ): KeyTier {
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(AES_KEY_BITS)

        if (preferStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(true)
        }
        if (requireUserAuthentication) {
            builder.setUserAuthenticationRequired(true)
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(userAuthenticationValiditySeconds)
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(builder.build())
        generator.generateKey()

        return actualTierFor(alias)
    }

    private fun actualTierFor(alias: String): KeyTier = when {
        isStrongBoxBackedFor(alias) -> KeyTier.WRAPPER_STRONGBOX
        isHardwareBackedFor(alias) -> KeyTier.WRAPPER_TEE
        else -> KeyTier.SOFTWARE
    }

    private fun keyInfoFor(alias: String): KeyInfo? {
        return try {
            val key = keyStore.getKey(alias, null) as? SecretKey ?: return null
            val factory = SecretKeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE)
            factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
        } catch (e: Exception) {
            Timber.w(e, "Failed to read KeyInfo for alias=$alias")
            null
        }
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val AES_KEY_BITS = 256
        private const val GCM_TAG_BITS = 128
    }
}
