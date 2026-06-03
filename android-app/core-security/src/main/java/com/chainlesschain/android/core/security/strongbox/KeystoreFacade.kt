package com.chainlesschain.android.core.security.strongbox

/**
 * Android Keystore 系统的抽象层。引入此接口的唯一目的是让 [StrongBoxKeyManager]
 * 可以在 JVM 单测里被 mock，而无需 Robolectric 或真机。
 *
 * 真实实现见 [AndroidKeystoreFacade]，使用 `KeyStore.getInstance("AndroidKeyStore")`。
 */
interface KeystoreFacade {

    /** 该设备是否在 hardware-backed mode 下支持 StrongBox（由 PackageManager 报告）。 */
    fun isStrongBoxSupported(): Boolean

    /** alias 是否已存在于 Keystore。 */
    fun containsAlias(alias: String): Boolean

    /**
     * 生成 AES-256-GCM key 写入 Keystore。返回**实际**落地的 tier
     * （可能因 StrongBox 缺席而从请求的 [requestedTier] 降级）。
     *
     * 实现必须在 StrongBox 不可用时静默降级到 TEE，不抛异常；只有 Keystore 整体崩坏才抛。
     */
    fun generateAesKey(
        alias: String,
        requestedTier: KeyTier,
        requireUserAuthentication: Boolean,
        userAuthenticationValiditySeconds: Int,
    ): KeyTier

    /** 加密一段 plaintext，返回 (ciphertext, iv)。Cipher 在内部初始化。 */
    fun encryptAesGcm(alias: String, plaintext: ByteArray): EncryptResult

    /** 用 alias 对应的 key 解密 ciphertext。失败抛 [KeystoreFacadeException]。 */
    fun decryptAesGcm(alias: String, iv: ByteArray, ciphertext: ByteArray): ByteArray

    /** 该 alias 对应的 key 是否真实由硬件 backing（用于 tier 上报）。 */
    fun isHardwareBackedFor(alias: String): Boolean

    /** 该 alias 对应的 key 是否在 StrongBox 中（用于 tier 上报）。 */
    fun isStrongBoxBackedFor(alias: String): Boolean

    /** 删除一个 alias 的 key（迁移失败回滚 / 测试清理用）。 */
    fun deleteAlias(alias: String)
}

/** [KeystoreFacade.encryptAesGcm] 的返回值。 */
data class EncryptResult(val iv: ByteArray, val ciphertext: ByteArray) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is EncryptResult) return false
        return iv.contentEquals(other.iv) && ciphertext.contentEquals(other.ciphertext)
    }

    override fun hashCode(): Int = 31 * iv.contentHashCode() + ciphertext.contentHashCode()
}

/** Keystore 层抛出的运行时异常（避免业务代码直接接 Java exception 类型）。 */
class KeystoreFacadeException(message: String, cause: Throwable? = null) :
    RuntimeException(message, cause)
