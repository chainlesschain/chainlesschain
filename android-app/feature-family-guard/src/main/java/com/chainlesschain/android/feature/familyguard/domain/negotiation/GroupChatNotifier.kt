package com.chainlesschain.android.feature.familyguard.domain.negotiation

/**
 * 多家长协商频道推送 seam (FAMILY-62; 真实 friend group chat 由 :app 复用现有聊天子系统覆盖)。
 *
 * guardian 间规则冲突 → [FamilyNegotiationCoordinator] 经本 seam 把 [RuleConflict] 推到
 * [GuardianChannel]（仅 guardian 可见）。默认实装 [com.chainlesschain.android.feature.familyguard
 * .data.negotiation.NoOpGroupChatNotifier] 仅记日志；:app 接 friend chat group 覆盖（同
 * SosNotifier / EmergencyContactNotifier 的 NoOp 默认 + :app 覆盖模式）。
 */
interface GroupChatNotifier {

    /** 向协商频道推送一条规则冲突，供 [channel] 内 guardian 协商。 */
    suspend fun postRuleConflict(channel: GuardianChannel, conflict: RuleConflict)
}
