package com.chainlesschain.android.wear.sync

import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * v1.2 #20 P0.2 Wear Phase 1 — WearApprovalStore upsert/remove/clear 行为测。
 */
class WearApprovalStoreTest {

    @After
    fun reset() {
        WearApprovalStore.clear()
    }

    private fun mkReq(id: String, amount: Long? = null) = ApprovalRequest(
        id = id,
        kind = "multisig.purchase",
        title = "t",
        summary = "s",
        amountFen = amount,
        createdAtMs = 1,
    )

    @Test
    fun `initial state is empty`() {
        assertEquals(0, WearApprovalStore.pendingCount())
        assertTrue(WearApprovalStore.requests.value.isEmpty())
    }

    @Test
    fun `upsert appends new request`() {
        WearApprovalStore.upsert(mkReq("a"))
        assertEquals(1, WearApprovalStore.pendingCount())
    }

    @Test
    fun `upsert replaces existing by id`() {
        WearApprovalStore.upsert(mkReq("a", amount = 100))
        WearApprovalStore.upsert(mkReq("a", amount = 200))
        assertEquals(1, WearApprovalStore.pendingCount())
        assertEquals(200L, WearApprovalStore.requests.value[0].amountFen)
    }

    @Test
    fun `upsert two different ids keeps both`() {
        WearApprovalStore.upsert(mkReq("a"))
        WearApprovalStore.upsert(mkReq("b"))
        assertEquals(2, WearApprovalStore.pendingCount())
        assertEquals(setOf("a", "b"), WearApprovalStore.requests.value.map { it.id }.toSet())
    }

    @Test
    fun `remove drops the matching id`() {
        WearApprovalStore.upsert(mkReq("a"))
        WearApprovalStore.upsert(mkReq("b"))
        WearApprovalStore.remove("a")
        assertEquals(1, WearApprovalStore.pendingCount())
        assertEquals("b", WearApprovalStore.requests.value[0].id)
    }

    @Test
    fun `remove with unknown id is noop`() {
        WearApprovalStore.upsert(mkReq("a"))
        WearApprovalStore.remove("nope")
        assertEquals(1, WearApprovalStore.pendingCount())
    }

    @Test
    fun `clear empties the store`() {
        WearApprovalStore.upsert(mkReq("a"))
        WearApprovalStore.upsert(mkReq("b"))
        WearApprovalStore.clear()
        assertEquals(0, WearApprovalStore.pendingCount())
    }
}
