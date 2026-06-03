package com.chainlesschain.android.feature.familyguard.domain.permission

/**
 * Permission check 决策 sealed (FAMILY-14).
 *
 * 3 子类:
 *   - [Allow]: 允许执行 action
 *   - [Deny]: 显式拒, 含 reason (写 audit log + UI 提示用)
 *   - [NotApplicable]: 找不到 active family_relationship; 调用方应走"非家庭"路径
 *     (例如普通好友通话, 不走家庭权限)
 */
sealed interface PermissionDecision {

    data object Allow : PermissionDecision

    data class Deny(val reason: DenyReason) : PermissionDecision

    data object NotApplicable : PermissionDecision

    /**
     * Deny 原因枚举. 主文档 §3.1 v0.2 权限矩阵 / §3.6 TEE 黑盒承诺。
     */
    enum class DenyReason {
        /** allow_xxx=false in permissions JSON. */
        PERMISSION_DISABLED,

        /** telemetry_level 字段不够高 (e.g. 请求 L2 但持有 L1). */
        TELEMETRY_LEVEL_TOO_LOW,

        /** allow_companion_summary=NEVER 时统计也不上报. */
        COMPANION_SUMMARY_NEVER,

        /** ReadCompanionFull: TEE 黑盒, 永远不允许. */
        COMPANION_TEE_BLACK_BOX,

        /** family_relationship.status != 'active' (解绑中 / 紧急解绑 / frozen / etc.) */
        RELATIONSHIP_NOT_ACTIVE,
    }
}
