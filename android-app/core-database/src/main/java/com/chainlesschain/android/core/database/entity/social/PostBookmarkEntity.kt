package com.chainlesschain.android.core.database.entity.social

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 动态收藏实体
 *
 * 存储用户收藏的动态
 *
 * @since v0.32.0
 */
@Entity(
    tableName = "post_bookmarks",
    indices = [
        Index(value = ["postId"]),
        Index(value = ["userDid"]),
        Index(value = ["postId", "userDid"], unique = true),
        Index(value = ["createdAt"])
    ]
)
data class PostBookmarkEntity(
    @PrimaryKey
    val id: String,

    /** 动态 ID */
    val postId: String,

    /** 用户 DID */
    val userDid: String,

    /** 创建时间 */
    val createdAt: Long
)
