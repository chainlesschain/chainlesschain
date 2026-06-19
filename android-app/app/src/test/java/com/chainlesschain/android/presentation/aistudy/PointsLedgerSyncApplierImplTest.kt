package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PointsLedgerSyncApplierImplTest {

    private val ledger = InMemoryPointsLedger()
    private val relRepo = mockk<FamilyRelationshipRepository>(relaxed = true)
    private val applier = PointsLedgerSyncApplierImpl(ledger, relRepo)

    private val parentDid = "did:key:parent"
    private val childDid = "did:key:child"

    private fun activeRel(friendDid: String, roleOther: String) = FamilyRelationshipEntity(
        id = 1L, familyGroupId = "fg", friendDid = friendDid,
        roleSelf = "parent", roleOther = roleOther, boundAt = 1L,
        permissions = "{}", status = "active", createdAt = 1L, updatedAt = 1L,
    )

    private fun earn(id: String = "pe-1") = PointsEvent(
        id = id, childDid = childDid, type = PointsEventType.EARN,
        amount = 30, reason = "作业满分", relatedTaskId = "t-1", timestamp = 1L,
    )

    private fun grant(granter: String? = parentDid) = PointsEvent(
        id = "pe-g", childDid = childDid, type = PointsEventType.GRANT,
        amount = 100, reason = "奖励", granterDid = granter, timestamp = 2L,
    )

    @Test
    fun `parent-side earn from family child is appended`() = runTest {
        coEvery { relRepo.findByFriendDid(childDid) } returns activeRel(childDid, "child")

        applier.savePointsEventFromSync("points_event|pe-1", PointsEventSyncData.encode(earn()))

        assertEquals(1, ledger.events.value.size)
        assertEquals("pe-1", ledger.events.value.first().id)
    }

    @Test
    fun `event from non-family is rejected`() = runTest {
        coEvery { relRepo.findByFriendDid(any()) } returns null

        applier.savePointsEventFromSync("points_event|pe-1", PointsEventSyncData.encode(earn()))

        assertTrue(ledger.events.value.isEmpty())
    }

    @Test
    fun `grant from parent-role guardian is appended`() = runTest {
        // 孩子端收家长 grant：childDid=自己(非好友)，granterDid=家长(活跃 parent 好友)。
        coEvery { relRepo.findByFriendDid(childDid) } returns null
        coEvery { relRepo.findByFriendDid(parentDid) } returns activeRel(parentDid, "parent")

        applier.savePointsEventFromSync("points_event|pe-g", PointsEventSyncData.encode(grant()))

        assertEquals(1, ledger.events.value.size)
        assertEquals(PointsEventType.GRANT, ledger.events.value.first().type)
    }

    @Test
    fun `grant whose granter is only a child-role friend is rejected (forgery defense)`() = runTest {
        coEvery { relRepo.findByFriendDid(childDid) } returns null
        // granter 是已连好友但 role=child → 不允许发放积分。
        coEvery { relRepo.findByFriendDid(parentDid) } returns activeRel(parentDid, "child")

        applier.savePointsEventFromSync("points_event|pe-g", PointsEventSyncData.encode(grant()))

        assertTrue(ledger.events.value.isEmpty())
    }

    @Test
    fun `unknown event type is dropped not appended`() = runTest {
        coEvery { relRepo.findByFriendDid(any()) } returns activeRel(childDid, "child")
        val bad = PointsEventSyncData.encode(earn()).replace("EARN", "FUTURE_TYPE")

        applier.savePointsEventFromSync("points_event|pe-1", bad)

        assertTrue(ledger.events.value.isEmpty())
    }

    @Test
    fun `duplicate id is idempotent (append-only dedup)`() = runTest {
        coEvery { relRepo.findByFriendDid(childDid) } returns activeRel(childDid, "child")
        val json = PointsEventSyncData.encode(earn())

        applier.savePointsEventFromSync("points_event|pe-1", json)
        applier.savePointsEventFromSync("points_event|pe-1", json)

        assertEquals(1, ledger.events.value.size)
    }
}
