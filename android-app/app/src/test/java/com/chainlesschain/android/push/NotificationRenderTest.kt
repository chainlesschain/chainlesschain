package com.chainlesschain.android.push

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * NotificationRender + payload.notificationId 单测。M3 D3 PushNotifier。
 *
 * 验证：renderPayload pure function 对 4 类 payload 的标题 / 正文 / deepLink / category /
 * notificationId 渲染稳定（同输入同输出，用于 hash-based 替换）。
 */
class NotificationRenderTest {

    @Test
    fun `render cowork request without agentName`() {
        val p = NotificationPayload.CoworkRequest(taskId = "t-1", summary = "spawnTeam")
        val r = renderPayload(p)
        assertEquals(NotificationCategory.Cowork, r.category)
        assertEquals("Cowork 任务等待审批", r.title)
        assertEquals("spawnTeam", r.body)
        assertEquals("chainlesschain://cowork/approval?taskId=t-1", r.deepLink)
    }

    @Test
    fun `render cowork request prefixes agentName when present`() {
        val r = renderPayload(
            NotificationPayload.CoworkRequest("t-2", "approve", agentName = "vue-frontend")
        )
        assertEquals("@vue-frontend · approve", r.body)
    }

    @Test
    fun `render marketplace includes order total currency`() {
        val r = renderPayload(
            NotificationPayload.MarketplacePurchaseApproval(
                orderId = "ord-1",
                total = "299",
                currency = "USD",
                itemName = "Premium DID",
            )
        )
        assertEquals(NotificationCategory.Marketplace, r.category)
        assertTrue(r.body.contains("ord-1"))
        assertTrue(r.body.contains("299"))
        assertTrue(r.body.contains("USD"))
        assertTrue(r.body.contains("Premium DID"))
        assertEquals("chainlesschain://marketplace/approve?orderId=ord-1", r.deepLink)
    }

    @Test
    fun `render marketplace omits itemName section when null`() {
        val r = renderPayload(
            NotificationPayload.MarketplacePurchaseApproval(
                orderId = "ord-2",
                total = "100",
            )
        )
        // 没有 itemName 时不带 "·" 分隔
        assertTrue(!r.body.endsWith(" · "))
    }

    @Test
    fun `render system alert info severity has no emoji prefix`() {
        val r = renderPayload(
            NotificationPayload.SystemAlertNotice(
                title = "标题",
                body = "正文",
                severity = NotificationPayload.SystemAlertNotice.Severity.Info,
            )
        )
        assertEquals("标题", r.title)
        assertNull(r.deepLink)
    }

    @Test
    fun `render system alert warning has yellow circle prefix`() {
        val r = renderPayload(
            NotificationPayload.SystemAlertNotice(
                title = "title",
                body = "body",
                severity = NotificationPayload.SystemAlertNotice.Severity.Warning,
            )
        )
        assertTrue(r.title.startsWith("🟡"))
    }

    @Test
    fun `render system alert critical has warning emoji prefix`() {
        val r = renderPayload(
            NotificationPayload.SystemAlertNotice(
                title = "title",
                body = "body",
                severity = NotificationPayload.SystemAlertNotice.Severity.Critical,
            )
        )
        assertTrue(r.title.startsWith("⚠️"))
    }

    @Test
    fun `render share inbox uses count in title`() {
        val r = renderPayload(NotificationPayload.ShareInboxSummary(count = 3))
        assertEquals(NotificationCategory.ShareInbox, r.category)
        assertTrue(r.title.contains("3"))
        assertEquals("chainlesschain://knowledge/inbox", r.deepLink)
    }

    @Test
    fun `notificationId is stable for same payload values`() {
        val a = NotificationPayload.CoworkRequest("task-X", "do thing")
        val b = NotificationPayload.CoworkRequest("task-X", "do thing")
        assertEquals(a.notificationId, b.notificationId)
    }

    @Test
    fun `notificationId differs for different taskIds`() {
        val a = NotificationPayload.CoworkRequest("task-A", "x")
        val b = NotificationPayload.CoworkRequest("task-B", "x")
        assertTrue(a.notificationId != b.notificationId)
    }

    @Test
    fun `ShareInboxSummary id is fixed regardless of count`() {
        val a = NotificationPayload.ShareInboxSummary(1)
        val b = NotificationPayload.ShareInboxSummary(99)
        assertEquals(a.notificationId, b.notificationId)
    }

    @Test
    fun `category importance maps correctly`() {
        assertEquals(android.app.NotificationManager.IMPORTANCE_HIGH, NotificationCategory.Marketplace.importance)
        assertEquals(android.app.NotificationManager.IMPORTANCE_LOW, NotificationCategory.ShareInbox.importance)
    }

    @Test
    fun `category channel ids are unique`() {
        val ids = NotificationCategory.values().map { it.channelId }.toSet()
        assertEquals(4, ids.size)
    }
}
