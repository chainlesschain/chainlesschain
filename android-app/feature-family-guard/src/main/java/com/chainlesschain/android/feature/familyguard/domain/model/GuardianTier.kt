package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * Guardian / parent tier (FAMILY-11).
 *
 * 主文档 §3.1 v0.2 多家长冲突解决:
 *   - PRIMARY: 法定监护人, 1-2 人; 可设规则 / 解绑 / 编辑围栏
 *   - SECONDARY: 其他亲属 (爷爷奶奶 etc.); 可看 telemetry / 接 SOS / 派任务,
 *     但不能解绑 + 改规则需 PRIMARY 确认; 只能"退出监护"自己离开
 *
 * 对 [MemberRole.CHILD] 必须为 null (孩子无 tier 概念)。校验在
 * [FamilyMembershipRepositoryImpl] 中确保。
 */
enum class GuardianTier(val storageValue: String) {
    PRIMARY("primary"),
    SECONDARY("secondary"),
    ;

    companion object {
        fun fromStorage(value: String?): GuardianTier? =
            value?.let { v -> entries.firstOrNull { it.storageValue == v } }
    }
}
