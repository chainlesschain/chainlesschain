package com.chainlesschain.android.core.did.wallet

import kotlinx.serialization.Serializable

/**
 * `did_wallet.json` 落盘格式（v1）。
 *
 * 设计要点：
 *  - 多 DID：[identities] 数组，[activeDid] 指向当前生效那个
 *  - 私钥不明文：每个 entry 用 [WrappedPrivateKeyStorage] 形式存（StrongBoxKeyManager wrap 后的密文）
 *  - 助记词不持久化：仅 [WalletIdentityEntry.mnemonicVerified] 标记用户已确认备份
 *  - 版本字段为未来格式演进预留
 *
 * 迁移：旧的 `did_keypair.json`（明文）在 [DIDManager.initialize] 启动时检测 → 自动迁移
 * → 写新格式 → 旧文件 rename 为 `did_keypair.json.migrated.bak`（保留以备 rollback）。
 */
@Serializable
data class WalletStorage(
    val version: Int = CURRENT_VERSION,
    val activeDid: String,
    val identities: List<WalletIdentityEntry>,
) {
    init {
        require(version == CURRENT_VERSION) {
            "Unsupported WalletStorage version=$version (expected $CURRENT_VERSION)"
        }
        require(activeDid.isNotBlank()) { "activeDid must not be blank" }
        require(identities.any { it.did == activeDid }) {
            "activeDid '$activeDid' not found in identities"
        }
    }

    companion object {
        const val CURRENT_VERSION = 1
        const val FILE_NAME = "did_wallet.json"
        const val LEGACY_FILE_NAME = "did_keypair.json"
        const val LEGACY_BACKUP_SUFFIX = ".migrated.bak"
    }
}

/**
 * 钱包中的单个 DID 条目。
 */
@Serializable
data class WalletIdentityEntry(
    val did: String,
    val deviceName: String,
    val createdAt: Long,
    /** 公钥 hex（32 字节） */
    val publicKeyHex: String,
    /** 加密后的私钥 */
    val wrappedPrivate: WrappedPrivateKeyStorage,
    /** 用户是否已确认抄录助记词（仅适用于由 mnemonic 创建的 DID） */
    val mnemonicVerified: Boolean = false,
    /** 该 DID 是否由 mnemonic 创建（false 表示纯随机生成，无助记词可恢复） */
    val hasMnemonic: Boolean = false,
    /**
     * 是否要求 BiometricPrompt 通过后才能解锁 wrapper key（AES）。
     *
     * true: wrap key 在 Keystore 中以 setUserAuthenticationRequired=true 创建，
     * 解密私钥前必须在 [BiometricAuthenticator.userAuthValiditySec] 窗口内通过认证。
     * UI 层（如 KeyManagementScreen）负责在 sign/switch 前调起 BiometricPrompt。
     *
     * 默认 false：常规 DID 不强制 biometric；建议高风险 DID（marketplace 大额签名 /
     * 设备 delegate 操作的主 DID）打开。
     */
    val requireBiometric: Boolean = false,
)

/**
 * 加密私钥的落盘格式（[WrappedEd25519Key] 的可序列化镜像）。
 *
 * 使用 base64 编码 byte 数组以便 JSON 文本存储。
 */
@Serializable
data class WrappedPrivateKeyStorage(
    val version: Int,
    val keystoreAlias: String,
    val ivBase64: String,
    val ciphertextBase64: String,
)
