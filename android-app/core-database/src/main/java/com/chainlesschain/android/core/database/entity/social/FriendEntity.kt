package com.chainlesschain.android.core.database.entity.social

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 好友实体
 *
 * 存储好友信息和关系状态
 */
@Entity(
    tableName = "friends",
    indices = [
        Index(value = ["did"], unique = true),
        Index(value = ["status"]),
        Index(value = ["groupId"]),
        Index(value = ["addedAt"]),
        Index(value = ["lastActiveAt"])
    ]
)
data class FriendEntity(
    @PrimaryKey
    val did: String,

    /** 昵称 */
    val nickname: String,

    /** 头像 URL */
    val avatar: String? = null,

    /** 个人简介 */
    val bio: String? = null,

    /** 备注名 */
    val remarkName: String? = null,

    /** 分组 ID */
    val groupId: String? = null,

    /** 添加时间 */
    val addedAt: Long,

    /** 好友状态 */
    val status: FriendStatus,

    /** 是否屏蔽 */
    val isBlocked: Boolean = false,

    /** 最后活跃时间 */
    val lastActiveAt: Long? = null,

    /** 扩展信息（JSON 格式） */
    val metadata: String? = null
)

/**
 * 好友状态
 */
enum class FriendStatus {
    /** 等待对方接受 */
    PENDING,

    /** 已接受 */
    ACCEPTED,

    /** 已拒绝 */
    REJECTED,

    /** 已删除 */
    DELETED
}

/**
 * 好友分组实体
 */
@Entity(
    tableName = "friend_groups",
    indices = [
        Index(value = ["name"], unique = true)
    ]
)
data class FriendGroupEntity(
    @PrimaryKey
    val id: String,

    /** 分组名称 */
    val name: String,

    /** 排序顺序 */
    val sortOrder: Int = 0,

    /** 创建时间 */
    val createdAt: Long
)
