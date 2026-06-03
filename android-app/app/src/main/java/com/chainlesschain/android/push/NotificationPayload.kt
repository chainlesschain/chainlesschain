package com.chainlesschain.android.push

/**
 * 类型化通知 payload — 业务发起方调 [NotificationCenter.dispatch] 时构造。
 *
 * 设计文档 §5.3 + ADR-3：四类通知严格白名单，桌面端发起时按 type 字段路由。
 * [NotificationCategory] 是 channel 维度，[NotificationPayload] 是消息内容维度。
 */
sealed interface NotificationPayload {
    val category: NotificationCategory

    /** 通知 ID — 同 ID 会替换旧通知；不同 payload 用稳定 hash 各自唯一。 */
    val notificationId: Int

    /**
     * 桌面 Cowork 任务请求审批。点击 → 跳到 ApprovalUI 显示 taskId。
     */
    data class CoworkRequest(
        val taskId: String,
        val summary: String,
        val agentName: String? = null,
    ) : NotificationPayload {
        override val category = NotificationCategory.Cowork
        override val notificationId: Int = ("cowork:" + taskId).hashCode()
    }

    /**
     * Marketplace 大额购买 / DID 关键操作审批。点击 → BiometricGate → 反向 sign.request 流程。
     */
    data class MarketplacePurchaseApproval(
        val orderId: String,
        val total: String,
        val currency: String = "CNY",
        val itemName: String? = null,
    ) : NotificationPayload {
        override val category = NotificationCategory.Marketplace
        override val notificationId: Int = ("mp:" + orderId).hashCode()
    }

    /**
     * 桌面端系统警报（例如：长时任务失败 / 离线时长警告 / 同步冲突需介入）。
     */
    data class SystemAlertNotice(
        val title: String,
        val body: String,
        val severity: Severity = Severity.Info,
    ) : NotificationPayload {
        override val category = NotificationCategory.SystemAlert
        override val notificationId: Int = ("sys:" + title + body).hashCode()

        enum class Severity { Info, Warning, Critical }
    }

    /**
     * ShareReceiver / SyncCoordinator 把 Inbox 推上桌面 KB 后的回执通知，告诉用户 N 条已入箱。
     */
    data class ShareInboxSummary(
        val count: Int,
    ) : NotificationPayload {
        override val category = NotificationCategory.ShareInbox
        override val notificationId: Int = "share-inbox-summary".hashCode()
    }
}
