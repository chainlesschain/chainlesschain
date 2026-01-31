package com.chainlesschain.android.core.common.test

import com.chainlesschain.android.core.database.entity.social.*
import kotlin.random.Random

/**
 * 统一测试数据工厂
 *
 * 提供各种实体的测试数据生成方法
 */
object TestDataFactory {

    // ===== 好友测试数据 =====

    fun createFriendEntity(
        did: String = "did:test:${Random.nextInt(1000, 9999)}",
        nickname: String = "Test User ${Random.nextInt(100)}",
        avatar: String? = null,
        bio: String? = "Test bio",
        remarkName: String? = null,
        groupId: String? = null,
        status: FriendStatus = FriendStatus.ACCEPTED,
        isBlocked: Boolean = false,
        addedAt: Long = System.currentTimeMillis(),
        lastActiveAt: Long? = System.currentTimeMillis()
    ) = FriendEntity(
        did = did,
        nickname = nickname,
        avatar = avatar,
        bio = bio,
        remarkName = remarkName,
        groupId = groupId,
        addedAt = addedAt,
        status = status,
        isBlocked = isBlocked,
        lastActiveAt = lastActiveAt
    )

    fun createFriendList(count: Int = 5): List<FriendEntity> {
        return List(count) { index ->
            createFriendEntity(
                did = "did:test:friend:$index",
                nickname = "Friend $index"
            )
        }
    }

    fun createFriendGroupEntity(
        id: String = "group_${System.currentTimeMillis()}",
        name: String = "Test Group",
        sortOrder: Int = 0,
        createdAt: Long = System.currentTimeMillis()
    ) = FriendGroupEntity(
        id = id,
        name = name,
        sortOrder = sortOrder,
        createdAt = createdAt
    )

    // ===== 动态测试数据 =====

    fun createPostEntity(
        id: String = "post_${System.currentTimeMillis()}",
        authorDid: String = "did:test:author",
        content: String = "Test post content ${Random.nextInt(100)}",
        images: List<String> = emptyList(),
        tags: List<String> = emptyList(),
        mentions: List<String> = emptyList(),
        visibility: PostVisibility = PostVisibility.PUBLIC,
        linkUrl: String? = null,
        linkPreview: String? = null,
        createdAt: Long = System.currentTimeMillis(),
        updatedAt: Long? = null,
        isPinned: Boolean = false,
        likeCount: Int = 0,
        commentCount: Int = 0,
        shareCount: Int = 0
    ) = PostEntity(
        id = id,
        authorDid = authorDid,
        content = content,
        images = images,
        tags = tags,
        mentions = mentions,
        visibility = visibility,
        linkUrl = linkUrl,
        linkPreview = linkPreview,
        createdAt = createdAt,
        updatedAt = updatedAt,
        isPinned = isPinned,
        likeCount = likeCount,
        commentCount = commentCount,
        shareCount = shareCount
    )

    fun createPostList(
        count: Int = 10,
        authorDid: String = "did:test:author"
    ): List<PostEntity> {
        return List(count) { index ->
            createPostEntity(
                id = "post_$index",
                authorDid = authorDid,
                content = "Test post content $index",
                createdAt = System.currentTimeMillis() - (index * 60000) // 每个间隔1分钟
            )
        }
    }

    fun createPostCommentEntity(
        id: String = "comment_${System.currentTimeMillis()}",
        postId: String = "post_test",
        authorDid: String = "did:test:commenter",
        content: String = "Test comment",
        parentCommentId: String? = null,
        createdAt: Long = System.currentTimeMillis(),
        likeCount: Int = 0,
        replyCount: Int = 0
    ) = PostCommentEntity(
        id = id,
        postId = postId,
        authorDid = authorDid,
        content = content,
        parentCommentId = parentCommentId,
        createdAt = createdAt,
        likeCount = likeCount,
        replyCount = replyCount
    )

    fun createPostLikeEntity(
        id: String = "like_${System.currentTimeMillis()}",
        postId: String = "post_test",
        userDid: String = "did:test:liker",
        createdAt: Long = System.currentTimeMillis()
    ) = PostLikeEntity(
        id = id,
        postId = postId,
        userDid = userDid,
        createdAt = createdAt
    )

    fun createPostShareEntity(
        id: String = "share_${System.currentTimeMillis()}",
        postId: String = "post_test",
        userDid: String = "did:test:sharer",
        createdAt: Long = System.currentTimeMillis()
    ) = PostShareEntity(
        id = id,
        postId = postId,
        userDid = userDid,
        createdAt = createdAt
    )

    fun createPostReportEntity(
        id: String = "report_${System.currentTimeMillis()}",
        postId: String = "post_test",
        reporterDid: String = "did:test:reporter",
        reason: ReportReason = ReportReason.SPAM,
        description: String? = "Test report",
        createdAt: Long = System.currentTimeMillis(),
        status: ReportStatus = ReportStatus.PENDING
    ) = PostReportEntity(
        id = id,
        postId = postId,
        reporterDid = reporterDid,
        reason = reason,
        description = description,
        createdAt = createdAt,
        status = status
    )

    // ===== 通知测试数据 =====

    fun createNotificationEntity(
        id: String = "notification_${System.currentTimeMillis()}",
        type: NotificationType = NotificationType.LIKE,
        title: String = "Test Notification",
        content: String = "Test notification content",
        actorDid: String? = "did:test:actor",
        targetId: String? = null,
        createdAt: Long = System.currentTimeMillis(),
        isRead: Boolean = false
    ) = NotificationEntity(
        id = id,
        type = type,
        title = title,
        content = content,
        actorDid = actorDid,
        targetId = targetId,
        createdAt = createdAt,
        isRead = isRead
    )

    // ===== 屏蔽用户测试数据 =====

    fun createBlockedUserEntity(
        id: String = "block_${System.currentTimeMillis()}",
        blockerDid: String = "did:test:blocker",
        blockedDid: String = "did:test:blocked",
        reason: String? = "Test block reason",
        createdAt: Long = System.currentTimeMillis()
    ) = BlockedUserEntity(
        id = id,
        blockerDid = blockerDid,
        blockedDid = blockedDid,
        reason = reason,
        createdAt = createdAt
    )

    // ===== 辅助方法 =====

    /**
     * 生成随机 DID
     */
    fun randomDid(prefix: String = "test"): String {
        return "did:$prefix:${Random.nextInt(10000, 99999)}"
    }

    /**
     * 生成随机时间戳（过去N天内）
     */
    fun randomTimestamp(daysAgo: Int = 7): Long {
        val now = System.currentTimeMillis()
        val maxOffset = daysAgo * 24 * 60 * 60 * 1000L
        return now - Random.nextLong(0, maxOffset)
    }

    /**
     * 生成随机内容文本
     */
    fun randomContent(minWords: Int = 5, maxWords: Int = 20): String {
        val words = listOf(
            "test", "data", "factory", "android", "kotlin",
            "compose", "jetpack", "material", "design", "ui",
            "view", "model", "repository", "database", "entity"
        )
        val wordCount = Random.nextInt(minWords, maxWords + 1)
        return List(wordCount) { words.random() }.joinToString(" ")
    }
}
