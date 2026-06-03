package com.chainlesschain.android.feature.familyguard.domain.negotiation

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/** [FamilyNegotiationCoordinator.routeConflict] 的结果。 */
sealed interface NegotiationOutcome {
    /** 已推送到协商频道; [channelId] + 参与者数。 */
    data class Posted(val channelId: String, val guardianCount: Int) : NegotiationOutcome

    /** 仅 1 个 guardian，无协商对象，跳过。 */
    data object SingleGuardian : NegotiationOutcome
}

/**
 * 多家长协商频道协调器 (FAMILY-62, 主文档 §3.1 v0.2)。
 *
 * 把 [GuardianChannelResolver]（频道参与者）+ [RuleConflictDetector]（是否分歧）+
 * [GroupChatNotifier]（推送 seam）串起来：guardian 间规则冲突 → 自动推到仅 guardian 可见的
 * 协商频道。**纯逻辑 seam**——不直接依赖聊天子系统（friend group chat 在 :app），仅依赖已绑定的
 * resolver + notifier，可在 :feature-family-guard 内单测（同 FAMILY-43/45 模式）。
 *
 * :app 负责 (a) 据 [GuardianChannel.channelId] 复用 / 创建 friend chat group；(b) 把 FAMILY-17
 * RuleMerger 合并时检出的分歧（用 [RuleConflictDetector]）喂给 [routeConflict]。
 */
@Singleton
class FamilyNegotiationCoordinator @Inject constructor(
    private val resolver: GuardianChannelResolver,
    private val notifier: GroupChatNotifier,
) {

    suspend fun routeConflict(
        memberships: List<FamilyMembershipEntity>,
        conflict: RuleConflict,
    ): NegotiationOutcome {
        val channel = resolver.resolve(conflict.familyGroupId, memberships)
        if (!channel.canNegotiate) {
            Timber.d("Negotiation skipped (single guardian) group=%s", conflict.familyGroupId)
            return NegotiationOutcome.SingleGuardian
        }
        notifier.postRuleConflict(channel, conflict)
        return NegotiationOutcome.Posted(channel.channelId, channel.guardianDids.size)
    }
}
