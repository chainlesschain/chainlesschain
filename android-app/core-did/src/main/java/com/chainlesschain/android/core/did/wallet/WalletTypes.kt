package com.chainlesschain.android.core.did.wallet

import com.chainlesschain.android.core.did.manager.DIDIdentity

/**
 * [DIDManager.createIdentityWithMnemonic] 的返回值。
 *
 * 重要：[mnemonic] 仅在此次返回中可见，**永不持久化**。调用者（UI 层）必须立刻让
 * 用户抄写下来，并通过 [DIDManager.markMnemonicVerified] 确认备份完成。
 */
data class NewIdentityResult(
    val identity: DIDIdentity,
    val mnemonic: List<String>,
)

/**
 * 钱包列表展示用的简版元数据（不含密钥材料）。
 */
data class DIDIdentityMeta(
    val did: String,
    val deviceName: String,
    val createdAt: Long,
    val isActive: Boolean,
    val mnemonicVerified: Boolean,
    val hasMnemonic: Boolean,
    /**
     * 该 DID 的 wrapper key 是否绑定了 BiometricPrompt。
     * UI 层应据此在 [DIDManager.switchActive] / [DIDManager.sign] 前调起认证。
     */
    val requireBiometric: Boolean,
)
