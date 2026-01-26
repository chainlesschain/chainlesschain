package com.chainlesschain.android.core.database.entity.social

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 屏蔽用户实体
 *
 * 记录被当前用户屏蔽的其他用户
 */
@Entity(
    tableName = "blocked_users",
    indices = [
        Index(value = ["blockerDid"]),
        Index(value = ["blockedDid"]),
        Index(value = ["blockerDid", "blockedDid"], unique = true),
        Index(value = ["createdAt"])
    ]
)
data class BlockedUserEntity(
    @PrimaryKey
    val id: String,

    /** 屏蔽者 DID */
    val blockerDid: String,

    /** 被屏蔽者 DID */
    val blockedDid: String,

    /** 屏蔽原因（可选） */
    val reason: String? = null,

    /** 屏蔽时间 */
    val createdAt: Long
)
