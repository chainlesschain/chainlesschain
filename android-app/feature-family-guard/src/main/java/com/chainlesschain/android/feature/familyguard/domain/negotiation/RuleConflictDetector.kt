package com.chainlesschain.android.feature.familyguard.domain.negotiation

import com.chainlesschain.android.feature.familyguard.domain.merger.AppBlocklistConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.AppTimeLimitConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.PaymentCapConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.RuleMerger

/**
 * 检测多家长提交的规则是否分歧 (FAMILY-62)。**纯函数**，复用 [RuleMerger] 算"取严"后的实际
 * 生效值——分歧 = 各 guardian 提议值不一致；无分歧返 null（不打扰协商频道）。
 *
 * 与 [RuleMerger] 的分工：RuleMerger 只管"合并出生效值"（永远取最严，FAMILY-17）；本检测器
 * 判"是否有分歧需要 guardian 协商"，并把每个 guardian 的原始提议 + 生效值打成 [RuleConflict]
 * 推往 [GuardianChannel]（FAMILY-62）。
 *
 * 每个 builder 入参 = (guardianDid → 该 guardian 提交的 config)，需 ≥ 2 个提议才可能成冲突。
 */
object RuleConflictDetector {

    /** app 时长上限分歧（v0.1 比 daily_max_sec）。同 packageName。 */
    fun appTimeLimit(
        familyGroupId: String,
        packageName: String,
        proposals: List<Pair<String, AppTimeLimitConfig>>,
    ): RuleConflict? {
        if (proposals.size < 2) return null
        val distinctSecs = proposals.map { it.second.dailyMaxSec }.distinct()
        if (distinctSecs.size < 2) return null // 全一致 → 无冲突
        val effective = RuleMerger.mergeAppTimeLimit(proposals.map { it.second }) ?: return null
        return RuleConflict(
            familyGroupId = familyGroupId,
            type = RuleConflictType.APP_TIME_LIMIT,
            subject = packageName,
            proposals = proposals.map { (did, cfg) -> GuardianProposal(did, "${cfg.dailyMaxSec}s/天") },
            effectiveValue = "${effective.dailyMaxSec}s/天 (取最严)",
        )
    }

    /** 支付上限分歧（v0.1 比 per_day）。 */
    fun paymentCap(
        familyGroupId: String,
        proposals: List<Pair<String, PaymentCapConfig>>,
    ): RuleConflict? {
        if (proposals.size < 2) return null
        val distinctPerDay = proposals.map { it.second.perDay }.distinct()
        if (distinctPerDay.size < 2) return null
        val effective = RuleMerger.mergePaymentCap(proposals.map { it.second }) ?: return null
        return RuleConflict(
            familyGroupId = familyGroupId,
            type = RuleConflictType.PAYMENT_CAP,
            subject = "payment_cap",
            proposals = proposals.map { (did, cfg) -> GuardianProposal(did, "¥${cfg.perDay}/天") },
            effectiveValue = "¥${effective.perDay}/天 (取最严)",
        )
    }

    /** 拉黑名单分歧（各 guardian 的 package 集合不一致）。 */
    fun appBlocklist(
        familyGroupId: String,
        proposals: List<Pair<String, AppBlocklistConfig>>,
    ): RuleConflict? {
        if (proposals.size < 2) return null
        val distinctSets = proposals.map { it.second.packages.toSet() }.distinct()
        if (distinctSets.size < 2) return null
        val effective = RuleMerger.mergeAppBlocklist(proposals.map { it.second })
        return RuleConflict(
            familyGroupId = familyGroupId,
            type = RuleConflictType.APP_BLOCKLIST,
            subject = "app_blocklist",
            proposals = proposals.map { (did, cfg) -> GuardianProposal(did, cfg.packages.joinToString(",")) },
            effectiveValue = "${effective.packages.joinToString(",")} (并集)",
        )
    }
}
