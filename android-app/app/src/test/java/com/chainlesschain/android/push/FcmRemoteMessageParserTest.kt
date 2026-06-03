package com.chainlesschain.android.push

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FcmRemoteMessageParser 单测 — pure function，无 Android framework。M3 D3 PushNotifier 关键
 * 校验：data Map → 4 类型 payload 解析正确性 + 缺字段/未知 type 失败转 null。
 */
class FcmRemoteMessageParserTest {

    @Test
    fun `parse missing type returns null`() {
        assertNull(FcmRemoteMessageParser.parse(mapOf("foo" to "bar")))
    }

    @Test
    fun `parse blank type returns null`() {
        assertNull(FcmRemoteMessageParser.parse(mapOf("type" to "   ")))
    }

    @Test
    fun `parse unknown type returns null`() {
        assertNull(FcmRemoteMessageParser.parse(mapOf("type" to "unrelated.event")))
    }

    @Test
    fun `parse cowork request happy path`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "cowork.request",
                "taskId" to "task-1",
                "summary" to "审批 spawnTeam",
                "agentName" to "frontend-vue",
            )
        ) as NotificationPayload.CoworkRequest
        assertEquals("task-1", p.taskId)
        assertEquals("审批 spawnTeam", p.summary)
        assertEquals("frontend-vue", p.agentName)
    }

    @Test
    fun `parse cowork request without agentName works`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "cowork.request",
                "taskId" to "task-2",
                "summary" to "审批",
            )
        ) as NotificationPayload.CoworkRequest
        assertNull(p.agentName)
    }

    @Test
    fun `parse cowork request missing taskId returns null`() {
        assertNull(
            FcmRemoteMessageParser.parse(
                mapOf("type" to "cowork.request", "summary" to "x")
            )
        )
    }

    @Test
    fun `parse cowork request missing summary returns null`() {
        assertNull(
            FcmRemoteMessageParser.parse(
                mapOf("type" to "cowork.request", "taskId" to "t")
            )
        )
    }

    @Test
    fun `parse marketplace happy path with default currency`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "marketplace.purchase",
                "orderId" to "ord-1",
                "total" to "99.50",
            )
        ) as NotificationPayload.MarketplacePurchaseApproval
        assertEquals("ord-1", p.orderId)
        assertEquals("99.50", p.total)
        assertEquals("CNY", p.currency)
        assertNull(p.itemName)
    }

    @Test
    fun `parse marketplace honors custom currency and itemName`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "marketplace.purchase",
                "orderId" to "ord-2",
                "total" to "10.00",
                "currency" to "USD",
                "itemName" to "DID Premium 1 year",
            )
        ) as NotificationPayload.MarketplacePurchaseApproval
        assertEquals("USD", p.currency)
        assertEquals("DID Premium 1 year", p.itemName)
    }

    @Test
    fun `parse marketplace missing total returns null`() {
        assertNull(
            FcmRemoteMessageParser.parse(
                mapOf("type" to "marketplace.purchase", "orderId" to "x")
            )
        )
    }

    @Test
    fun `parse system alert info default severity`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "system.alert",
                "title" to "同步失败",
                "body" to "桌面离线超过 24h",
            )
        ) as NotificationPayload.SystemAlertNotice
        assertEquals(NotificationPayload.SystemAlertNotice.Severity.Info, p.severity)
    }

    @Test
    fun `parse system alert warning severity case-insensitive`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "system.alert",
                "title" to "title",
                "body" to "body",
                "severity" to "WARNING",
            )
        ) as NotificationPayload.SystemAlertNotice
        assertEquals(NotificationPayload.SystemAlertNotice.Severity.Warning, p.severity)
    }

    @Test
    fun `parse system alert critical severity`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "system.alert",
                "title" to "title",
                "body" to "body",
                "severity" to "critical",
            )
        ) as NotificationPayload.SystemAlertNotice
        assertEquals(NotificationPayload.SystemAlertNotice.Severity.Critical, p.severity)
    }

    @Test
    fun `parse system alert unknown severity falls back to info`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "system.alert",
                "title" to "title",
                "body" to "body",
                "severity" to "bogus-value",
            )
        ) as NotificationPayload.SystemAlertNotice
        assertEquals(NotificationPayload.SystemAlertNotice.Severity.Info, p.severity)
    }

    @Test
    fun `parse system alert missing body returns null`() {
        assertNull(
            FcmRemoteMessageParser.parse(
                mapOf("type" to "system.alert", "title" to "x")
            )
        )
    }

    @Test
    fun `parse share inbox honors count`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf("type" to "share.inbox", "count" to "5")
        ) as NotificationPayload.ShareInboxSummary
        assertEquals(5, p.count)
    }

    @Test
    fun `parse share inbox count zero returns null`() {
        assertNull(
            FcmRemoteMessageParser.parse(
                mapOf("type" to "share.inbox", "count" to "0")
            )
        )
    }

    @Test
    fun `parse share inbox non-numeric count returns null`() {
        assertNull(
            FcmRemoteMessageParser.parse(
                mapOf("type" to "share.inbox", "count" to "abc")
            )
        )
    }

    @Test
    fun `type with surrounding whitespace is trimmed`() {
        val p = FcmRemoteMessageParser.parse(
            mapOf(
                "type" to "  cowork.request  ",
                "taskId" to "t",
                "summary" to "s",
            )
        )
        assertTrue(p is NotificationPayload.CoworkRequest)
    }
}
