package com.chainlesschain.android.feature.familyguard.domain.negotiation

/** 冲突涉及的规则类型 (FAMILY-62)。 */
enum class RuleConflictType {
    APP_TIME_LIMIT,
    APP_BLOCKLIST,
    PAYMENT_CAP,
}

/** 某 guardian 对一条规则的提议值 (人读展示串)。 */
data class GuardianProposal(
    val guardianDid: String,
    val value: String,
)

/**
 * 一条被检出的多家长规则冲突 (FAMILY-62)。[RuleConflictDetector] 的输出 +
 * [FamilyNegotiationCoordinator] 推往协商频道的载荷。
 *
 * @property subject 冲突主体（如包名 / "payment_cap" / "app_blocklist"）。
 * @property proposals 各 guardian 的提议值（≥2 个不同值才构成冲突）。
 * @property effectiveValue 当前实际生效值（[com.chainlesschain.android.feature.familyguard.domain.merger.RuleMerger]
 *   取严合并的结果）——协商频道里告诉大家"现在按最严的执行，要改请在此商量"。
 */
data class RuleConflict(
    val familyGroupId: String,
    val type: RuleConflictType,
    val subject: String,
    val proposals: List<GuardianProposal>,
    val effectiveValue: String,
)
