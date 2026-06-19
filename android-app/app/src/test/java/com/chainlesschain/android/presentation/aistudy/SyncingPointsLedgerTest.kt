package com.chainlesschain.android.presentation.aistudy

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SyncingPointsLedgerTest {

    private class RecordingOutbox : PointsLedgerOutbox {
        val enqueued = mutableListOf<PointsEvent>()
        override suspend fun enqueue(event: PointsEvent) {
            enqueued += event
        }
    }

    private val delegate = InMemoryPointsLedger()
    private val outbox = RecordingOutbox()
    private val ledger = SyncingPointsLedger(delegate, outbox)

    private fun earn(id: String = "pe-1") = PointsEvent(
        id = id, childDid = "did:child", type = PointsEventType.EARN,
        amount = 20, reason = "作业", timestamp = 1L,
    )

    @Test
    fun `append writes through to delegate AND enqueues for sync`() = runTest {
        ledger.append(earn())

        // 落底层真持久
        assertEquals(1, delegate.events.value.size)
        assertEquals("pe-1", delegate.events.value.first().id)
        // 同时排上行
        assertEquals(1, outbox.enqueued.size)
        assertEquals("pe-1", outbox.enqueued.first().id)
    }

    @Test
    fun `read paths delegate to underlying ledger`() = runTest {
        ledger.append(earn())
        // earnedBetween 经底层聚合
        assertEquals(20, ledger.earnedBetween("did:child", 0L, 100L))
        assertEquals(1, delegate.events.value.size)
    }
}
