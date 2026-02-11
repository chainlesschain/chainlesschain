package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 通知命令 API
 *
 * 提供类型安全的通知同步命令，支持跨设备通知推送和管理
 */
@Singleton
class NotificationCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 在PC端发送本地通知
     *
     * @param title 通知标题
     * @param body 通知内容
     * @param icon 通知图标路径(可选)
     * @param priority 优先级
     * @param respectQuietHours 是否遵守安静时间
     * @return 发送结果
     */
    suspend fun send(
        title: String,
        body: String,
        icon: String? = null,
        priority: NotificationPriority = NotificationPriority.NORMAL,
        respectQuietHours: Boolean = true
    ): Result<NotificationSendResponse> {
        val params = mutableMapOf<String, Any>(
            "title" to title,
            "body" to body,
            "priority" to priority.value,
            "respectQuietHours" to respectQuietHours
        )
        icon?.let { params["icon"] = it }

        return client.invoke("notification.send", params)
    }

    /**
     * 从PC推送通知到移动设备
     *
     * @param title 通知标题
     * @param body 通知内容
     * @param deviceId 目标设备ID(可选，不指定则推送到当前设备)
     * @param data 附加数据
     * @return 推送结果
     */
    suspend fun sendToMobile(
        title: String,
        body: String,
        deviceId: String? = null,
        data: Map<String, String>? = null
    ): Result<NotificationPushResponse> {
        val params = mutableMapOf<String, Any>(
            "title" to title,
            "body" to body
        )
        deviceId?.let { params["deviceId"] = it }
        data?.let { params["data"] = it }

        return client.invoke("notification.sendToMobile", params)
    }

    /**
     * 广播通知到所有连接的设备
     *
     * @param title 通知标题
     * @param body 通知内容
     * @return 广播结果
     */
    suspend fun broadcast(
        title: String,
        body: String
    ): Result<NotificationBroadcastResponse> {
        val params = mapOf(
            "title" to title,
            "body" to body
        )
        return client.invoke("notification.broadcast", params)
    }

    /**
     * 获取通知历史
     *
     * @param limit 返回条数限制
     * @param offset 偏移量
     * @param unreadOnly 是否只返回未读
     * @return 通知历史列表
     */
    suspend fun getHistory(
        limit: Int = 50,
        offset: Int = 0,
        unreadOnly: Boolean = false
    ): Result<NotificationHistoryResponse> {
        val params = mapOf(
            "limit" to limit,
            "offset" to offset,
            "unreadOnly" to unreadOnly
        )
        return client.invoke("notification.getHistory", params)
    }

    /**
     * 标记通知为已读
     *
     * @param notificationId 通知ID
     * @return 标记结果
     */
    suspend fun markAsRead(notificationId: String): Result<NotificationMarkResponse> {
        val params = mapOf("notificationId" to notificationId)
        return client.invoke("notification.markAsRead", params)
    }

    /**
     * 标记所有通知为已读
     *
     * @return 标记结果
     */
    suspend fun markAllAsRead(): Result<NotificationMarkResponse> {
        return client.invoke("notification.markAllAsRead", emptyMap())
    }

    /**
     * 获取通知设置
     *
     * @return 当前通知设置
     */
    suspend fun getSettings(): Result<NotificationSettings> {
        return client.invoke("notification.getSettings", emptyMap())
    }

    /**
     * 更新通知设置
     *
     * @param enabled 是否启用通知
     * @param quietHoursEnabled 是否启用安静时间
     * @param quietHoursStart 安静时间开始 (HH:mm格式)
     * @param quietHoursEnd 安静时间结束 (HH:mm格式)
     * @param soundEnabled 是否启用声音
     * @return 更新结果
     */
    suspend fun updateSettings(
        enabled: Boolean? = null,
        quietHoursEnabled: Boolean? = null,
        quietHoursStart: String? = null,
        quietHoursEnd: String? = null,
        soundEnabled: Boolean? = null
    ): Result<NotificationSettingsUpdateResponse> {
        val params = mutableMapOf<String, Any>()
        enabled?.let { params["enabled"] = it }
        quietHoursEnabled?.let { params["quietHoursEnabled"] = it }
        quietHoursStart?.let { params["quietHoursStart"] = it }
        quietHoursEnd?.let { params["quietHoursEnd"] = it }
        soundEnabled?.let { params["soundEnabled"] = it }

        return client.invoke("notification.updateSettings", params)
    }

    /**
     * 删除通知
     *
     * @param notificationId 通知ID
     * @return 删除结果
     */
    suspend fun delete(notificationId: String): Result<NotificationDeleteResponse> {
        val params = mapOf("notificationId" to notificationId)
        return client.invoke("notification.delete", params)
    }

    /**
     * 清除所有通知
     *
     * @return 清除结果
     */
    suspend fun clearAll(): Result<NotificationClearResponse> {
        return client.invoke("notification.clearAll", emptyMap())
    }

    /**
     * 获取未读通知数量
     *
     * @return 未读数量
     */
    suspend fun getUnreadCount(): Result<NotificationUnreadCountResponse> {
        return client.invoke("notification.getUnreadCount", emptyMap())
    }
}

/**
 * 通知优先级
 */
enum class NotificationPriority(val value: String) {
    LOW("low"),
    NORMAL("normal"),
    HIGH("high"),
    URGENT("urgent")
}

/**
 * 通知发送响应
 */
@Serializable
data class NotificationSendResponse(
    val success: Boolean,
    val notificationId: String? = null,
    val silenced: Boolean = false,  // 安静时间内被静音
    val error: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * 通知推送响应
 */
@Serializable
data class NotificationPushResponse(
    val success: Boolean,
    val delivered: Boolean = false,
    val deviceId: String? = null,
    val error: String? = null
)

/**
 * 通知广播响应
 */
@Serializable
data class NotificationBroadcastResponse(
    val success: Boolean,
    val deliveredCount: Int = 0,
    val failedCount: Int = 0,
    val error: String? = null
)

/**
 * 通知历史项
 */
@Serializable
data class NotificationHistoryItem(
    val id: String,
    val title: String,
    val body: String,
    val priority: String = "normal",
    val read: Boolean = false,
    val source: String = "pc",  // "pc" or "mobile"
    val createdAt: Long,
    val readAt: Long? = null,
    val data: Map<String, String>? = null
)

/**
 * 通知历史响应
 */
@Serializable
data class NotificationHistoryResponse(
    val success: Boolean,
    val notifications: List<NotificationHistoryItem>,
    val total: Int = 0,
    val unreadCount: Int = 0
)

/**
 * 通知标记响应
 */
@Serializable
data class NotificationMarkResponse(
    val success: Boolean,
    val markedCount: Int = 0,
    val error: String? = null
)

/**
 * 通知设置
 */
@Serializable
data class NotificationSettings(
    val enabled: Boolean = true,
    val quietHoursEnabled: Boolean = false,
    val quietHoursStart: String? = null,  // "22:00"
    val quietHoursEnd: String? = null,    // "08:00"
    val soundEnabled: Boolean = true,
    val vibrationEnabled: Boolean = true,
    val showPreview: Boolean = true
)

/**
 * 通知设置更新响应
 */
@Serializable
data class NotificationSettingsUpdateResponse(
    val success: Boolean,
    val settings: NotificationSettings? = null,
    val error: String? = null
)

/**
 * 通知删除响应
 */
@Serializable
data class NotificationDeleteResponse(
    val success: Boolean,
    val error: String? = null
)

/**
 * 通知清除响应
 */
@Serializable
data class NotificationClearResponse(
    val success: Boolean,
    val clearedCount: Int = 0,
    val error: String? = null
)

/**
 * 未读数量响应
 */
@Serializable
data class NotificationUnreadCountResponse(
    val success: Boolean,
    val count: Int = 0
)

/**
 * 通知接收事件
 *
 * 当PC收到通知或推送时通过P2P事件发送到Android
 */
@Serializable
data class NotificationReceivedEvent(
    val type: String = "notification.received",
    val notificationId: String,
    val title: String,
    val body: String,
    val priority: String = "normal",
    val source: String = "pc",
    val timestamp: Long,
    val data: Map<String, String>? = null
)
