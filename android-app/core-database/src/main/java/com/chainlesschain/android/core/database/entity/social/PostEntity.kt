package com.chainlesschain.android.core.database.entity.social

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.TypeConverters
import com.chainlesschain.android.core.database.util.Converters

/**
 * 动态实体
 *
 * 存储用户发布的动态内容
 */
@Entity(
    tableName = "posts",
    indices = [
        Index(value = ["authorDid"]),
        Index(value = ["createdAt"]),
        Index(value = ["visibility"]),
        Index(value = ["authorDid", "createdAt"])
    ]
)
@TypeConverters(Converters::class)
data class PostEntity(
    @PrimaryKey
    val id: String,

    /** 作者 DID */
    val authorDid: String,

    /** 文字内容 */
    val content: String,

    /** 图片 URLs */
    val images: List<String> = emptyList(),

    /** 链接 URL */
    val linkUrl: String? = null,

    /** 链接预览信息（JSON） */
    val linkPreview: String? = null,

    /** 话题标签 */
    val tags: List<String> = emptyList(),

    /** @提及的 DIDs */
    val mentions: List<String> = emptyList(),

    /** 可见性 */
    val visibility: PostVisibility,

    /** 创建时间 */
    val createdAt: Long,

    /** 编辑时间 */
    val updatedAt: Long? = null,

    /** 是否置顶 */
    val isPinned: Boolean = false,

    /** 点赞数（缓存） */
    val likeCount: Int = 0,

    /** 评论数（缓存） */
    val commentCount: Int = 0,

    /** 转发数（缓存） */
    val shareCount: Int = 0,

    /** 当前用户是否点赞（缓存） */
    val isLiked: Boolean = false,

    /** 扩展信息（JSON 格式） */
    val metadata: String? = null
)

/**
 * 动态可见性
 */
enum class PostVisibility {
    /** 公开 */
    PUBLIC,

    /** 仅好友 */
    FRIENDS_ONLY,

    /** 私密 */
    PRIVATE
}

/**
 * 点赞实体
 */
@Entity(
    tableName = "post_likes",
    indices = [
        Index(value = ["postId"]),
        Index(value = ["userDid"]),
        Index(value = ["postId", "userDid"], unique = true),
        Index(value = ["createdAt"])
    ]
)
data class PostLikeEntity(
    @PrimaryKey
    val id: String,

    /** 动态 ID */
    val postId: String,

    /** 用户 DID */
    val userDid: String,

    /** 创建时间 */
    val createdAt: Long
)

/**
 * 评论实体
 */
@Entity(
    tableName = "post_comments",
    indices = [
        Index(value = ["postId"]),
        Index(value = ["authorDid"]),
        Index(value = ["parentCommentId"]),
        Index(value = ["createdAt"])
    ]
)
data class PostCommentEntity(
    @PrimaryKey
    val id: String,

    /** 动态 ID */
    val postId: String,

    /** 作者 DID */
    val authorDid: String,

    /** 评论内容 */
    val content: String,

    /** 父评论 ID（二级评论） */
    val parentCommentId: String? = null,

    /** 创建时间 */
    val createdAt: Long,

    /** 点赞数（缓存） */
    val likeCount: Int = 0,

    /** 当前用户是否点赞（缓存） */
    val isLiked: Boolean = false
)

/**
 * 转发实体
 */
@Entity(
    tableName = "post_shares",
    indices = [
        Index(value = ["postId"]),
        Index(value = ["userDid"]),
        Index(value = ["createdAt"])
    ]
)
data class PostShareEntity(
    @PrimaryKey
    val id: String,

    /** 动态 ID */
    val postId: String,

    /** 用户 DID */
    val userDid: String,

    /** 转发评论 */
    val comment: String? = null,

    /** 创建时间 */
    val createdAt: Long
)
