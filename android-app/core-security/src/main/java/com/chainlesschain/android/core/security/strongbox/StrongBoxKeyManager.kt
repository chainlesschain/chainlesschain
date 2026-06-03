package com.chainlesschain.android.core.security.strongbox

import android.os.Build
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * L1 钥匙层主入口：负责密钥后端等级探测、AES wrapper key 管理、Ed25519 私钥的
 * 加密落盘 / 解密恢复。
 *
 * **双码路（设计文档 ADR-2 + B 选项）**：
 *  - API 33+ 走 native Ed25519（Keystore 直接生成 Ed25519，私钥永不出 TEE）—— 暂存桩，
 *    待 [signWithNativeEd25519] 实测后落地，预留接口防止 D2 强耦合。
 *  - 全 API 26+（含 33+ 迁移旧明文 DID 的情况）走 wrapper-AES：Ed25519 仍由 BouncyCastle
 *    生成，但 32-byte 私钥落盘前用 Keystore-backed AES-256-GCM 主密钥加密。
 *
 * Tier 显示规则与降级策略见 [KeyTier]。
 *
 * @property keystore 真实/mock 的 Keystore 抽象，参见 [KeystoreFacade]
 * @property sdkInt 注入 Android SDK 版本以便 JVM 单测设定 API 边界（生产默认 [Build.VERSION.SDK_INT]）
 */
@Singleton
class StrongBoxKeyManager @Inject constructor(
    private val keystore: KeystoreFacade,
    private val sdkInt: Int = Build.VERSION.SDK_INT,
) {

    /**
     * 探测**新建** key 在该设备上能拿到的最高 tier，不实际创建任何 key。
     *
     * 调用顺序：
     *  1. API 33+ 且 StrongBox 可用 → NATIVE_STRONGBOX
     *  2. API 33+ 且仅 TEE 可用 → NATIVE_TEE
     *  3. API 28+ 且 StrongBox 可用 → WRAPPER_STRONGBOX
     *  4. API 23+ Keystore 可用 → WRAPPER_TEE
     *  5. 否则 → SOFTWARE
     *
     * 注意：步骤 3/4 也是 API 33+ 设备的 wrapper 降级路径（如迁移现有明文 DID 时）。
     */
    fun detectMaxTier(): KeyTier {
        val strongBox = keystore.isStrongBoxSupported()
        return when {
            sdkInt >= API_33_NATIVE_ED25519 && strongBox -> KeyTier.NATIVE_STRONGBOX
            sdkInt >= API_33_NATIVE_ED25519 -> KeyTier.NATIVE_TEE
            sdkInt >= API_28_STRONGBOX && strongBox -> KeyTier.WRAPPER_STRONGBOX
            sdkInt >= API_23_KEYSTORE_AES -> KeyTier.WRAPPER_TEE
            else -> KeyTier.SOFTWARE
        }
    }

    /**
     * 设置（生成或复用）一个 wrapper AES 主密钥 alias。返回**实际**落地的 tier。
     *
     * 已存在的 alias 直接返回 [TierResolution.freshlyCreated]=false，不重新生成。
     *
     * @param alias 主密钥别名，建议格式 `did_wrap_<did>` 或 `cc_wrap_default`
     * @param requireBiometric 是否绑定 BiometricPrompt / PIN 解锁（用于 L1 高风险操作）
     * @param userAuthValiditySec 解锁后有效期（秒），仅 requireBiometric=true 时生效
     */
    fun setupWrapperKey(
        alias: String,
        requireBiometric: Boolean = false,
        userAuthValiditySec: Int = DEFAULT_AUTH_VALIDITY_SEC,
    ): TierResolution {
        require(alias.isNotBlank()) { "alias must not be blank" }

        val existed = keystore.containsAlias(alias)
        val requestedTier = pickRequestedWrapperTier()
        val actualTier = keystore.generateAesKey(
            alias = alias,
            requestedTier = requestedTier,
            requireUserAuthentication = requireBiometric,
            userAuthenticationValiditySeconds = userAuthValiditySec,
        )

        if (!existed) {
            Timber.i(
                "Wrapper key created: alias=%s requested=%s actual=%s biometric=%s",
                alias, requestedTier, actualTier, requireBiometric,
            )
        }

        return TierResolution(
            tier = actualTier,
            requestedTier = requestedTier,
            userAuthRequired = requireBiometric,
            freshlyCreated = !existed,
        )
    }

    /**
     * 用 [alias] 对应的 wrapper AES 主密钥加密 32-byte Ed25519 私钥。
     *
     * 如 alias 不存在，会自动调用 [setupWrapperKey]（不需 biometric）建好再加密。
     *
     * @throws IllegalArgumentException 如 [ed25519Private] 不是 32 字节
     */
    fun wrapEd25519Private(alias: String, ed25519Private: ByteArray): WrappedEd25519Key {
        require(ed25519Private.size == WrappedEd25519Key.ED25519_PRIVATE_KEY_SIZE) {
            "Ed25519 private key must be ${WrappedEd25519Key.ED25519_PRIVATE_KEY_SIZE} bytes, " +
                "got ${ed25519Private.size}"
        }
        if (!keystore.containsAlias(alias)) {
            setupWrapperKey(alias, requireBiometric = false)
        }
        val encrypted = keystore.encryptAesGcm(alias, ed25519Private)
        return WrappedEd25519Key(
            version = WrappedEd25519Key.CURRENT_VERSION,
            keystoreAlias = alias,
            iv = encrypted.iv,
            ciphertext = encrypted.ciphertext,
        )
    }

    /**
     * 用 [wrapped] 中记录的 alias 还原 Ed25519 私钥。
     *
     * 失败原因（任一会抛 [KeystoreFacadeException]）：
     *  - alias 在 Keystore 中已被删除
     *  - ciphertext 被篡改（GCM tag mismatch）
     *  - 用户认证未在有效期内（仅 biometric 绑定的 key）
     */
    fun unwrapEd25519Private(wrapped: WrappedEd25519Key): ByteArray {
        if (!keystore.containsAlias(wrapped.keystoreAlias)) {
            throw KeystoreFacadeException(
                "Alias ${wrapped.keystoreAlias} not found in Keystore (likely rotated or wiped)"
            )
        }
        val plaintext = keystore.decryptAesGcm(
            alias = wrapped.keystoreAlias,
            iv = wrapped.iv,
            ciphertext = wrapped.ciphertext,
        )
        if (plaintext.size != WrappedEd25519Key.ED25519_PRIVATE_KEY_SIZE) {
            throw KeystoreFacadeException(
                "Decrypted Ed25519 size mismatch: ${plaintext.size}"
            )
        }
        return plaintext
    }

    /** 该设备是否支持 native Ed25519（API 33+）。 */
    fun isNativeEd25519Available(): Boolean = sdkInt >= API_33_NATIVE_ED25519

    /**
     * native Ed25519 签名占位接口。**v1.0 D1 不实现**——native 路径的 KeyGenParameterSpec
     * 在 minSdk=26 项目里需要 `@RequiresApi(33)` 包装 + 真机验证 API 边界（Android 13
     * 的 Ed25519 in Keystore 用 NamedParameterSpec("Ed25519") 还是 KEY_ALGORITHM_EC
     * + Curve25519 在不同厂商上行为差异需实测）。
     *
     * 调用此方法会抛 [UnsupportedOperationException]，提醒上层走 wrapper-AES 路径。
     *
     * 计划在 v1.0 M2 D2/D3 期间补完（DIDWallet 落地后做真机集成测试）。
     */
    fun signWithNativeEd25519(@Suppress("UNUSED_PARAMETER") alias: String, @Suppress("UNUSED_PARAMETER") message: ByteArray): ByteArray {
        if (!isNativeEd25519Available()) {
            throw UnsupportedOperationException(
                "Native Ed25519 requires API 33+ (current=$sdkInt). Use wrapper-AES path."
            )
        }
        throw UnsupportedOperationException(
            "Native Ed25519 path is not yet implemented (D1 stub). " +
                "Use wrapEd25519Private/unwrapEd25519Private + BouncyCastle signing for now."
        )
    }

    /**
     * 删除 alias，包括 Keystore 中的 wrapper key。所有用此 alias wrap 的密文将永久无法解。
     *
     * 用于 DID 撤销 / 设备 reset / 测试清理。
     */
    fun deleteAlias(alias: String) {
        keystore.deleteAlias(alias)
    }

    private fun pickRequestedWrapperTier(): KeyTier {
        return when {
            sdkInt >= API_28_STRONGBOX && keystore.isStrongBoxSupported() ->
                KeyTier.WRAPPER_STRONGBOX
            sdkInt >= API_23_KEYSTORE_AES -> KeyTier.WRAPPER_TEE
            else -> KeyTier.SOFTWARE
        }
    }

    companion object {
        const val API_23_KEYSTORE_AES = 23
        const val API_28_STRONGBOX = 28
        const val API_33_NATIVE_ED25519 = 33
        const val DEFAULT_AUTH_VALIDITY_SEC = 300
    }
}
