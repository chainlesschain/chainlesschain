package com.chainlesschain.android.push

/**
 * NotificationCenter dispatch 时的渲染中间值。把 payload 拆成 title / body / category /
 * notificationId，再加 [importance]（来自 category）便于一致设置。
 *
 * 纯函数渲染让单测可以直接 assert 文案/通道 ID/notification ID 三件套，无需 Android framework。
 */
data class NotificationRender(
    val category: NotificationCategory,
    val title: String,
    val body: String,
    val notificationId: Int,
    val deepLink: String? = null,
)

/**
 * 把 [NotificationPayload] 渲染成 [NotificationRender]。文案集中在此，便于本地化迁移。
 */
fun renderPayload(payload: NotificationPayload): NotificationRender = when (payload) {
    is NotificationPayload.CoworkRequest -> NotificationRender(
        category = payload.category,
        title = "Cowork 任务等待审批",
        body = payload.agentName?.let { "@$it · ${payload.summary}" } ?: payload.summary,
        notificationId = payload.notificationId,
        deepLink = "chainlesschain://cowork/approval?taskId=${payload.taskId}",
    )
    is NotificationPayload.MarketplacePurchaseApproval -> NotificationRender(
        category = payload.category,
        title = "Marketplace 大额审批",
        body = buildString {
            append("订单 ${payload.orderId} · ")
            append(payload.total).append(' ').append(payload.currency)
            payload.itemName?.let { append(" · ").append(it) }
        },
        notificationId = payload.notificationId,
        deepLink = "chainlesschain://marketplace/approve?orderId=${payload.orderId}",
    )
    is NotificationPayload.SystemAlertNotice -> NotificationRender(
        category = payload.category,
        title = when (payload.severity) {
            NotificationPayload.SystemAlertNotice.Severity.Critical -> "⚠️ ${payload.title}"
            NotificationPayload.SystemAlertNotice.Severity.Warning -> "🟡 ${payload.title}"
            NotificationPayload.SystemAlertNotice.Severity.Info -> payload.title
        },
        body = payload.body,
        notificationId = payload.notificationId,
    )
    is NotificationPayload.ShareInboxSummary -> NotificationRender(
        category = payload.category,
        title = "${payload.count} 条分享已入箱",
        body = "前往知识库查看",
        notificationId = payload.notificationId,
        deepLink = "chainlesschain://knowledge/inbox",
    )
}
