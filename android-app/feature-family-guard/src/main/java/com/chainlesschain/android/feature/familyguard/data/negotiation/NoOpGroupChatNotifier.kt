package com.chainlesschain.android.feature.familyguard.data.negotiation

import com.chainlesschain.android.feature.familyguard.domain.negotiation.GroupChatNotifier
import com.chainlesschain.android.feature.familyguard.domain.negotiation.GuardianChannel
import com.chainlesschain.android.feature.familyguard.domain.negotiation.RuleConflict
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [GroupChatNotifier] 默认 no-op (FAMILY-62). 仅记日志; 真实 friend group chat 推送由 :app 层
 * 复用现有聊天子系统覆盖本绑定。
 */
@Singleton
class NoOpGroupChatNotifier @Inject constructor() : GroupChatNotifier {

    override suspend fun postRuleConflict(channel: GuardianChannel, conflict: RuleConflict) {
        Timber.i(
            "Rule conflict to negotiation channel (no-op): channel=%s guardians=%d type=%s subject=%s",
            channel.channelId,
            channel.guardianDids.size,
            conflict.type,
            conflict.subject,
        )
    }
}
