package com.chainlesschain.android.core.security.strongbox

/**
 * 密钥后端的硬件等级（L1 钥匙层三阶段降级，参见 ADR-2）。
 *
 * Software < TEE < StrongBox（按硬件强度递增）。Native = 私钥本身在 Keystore 中生成且永不出 TEE；
 * Wrapper = Ed25519 私钥仍在用户态（BouncyCastle 生成），但落盘前用 Keystore-backed AES 主密钥加密。
 *
 * 设计文档 v0.2 ADR-2 + minSdk=26 现实约束（Keystore 原生 Ed25519 仅 API 33+ 起）：
 * - API 33+ 新建 DID 走 NativeEd25519 路径（NATIVE_*）
 * - API 26-32 全部 + API 33+ 迁移现有 DID 走 wrapper-AES（WRAPPER_*）
 *
 * UI 显示规则（设计文档 §三阶段密钥后端）：
 *  - StrongBox_*  → 🔒 硬件级
 *  - TEE_*        → 🔐 TEE
 *  - SOFTWARE_*   → 🔓 软件级
 */
enum class KeyTier(
    val displayLabel: String,
    val isHardwareBacked: Boolean,
    val isNative: Boolean,
    val rank: Int,
) {
    NATIVE_STRONGBOX("🔒 硬件级 (StrongBox-native)", true, true, 5),
    NATIVE_TEE("🔐 TEE (native)", true, true, 4),
    WRAPPER_STRONGBOX("🔒 硬件级 (StrongBox-wrapped)", true, false, 3),
    WRAPPER_TEE("🔐 TEE (wrapped)", true, false, 2),
    SOFTWARE("🔓 软件级", false, false, 1);

    fun isAtLeast(other: KeyTier): Boolean = rank >= other.rank

    fun allowsHighRisk(): Boolean = isHardwareBacked

    companion object {
        fun comparator(): Comparator<KeyTier> = compareBy { it.rank }
    }
}

/**
 * 设置 / 探测 / 升级 key alias 时的结果。
 */
data class TierResolution(
    val tier: KeyTier,
    /** 实际请求的硬件级，可能因厂商裁剪而降级 */
    val requestedTier: KeyTier,
    /** 是否绑定了用户认证（biometric / PIN） */
    val userAuthRequired: Boolean,
    /** 该 alias 是否首次创建（false 表示复用已有） */
    val freshlyCreated: Boolean,
)
