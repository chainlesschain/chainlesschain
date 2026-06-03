package com.chainlesschain.android.push

/**
 * 把 FCM RemoteMessage.data (Map<String,String>) 解析成 [NotificationPayload]。
 *
 * 设计：纯函数（Android-free）便于 JVM 单测。FirebaseMessagingService.onMessageReceived
 * 的 adapter 层负责把 Android 的 RemoteMessage 转 Map 后喂这里。
 *
 * 协议：data 必含 `type` 字段，余字段按 type 取。未知 type 返 null（调用方应 log）。
 *
 * 期望 payload 例：
 * ```
 * {
 *   "type": "cowork.request",
 *   "taskId": "task-123",
 *   "summary": "审批 spawnTeam 请求",
 *   "agentName": "frontend-vue"   // optional
 * }
 * ```
 */
object FcmRemoteMessageParser {

    fun parse(data: Map<String, String>): NotificationPayload? {
        val type = data["type"]?.trim() ?: return null
        return when (type) {
            "cowork.request" -> parseCowork(data)
            "marketplace.purchase" -> parseMarketplace(data)
            "system.alert" -> parseSystem(data)
            "share.inbox" -> parseShareInbox(data)
            else -> null
        }
    }

    private fun parseCowork(data: Map<String, String>): NotificationPayload.CoworkRequest? {
        val taskId = data["taskId"]?.takeIf { it.isNotBlank() } ?: return null
        val summary = data["summary"]?.takeIf { it.isNotBlank() } ?: return null
        return NotificationPayload.CoworkRequest(
            taskId = taskId,
            summary = summary,
            agentName = data["agentName"]?.takeIf { it.isNotBlank() },
        )
    }

    private fun parseMarketplace(data: Map<String, String>): NotificationPayload.MarketplacePurchaseApproval? {
        val orderId = data["orderId"]?.takeIf { it.isNotBlank() } ?: return null
        val total = data["total"]?.takeIf { it.isNotBlank() } ?: return null
        return NotificationPayload.MarketplacePurchaseApproval(
            orderId = orderId,
            total = total,
            currency = data["currency"]?.takeIf { it.isNotBlank() } ?: "CNY",
            itemName = data["itemName"]?.takeIf { it.isNotBlank() },
        )
    }

    private fun parseSystem(data: Map<String, String>): NotificationPayload.SystemAlertNotice? {
        val title = data["title"]?.takeIf { it.isNotBlank() } ?: return null
        val body = data["body"]?.takeIf { it.isNotBlank() } ?: return null
        val severity = when (data["severity"]?.lowercase()) {
            "warning" -> NotificationPayload.SystemAlertNotice.Severity.Warning
            "critical" -> NotificationPayload.SystemAlertNotice.Severity.Critical
            else -> NotificationPayload.SystemAlertNotice.Severity.Info
        }
        return NotificationPayload.SystemAlertNotice(title, body, severity)
    }

    private fun parseShareInbox(data: Map<String, String>): NotificationPayload.ShareInboxSummary? {
        val count = data["count"]?.toIntOrNull()?.takeIf { it > 0 } ?: return null
        return NotificationPayload.ShareInboxSummary(count)
    }
}
