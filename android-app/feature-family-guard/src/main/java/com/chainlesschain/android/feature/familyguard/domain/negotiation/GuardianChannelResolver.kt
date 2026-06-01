package com.chainlesschain.android.feature.familyguard.domain.negotiation

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import javax.inject.Inject

/**
 * 从 family_membership 解析多家长协商频道参与者 (FAMILY-62)。
 *
 * **纯函数**：筛 active 成员中 role ∈ {PARENT, GUARDIAN}（**排除 CHILD** —— "不开放给 child"），
 * 按 member_did 去重（一个 guardian 多设备只算一次），保持首次出现顺序。channelId 稳定派生
 * （[GuardianChannel.channelIdFor]）。单测可直接喂 membership 列表断言。
 */
class GuardianChannelResolver @Inject constructor() {

    fun resolve(familyGroupId: String, memberships: List<FamilyMembershipEntity>): GuardianChannel {
        val guardianDids = memberships.asSequence()
            .filter { it.familyGroupId == familyGroupId }
            .filter { it.status == STATUS_ACTIVE }
            .filter { MemberRole.fromStorage(it.role).isGuardian() }
            .map { it.memberDid }
            .filter { it.isNotBlank() }
            .distinct()
            .toList()
        return GuardianChannel(
            channelId = GuardianChannel.channelIdFor(familyGroupId),
            familyGroupId = familyGroupId,
            guardianDids = guardianDids,
        )
    }

    private fun MemberRole?.isGuardian(): Boolean =
        this == MemberRole.PARENT || this == MemberRole.GUARDIAN

    private companion object {
        const val STATUS_ACTIVE = "active"
    }
}
