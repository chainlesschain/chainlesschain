package com.chainlesschain.android.push

import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.auto.AutoModeTracker
import com.chainlesschain.android.auto.AutoPushBus
import com.chainlesschain.android.auto.AutoPushEvent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * v1.2 #1 Android Auto Phase 2 — NotificationCenter Auto routing 单测。
 *
 * 仅验路由侧逻辑（Marketplace / SystemAlert 在 Auto 模式时进 bus；Cowork /
 * ShareInbox 永不进 bus）。底层 NotificationManagerCompat.notify 在 Robolectric
 * 里 no-op（无真 system service），通知端不抛即合规。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class NotificationCenterAutoRoutingTest {

    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun `Marketplace payload routes to AutoPushBus when Auto active`() = runBlocking {
        val tracker = AutoModeTracker().apply { markActive() }
        val bus = AutoPushBus()
        val center = NotificationCenter(context, tracker, bus)

        val payload = NotificationPayload.MarketplacePurchaseApproval(
            orderId = "o-99",
            total = "1999",
        )
        center.dispatch(payload)

        val event = withTimeoutOrNull(2000) { bus.events.first() }
        assertTrue(event is AutoPushEvent.Incoming, "expected Incoming, got $event")
        assertEquals(payload, (event as AutoPushEvent.Incoming).payload)
    }

    @Test
    fun `SystemAlert payload routes to AutoPushBus when Auto active`() = runBlocking {
        val tracker = AutoModeTracker().apply { markActive() }
        val bus = AutoPushBus()
        val center = NotificationCenter(context, tracker, bus)

        val payload = NotificationPayload.SystemAlertNotice(
            title = "Sync conflict",
            body = "3 rows",
        )
        center.dispatch(payload)

        val event = withTimeoutOrNull(2000) { bus.events.first() }
        assertTrue(event is AutoPushEvent.Incoming)
        assertEquals(payload, (event as AutoPushEvent.Incoming).payload)
    }

    @Test
    fun `Cowork payload does NOT route to AutoPushBus even in Auto`() = runBlocking {
        val tracker = AutoModeTracker().apply { markActive() }
        val bus = AutoPushBus()
        val center = NotificationCenter(context, tracker, bus)

        center.dispatch(NotificationPayload.CoworkRequest("t-1", "summary"))

        // 1.5s 内不应到达；用 first(){} + timeout 模拟"等不到"
        val event = withTimeoutOrNull(1500) { bus.events.first() }
        assertNull(event, "Cowork should NOT route to Auto bus, got $event")
    }

    @Test
    fun `ShareInbox payload does NOT route to AutoPushBus even in Auto`() = runBlocking {
        val tracker = AutoModeTracker().apply { markActive() }
        val bus = AutoPushBus()
        val center = NotificationCenter(context, tracker, bus)

        center.dispatch(NotificationPayload.ShareInboxSummary(count = 5))

        val event = withTimeoutOrNull(1500) { bus.events.first() }
        assertNull(event, "ShareInbox should NOT route to Auto bus, got $event")
    }

    @Test
    fun `Marketplace payload does NOT route when Auto inactive`() = runBlocking {
        val tracker = AutoModeTracker() // 默认 inactive
        val bus = AutoPushBus()
        val center = NotificationCenter(context, tracker, bus)

        center.dispatch(
            NotificationPayload.MarketplacePurchaseApproval(
                orderId = "o-1",
                total = "1",
            ),
        )

        val event = withTimeoutOrNull(1500) { bus.events.first() }
        assertNull(event, "Auto inactive → bus should stay quiet, got $event")
    }
}
