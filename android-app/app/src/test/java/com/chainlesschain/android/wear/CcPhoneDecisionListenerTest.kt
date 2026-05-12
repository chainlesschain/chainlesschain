package com.chainlesschain.android.wear

import com.chainlesschain.android.auto.AutoPushBus
import com.chainlesschain.android.auto.AutoPushEvent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * v1.2 #20 P0.2 Wear Phase 2 — phone-side decision routing 单测。
 *
 * 不实例化 CcPhoneDecisionListener (extends WearableListenerService 需 Android
 * 框架)，只测 static helpers + route 逻辑可以用 AutoPushBus + 反射调到。这里
 * 用最直接路径: 测 companion + ApprovalDecisionWire serialization。
 */
class CcPhoneDecisionListenerTest {

    @Test
    fun `resourceTypeFromId maps mp prefix to marketplace`() {
        assertEquals(
            "marketplace",
            CcPhoneDecisionListener.resourceTypeFromId("mp:order-42"),
        )
    }

    @Test
    fun `resourceTypeFromId maps sys prefix to system`() {
        assertEquals(
            "system",
            CcPhoneDecisionListener.resourceTypeFromId("sys:12345"),
        )
    }

    @Test
    fun `resourceTypeFromId returns unknown for unrecognized prefix`() {
        assertEquals(
            "unknown",
            CcPhoneDecisionListener.resourceTypeFromId("foo:bar"),
        )
        assertEquals("unknown", CcPhoneDecisionListener.resourceTypeFromId(""))
    }

    @Test
    fun `ApprovalDecisionWire roundtrip preserves all fields`() {
        val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
        val original = ApprovalDecisionWire(
            requestId = "mp:order-42",
            approved = true,
            decidedAtMs = 1_700_000_000_000,
            biometricToken = "weak-ok",
        )
        val raw = json.encodeToString(ApprovalDecisionWire.serializer(), original)
        val back = json.decodeFromString(ApprovalDecisionWire.serializer(), raw)
        assertEquals(original, back)
    }

    @Test
    fun `ApprovalDecisionWire parses minimal payload (no biometric)`() {
        val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
        val raw = """{"requestId":"sys:5","approved":false,"decidedAtMs":42}"""
        val d = json.decodeFromString(ApprovalDecisionWire.serializer(), raw)
        assertEquals("sys:5", d.requestId)
        assertEquals(false, d.approved)
        assertEquals(null, d.biometricToken)
    }

    @Test
    fun `PATH_DECISION constant matches wear-app contract`() {
        assertEquals("/cc/decision", CcPhoneDecisionListener.PATH_DECISION)
    }

    @Test
    fun `AutoPushBus userDecision wire after route emits Decision event`() = runBlocking {
        // Light-weight smoke: AutoPushBus is the dispatch endpoint; verify a
        // userDecision call surfaces as Decision event for downstream
        // ApprovalCoordinator subscribers (Phase 3 ApprovalCoordinator wire).
        val bus = AutoPushBus()
        val emitJob = kotlinx.coroutines.GlobalScope.launch {
            kotlinx.coroutines.delay(50)
            bus.userDecision(
                com.chainlesschain.android.auto.AutoApprovalDecision(
                    payload = com.chainlesschain.android.push.NotificationPayload
                        .SystemAlertNotice(title = "x", body = "y"),
                    approved = true,
                ),
            )
        }
        val event = withTimeoutOrNull(2000) { bus.events.first() }
        emitJob.join()
        assertTrue(event is AutoPushEvent.Decision)
        assertEquals(true, (event as AutoPushEvent.Decision).decision.approved)
    }
}
