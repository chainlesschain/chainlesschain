package com.chainlesschain.android.auto

import app.cash.turbine.test
import com.chainlesschain.android.push.NotificationPayload
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * v1.2 #1 Android Auto Phase 2 — AutoPushBus SharedFlow 行为单测。
 */
class AutoPushBusTest {

    @Test
    fun `incoming payload is emitted as AutoPushEvent_Incoming`() = runTest {
        val bus = AutoPushBus()
        val payload = NotificationPayload.MarketplacePurchaseApproval(
            orderId = "o1",
            total = "999",
        )
        bus.events.test {
            bus.emit(payload)
            val event = awaitItem()
            assertTrue(event is AutoPushEvent.Incoming)
            assertEquals(payload, (event as AutoPushEvent.Incoming).payload)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `userDecision is emitted as AutoPushEvent_Decision`() = runTest {
        val bus = AutoPushBus()
        val payload = NotificationPayload.SystemAlertNotice("t", "b")
        val decision = AutoApprovalDecision(payload, approved = false)
        bus.events.test {
            bus.userDecision(decision)
            val event = awaitItem()
            assertTrue(event is AutoPushEvent.Decision)
            assertEquals(decision, (event as AutoPushEvent.Decision).decision)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `multiple incoming payloads queue in order`() = runTest {
        val bus = AutoPushBus()
        val p1 = NotificationPayload.MarketplacePurchaseApproval("o1", "1")
        val p2 = NotificationPayload.MarketplacePurchaseApproval("o2", "2")
        bus.events.test {
            bus.emit(p1)
            bus.emit(p2)
            assertEquals(p1, (awaitItem() as AutoPushEvent.Incoming).payload)
            assertEquals(p2, (awaitItem() as AutoPushEvent.Incoming).payload)
            cancelAndIgnoreRemainingEvents()
        }
    }
}
