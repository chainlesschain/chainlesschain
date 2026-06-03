package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * family_membership.role 枚举 (FAMILY-11).
 *
 * 主文档 §3.1 v0.2: parent / child / guardian. 区别于本机 [AppRole]:
 *   - [AppRole] 描述本机 (这台设备) 用户扮演的"端"概念 (家长端 vs 孩子端)
 *   - [MemberRole] 描述某个 family_group 内的成员关系
 * 一个 [AppRole.PARENT] 可在多个 family_group 里同时担任 PARENT 或 secondary
 * GUARDIAN; 主文档 §3.1 v0.2 多家长冲突解决里 PARENT (primary) 与 GUARDIAN
 * (secondary) 的差异由 [GuardianTier] 表达。
 */
enum class MemberRole(val storageValue: String) {
    PARENT("parent"),
    CHILD("child"),
    GUARDIAN("guardian"),
    ;

    companion object {
        fun fromStorage(value: String): MemberRole? =
            entries.firstOrNull { it.storageValue == value }
    }
}
