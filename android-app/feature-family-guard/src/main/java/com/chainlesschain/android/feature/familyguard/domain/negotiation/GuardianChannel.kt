package com.chainlesschain.android.feature.familyguard.domain.negotiation

/**
 * 多家长协商频道 (FAMILY-62，主文档 §3.1 v0.2)。
 *
 * 复用现有 friend group chat：为一个 family_group 派生一个**仅 guardian** 的群聊频道
 * （PARENT + GUARDIAN，**排除 child**），guardian 间规则冲突自动推到此频道协商。
 *
 * @property channelId 稳定派生 = `"family-negotiation:<familyGroupId>"`，同组始终映射同一频道
 *   （:app 据此复用 / 创建 friend chat group）。
 * @property guardianDids 频道参与者（去重，仅 active guardian）。
 * @property canNegotiate guardian ≥ 2 才有协商意义；单 guardian 无冲突对象，[FamilyNegotiationCoordinator]
 *   据此跳过推送。
 */
data class GuardianChannel(
    val channelId: String,
    val familyGroupId: String,
    val guardianDids: List<String>,
) {
    val canNegotiate: Boolean get() = guardianDids.size >= 2

    companion object {
        const val CHANNEL_ID_PREFIX = "family-negotiation:"

        fun channelIdFor(familyGroupId: String): String = "$CHANNEL_ID_PREFIX$familyGroupId"
    }
}
