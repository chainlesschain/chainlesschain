package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Test

/** M9 积分流水 P2P 合并核 ([PointsLedgerMerge]): 按 id 并集, 收敛性三性质。 */
class PointsLedgerMergeTest {

    private fun ev(id: String, amount: Int = 30, ts: Long = 1_000L) = PointsEvent(
        id = id,
        childDid = "did:chain:child",
        type = PointsEventType.EARN,
        amount = amount,
        reason = "r",
        timestamp = ts,
    )

    @Test
    fun `merge unions by id and sorts by timestamp`() {
        val a = listOf(ev("e1", ts = 1_000L), ev("e2", ts = 3_000L))
        val b = listOf(ev("e2", ts = 3_000L), ev("e3", ts = 2_000L))

        val merged = PointsLedgerMerge.merge(a, b)
        assertEquals(listOf("e1", "e3", "e2"), merged.map { it.id })
    }

    @Test
    fun `merge is commutative associative and idempotent`() {
        val a = listOf(ev("e1"), ev("e2", ts = 2_000L))
        val b = listOf(ev("e2", ts = 2_000L), ev("e3", ts = 3_000L))
        val c = listOf(ev("e4", ts = 500L))

        assertEquals(PointsLedgerMerge.merge(a, b), PointsLedgerMerge.merge(b, a))
        assertEquals(
            PointsLedgerMerge.merge(PointsLedgerMerge.merge(a, b), c),
            PointsLedgerMerge.merge(a, PointsLedgerMerge.merge(b, c)),
        )
        assertEquals(PointsLedgerMerge.merge(a, a), PointsLedgerMerge.merge(a, emptyList()))
    }

    @Test
    fun `conflicting payload for the same id picks one side deterministically`() {
        val a = listOf(ev("e1", amount = 30, ts = 1_000L))
        val b = listOf(ev("e1", amount = 99, ts = 1_000L)) // 契约外冲突

        val ab = PointsLedgerMerge.merge(a, b).single()
        val ba = PointsLedgerMerge.merge(b, a).single()
        assertEquals(ab, ba)
        assertEquals(30, ab.amount) // compareBy amount → 确定性取小
    }

    @Test
    fun `same-id conflict differing only in an omitted identity field still converges`() {
        // Regression: before the comparator was made total it compared only
        // (timestamp, amount, reason, type). Two same-id events that tie on all
        // four but differ in relatedTaskId tied → minWithOrNull returned the
        // iteration-first element → merge(a,b) != merge(b,a) (P2P diverges).
        val base = ev("e1", amount = 30, ts = 1_000L)
        val a = listOf(base.copy(relatedTaskId = "tA"))
        val b = listOf(base.copy(relatedTaskId = "tB"))

        val ab = PointsLedgerMerge.merge(a, b).single()
        val ba = PointsLedgerMerge.merge(b, a).single()
        assertEquals(ab, ba) // must converge regardless of merge order
        assertEquals("tA", ab.relatedTaskId) // deterministic: "tA" < "tB"
    }
}
