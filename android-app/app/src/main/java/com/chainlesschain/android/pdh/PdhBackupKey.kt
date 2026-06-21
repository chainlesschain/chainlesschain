package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import java.security.MessageDigest

/**
 * §8.3 / §7.3 备份密钥的 DID 派生与置备 —— module 101 Phase 7.
 *
 * 备份块用"你持钥的"AES-256-GCM 加密,密钥**绑个人 DID**(§7.3 已把 DID 提前到
 * Phase 0/1):由 DID 确定性派生一个 Keystore alias,密钥本体存 StrongBox/TEE(硬件级,
 * 静默降级),**换机凭同一 DID 派生同 alias** → 解密恢复出"属于这个人"的资产。我们/任何
 * 平台都拿不到密钥。
 *
 * 这是把 §8.3 加密信封([PdhBackupEnvelope.keystoreCipher] 需要一个 alias)接到真实
 * Keystore 的最后一环:[aliasFor] 纯派生、[ensureKey] 置备(缺则生成、返回实际落地 tier)、
 * [cipherFor] 产出可直接喂编排的加密器。DID 来自 core-did,密钥后端是 [KeystoreFacade]
 * seam(测试注入 fake)。纯派生 + 置备编排**可单测**。
 */
object PdhBackupKey {

    const val ALIAS_PREFIX = "pdh-backup-"

    /** 备份 AES 密钥默认请求最高硬件级(StrongBox-wrapped),无硬件时静默降级。 */
    val DEFAULT_TIER: KeyTier = KeyTier.WRAPPER_STRONGBOX

    /**
     * 由 DID 确定性派生备份密钥 alias(SHA-256(did) 前 16 字节十六进制)。
     * 同一 DID → 同 alias(换机用同 DID 认领解密);不同 DID → 不同 alias。
     */
    fun aliasFor(did: String): String {
        require(did.isNotBlank()) { "did required for backup key alias" }
        val hex = MessageDigest.getInstance("SHA-256")
            .digest(did.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return ALIAS_PREFIX + hex.take(32)
    }

    /**
     * 确保该 DID 的备份 AES 密钥已在 Keystore:缺则按 [requestedTier] 生成(实现会在
     * 无 StrongBox 时静默降级),已存在则不重建。返回**实际落地** tier。
     */
    fun ensureKey(
        facade: KeystoreFacade,
        did: String,
        requestedTier: KeyTier = DEFAULT_TIER,
    ): KeyTier {
        val alias = aliasFor(did)
        if (facade.containsAlias(alias)) return currentTier(facade, alias)
        return facade.generateAesKey(
            alias = alias,
            requestedTier = requestedTier,
            requireUserAuthentication = false, // 备份是后台任务,不绑每次用户认证
            userAuthenticationValiditySeconds = 0,
        )
    }

    /**
     * 该 DID 的备份加密器(须先 [ensureKey])。直接喂 [PdhBackupEnvelope] / [PdhBackupCoordinator]。
     */
    fun cipherFor(facade: KeystoreFacade, did: String): PdhBackupEnvelope.BackupCipher =
        PdhBackupEnvelope.keystoreCipher(facade, aliasFor(did))

    /** 已有 alias 的 tier 上报(AES wrapper 风格:StrongBox > TEE > 软件)。 */
    private fun currentTier(facade: KeystoreFacade, alias: String): KeyTier = when {
        facade.isStrongBoxBackedFor(alias) -> KeyTier.WRAPPER_STRONGBOX
        facade.isHardwareBackedFor(alias) -> KeyTier.WRAPPER_TEE
        else -> KeyTier.SOFTWARE
    }
}
