package com.chainlesschain.android.wear

import com.chainlesschain.android.auto.AutoPushBus
import com.chainlesschain.android.push.NotificationPayload
import io.mockk.mockk
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * v1.2 #20 P0.2 Wear Phase 1 — WearPushForwarder.renderForWatch JSON 契约测。
 *
 * 这测保护的是 phone ↔ watch 之间的 wire protocol。wear-app/__tests__/
 * ApprovalRequestTest.kt 验 watch-side 能解析；本测验 phone-side 产出的
 * 是 watch-side 所期望的字段集 + 类型。两侧均独立测，让契约变更必须更新两边。
 */
class WearPushForwarderTest {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val forwarder = WearPushForwarder(
        context = mockk(relaxed = true),
        autoPushBus = AutoPushBus(),
    )

    @Test
    fun `Marketplace payload renders all required fields`() {
        val payload = NotificationPayload.MarketplacePurchaseApproval(
            orderId = "order-42",
            total = "1500.00",
            currency = "CNY",
            itemName = "Premium AI Bundle",
        )
        val raw = forwarder.renderForWatch(payload)
        assertNotNull(raw)
        val obj = json.parseToJsonElement(raw) as JsonObject
        assertEquals("mp:order-42", obj["id"]!!.jsonPrimitive.content)
        assertEquals("multisig.purchase", obj["kind"]!!.jsonPrimitive.content)
        assertEquals("Marketplace 审批", obj["title"]!!.jsonPrimitive.content)
        assertEquals("Premium AI Bundle", obj["summary"]!!.jsonPrimitive.content)
        assertEquals(150000L, obj["amountFen"]!!.jsonPrimitive.content.toLong())
        assertEquals(true, obj["needsBiometric"]!!.jsonPrimitive.content.toBoolean())
    }

    @Test
    fun `Marketplace payload without itemName falls back to orderId summary`() {
        val payload = NotificationPayload.MarketplacePurchaseApproval(
            orderId = "order-7",
            total = "10.50",
            itemName = null,
        )
        val raw = forwarder.renderForWatch(payload)
        assertNotNull(raw)
        val obj = json.parseToJsonElement(raw) as JsonObject
        assertTrue(obj["summary"]!!.jsonPrimitive.content.contains("order-7"))
        assertEquals(1050L, obj["amountFen"]!!.jsonPrimitive.content.toLong())
    }

    @Test
    fun `SystemAlert critical maps severity + biometric=true`() {
        val payload = NotificationPayload.SystemAlertNotice(
            title = "Sync conflict",
            body = "3 rows pending",
            severity = NotificationPayload.SystemAlertNotice.Severity.Critical,
        )
        val raw = forwarder.renderForWatch(payload)
        assertNotNull(raw)
        val obj = json.parseToJsonElement(raw) as JsonObject
        assertEquals("system.alert", obj["kind"]!!.jsonPrimitive.content)
        assertEquals("critical", obj["severity"]!!.jsonPrimitive.content)
        assertEquals(true, obj["needsBiometric"]!!.jsonPrimitive.content.toBoolean())
    }

    @Test
    fun `SystemAlert info severity does NOT trigger biometric`() {
        val payload = NotificationPayload.SystemAlertNotice(
            title = "Backup done",
            body = "120 items",
            severity = NotificationPayload.SystemAlertNotice.Severity.Info,
        )
        val raw = forwarder.renderForWatch(payload)
        assertNotNull(raw)
        val obj = json.parseToJsonElement(raw) as JsonObject
        assertEquals("info", obj["severity"]!!.jsonPrimitive.content)
        assertEquals(false, obj["needsBiometric"]!!.jsonPrimitive.content.toBoolean())
    }

    @Test
    fun `CoworkRequest returns null - not routed to watch`() {
        val payload = NotificationPayload.CoworkRequest(
            taskId = "t-1",
            summary = "test",
        )
        assertNull(forwarder.renderForWatch(payload))
    }

    @Test
    fun `ShareInboxSummary returns null - not routed to watch`() {
        val payload = NotificationPayload.ShareInboxSummary(count = 3)
        assertNull(forwarder.renderForWatch(payload))
    }

    @Test
    fun `total with malformed value yields amountFen=0 fallback`() {
        val payload = NotificationPayload.MarketplacePurchaseApproval(
            orderId = "x",
            total = "not-a-number",
        )
        val raw = forwarder.renderForWatch(payload)
        assertNotNull(raw)
        val obj = json.parseToJsonElement(raw) as JsonObject
        assertEquals(0L, obj["amountFen"]!!.jsonPrimitive.content.toLong())
    }

    @Test
    fun `PATH_PUSH constant matches wear-app's ApprovalRequest_PATH_PUSH`() {
        // 两侧字面字符串严格对齐；不直接 import wear-app 的常量（跨 module
        // boundary 防 phone-app 反向依赖 wear），这里 hard-code 比对。
        assertEquals("/cc/push", WearPushForwarder.PATH_PUSH)
    }
}
