package com.chainlesschain.android.core.database.entity.social

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 通知实体
 *
 * 存储各类通知信息
 */
@Entity(
    tableName = "notifications",
    indices = [
        Index(value = ["type"]),
        Index(value = ["isRead"]),
        Index(value = ["createdAt"]),
        Index(value = ["actorDid"])
    ]
)
data class NotificationEntity(
    @PrimaryKey
    val id: String,

    /** 通知类型 */
    val type: NotificationType,

    /** 通知标题 */
    val title: String,

    /** 通知内容 */
    val content: String,

    /** 触发通知的用户 DID */
    val actorDid: String? = null,

    /** 关联目标 ID（动态 ID、评论 ID 等） */
    val targetId: String? = null,

    /** 创建时间 */
    val createdAt: Long,

    /** 是否已读 */
    val isRead: Boolean = false,

    /** 扩展数据（JSON 格式） */
    val data: String? = null
)

/**
 * 通知类型
 */
enum class NotificationType {
    /** 好友请求 */
    FRIEND_REQUEST,

    /** 好友已接受 */
    FRIEND_ACCEPTED,

    /** 动态被点赞 */
    POST_LIKED,

    /** 动态被评论 */
    POST_COMMENTED,

    /** 评论被回复 */
    COMMENT_REPLIED,

    /** 被 @ 提及 */
    POST_MENTIONED,

    /** 系统通知 */
    SYSTEM
}
