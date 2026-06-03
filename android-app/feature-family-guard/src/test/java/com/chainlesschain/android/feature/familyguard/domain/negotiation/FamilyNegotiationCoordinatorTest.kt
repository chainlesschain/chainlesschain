package com.chainlesschain.android.feature.familyguard.domain.negotiation

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-62 验收: FamilyNegotiationCoordinator — 多 guardian 推协商频道 / 单 guardian 跳过。
 */
class FamilyNegotiationCoordinatorTest {

    private val grp = "grp1"

    private fun member(did: String, role: String) = FamilyMembershipEntity(
        familyGroupId = grp,
        memberDid = did,
        role = role,
        deviceId = "d-$did",
        joinedAt = 1_000L,
    )

    private val conflict = RuleConflict(
        familyGroupId = grp,
        type = RuleConflictType.APP_TIME_LIMIT,
        subject = "com.game",
        proposals = listOf(GuardianProposal("did:A", "3600s/天"), GuardianProposal("did:B", "1800s/天")),
        effectiveValue = "1800s/天 (取最严)",
    )

    private class RecordingNotifier : GroupChatNotifier {
        var calls = 0
        var lastChannel: GuardianChannel? = null
        var lastConflict: RuleConflict? = null
        override suspend fun postRuleConflict(channel: GuardianChannel, conflict: RuleConflict) {
            calls++
            lastChannel = channel
            lastConflict = conflict
        }
    }

    @Test
    fun `routes to channel when two guardians`() = runTest {
        val notifier = RecordingNotifier()
        val coord = FamilyNegotiationCoordinator(GuardianChannelResolver(), notifier)
        val members = listOf(member("did:A", "parent"), member("did:B", "guardian"), member("did:C", "child"))
        val outcome = coord.routeConflict(members, conflict)
        assertTrue(outcome is NegotiationOutcome.Posted)
        assertEquals("family-negotiation:grp1", (outcome as NegotiationOutcome.Posted).channelId)
        assertEquals(2, outcome.guardianCount)
        assertEquals(1, notifier.calls)
        assertEquals(conflict, notifier.lastConflict)
        // 频道不含 child
        assertEquals(listOf("did:A", "did:B"), notifier.lastChannel?.guardianDids)
    }

    @Test
    fun `skips when single guardian`() = runTest {
        val notifier = RecordingNotifier()
        val coord = FamilyNegotiationCoordinator(GuardianChannelResolver(), notifier)
        val members = listOf(member("did:A", "parent"), member("did:C", "child"))
        val outcome = coord.routeConflict(members, conflict)
        assertEquals(NegotiationOutcome.SingleGuardian, outcome)
        assertEquals(0, notifier.calls)
    }
}
