package com.chainlesschain.android.feature.p2p.repository.social

import android.util.Log
import com.chainlesschain.android.core.database.entity.social.*
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 社交功能同步适配器
 *
 * 负责：
 * 1. 将社交实体转换为 SyncItem
 * 2. 应用远程同步的变更到本地数据库
 * 3. 处理冲突和合并策略
 */
@Singleton
class SocialSyncAdapter @Inject constructor(
    private val syncManager: SyncManager,
    private val friendRepository: Lazy<FriendRepository>,
    private val postRepository: Lazy<PostRepository>,
    private val notificationRepository: Lazy<NotificationRepository>
) {

    companion object {
        private const val TAG = "SocialSyncAdapter"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val json = Json { ignoreUnknownKeys = true }

    // ===== 好友同步 =====

    /**
     * 同步好友添加
     */
    fun syncFriendAdded(friend: FriendEntity) {
        val syncItem = SyncItem(
            resourceId = friend.did,
            resourceType = ResourceType.FRIEND,
            operation = SyncOperation.CREATE,
            data = json.encodeToString(friend.toSyncData()),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Friend added to sync queue: ${friend.did}")
    }

    /**
     * 同步好友更新
     */
    fun syncFriendUpdated(friend: FriendEntity) {
        val syncItem = SyncItem(
            resourceId = friend.did,
            resourceType = ResourceType.FRIEND,
            operation = SyncOperation.UPDATE,
            data = json.encodeToString(friend.toSyncData()),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Friend updated in sync queue: ${friend.did}")
    }

    /**
     * 同步好友删除
     */
    fun syncFriendDeleted(did: String) {
        val syncItem = SyncItem(
            resourceId = did,
            resourceType = ResourceType.FRIEND,
            operation = SyncOperation.DELETE,
            data = json.encodeToString(FriendSyncData(did)),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Friend deleted in sync queue: $did")
    }

    // ===== 动态同步 =====

    /**
     * 同步动态发布
     */
    fun syncPostCreated(post: PostEntity) {
        val syncItem = SyncItem(
            resourceId = post.id,
            resourceType = ResourceType.POST,
            operation = SyncOperation.CREATE,
            data = json.encodeToString(post.toSyncData()),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Post created in sync queue: ${post.id}")
    }

    /**
     * 同步动态更新
     */
    fun syncPostUpdated(post: PostEntity) {
        val syncItem = SyncItem(
            resourceId = post.id,
            resourceType = ResourceType.POST,
            operation = SyncOperation.UPDATE,
            data = json.encodeToString(post.toSyncData()),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Post updated in sync queue: ${post.id}")
    }

    /**
     * 同步动态删除
     */
    fun syncPostDeleted(postId: String) {
        val syncItem = SyncItem(
            resourceId = postId,
            resourceType = ResourceType.POST,
            operation = SyncOperation.DELETE,
            data = json.encodeToString(PostSyncData(id = postId)),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Post deleted in sync queue: $postId")
    }

    // ===== 点赞同步 =====

    /**
     * 同步点赞
     */
    fun syncLikeAdded(like: PostLikeEntity) {
        val syncItem = SyncItem(
            resourceId = like.id,
            resourceType = ResourceType.POST_LIKE,
            operation = SyncOperation.CREATE,
            data = json.encodeToString(like.toSyncData()),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Like added to sync queue: ${like.id}")
    }

    /**
     * 同步取消点赞
     */
    fun syncLikeRemoved(likeId: String) {
        val syncItem = SyncItem(
            resourceId = likeId,
            resourceType = ResourceType.POST_LIKE,
            operation = SyncOperation.DELETE,
            data = json.encodeToString(PostLikeSyncData(id = likeId)),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Like removed in sync queue: $likeId")
    }

    // ===== 评论同步 =====

    /**
     * 同步评论添加
     */
    fun syncCommentAdded(comment: PostCommentEntity) {
        val syncItem = SyncItem(
            resourceId = comment.id,
            resourceType = ResourceType.POST_COMMENT,
            operation = SyncOperation.CREATE,
            data = json.encodeToString(comment.toSyncData()),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Comment added to sync queue: ${comment.id}")
    }

    /**
     * 同步评论删除
     */
    fun syncCommentDeleted(commentId: String) {
        val syncItem = SyncItem(
            resourceId = commentId,
            resourceType = ResourceType.POST_COMMENT,
            operation = SyncOperation.DELETE,
            data = json.encodeToString(PostCommentSyncData(id = commentId)),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Comment deleted in sync queue: $commentId")
    }

    // ===== 通知同步 =====

    /**
     * 同步通知创建
     */
    fun syncNotificationCreated(notification: NotificationEntity) {
        val syncItem = SyncItem(
            resourceId = notification.id,
            resourceType = ResourceType.NOTIFICATION,
            operation = SyncOperation.CREATE,
            data = json.encodeToString(notification.toSyncData()),
            timestamp = System.currentTimeMillis()
        )
        syncManager.recordChange(syncItem)
        Log.d(TAG, "Notification created in sync queue: ${notification.id}")
    }

    /**
     * 同步举报提交
     */
    fun syncReportSubmitted(report: com.chainlesschain.android.core.database.entity.social.PostReportEntity) {
        // Backend moderation system integration pending
        Log.d(TAG, "Report submitted for post: ${report.postId}, reason: ${report.reason}")
    }

    // ===== 应用同步变更 =====

    /**
     * 应用接收到的同步项
     */
    suspend fun applySyncItem(syncItem: SyncItem) {
        try {
            when (syncItem.resourceType) {
                ResourceType.FRIEND -> applyFriendSync(syncItem)
                ResourceType.POST -> applyPostSync(syncItem)
                ResourceType.POST_LIKE -> applyLikeSync(syncItem)
                ResourceType.POST_COMMENT -> applyCommentSync(syncItem)
                ResourceType.NOTIFICATION -> applyNotificationSync(syncItem)
                else -> Log.w(TAG, "Unsupported resource type: ${syncItem.resourceType}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to apply sync item: ${syncItem.resourceId}", e)
        }
    }

    private suspend fun applyFriendSync(syncItem: SyncItem) {
        val data = json.decodeFromString<FriendSyncData>(syncItem.data)

        when (syncItem.operation) {
            SyncOperation.CREATE, SyncOperation.UPDATE -> {
                val friend = data.toEntity()
                friendRepository.value.addFriend(friend)
                Log.d(TAG, "Friend synced: ${friend.did}")
            }
            SyncOperation.DELETE -> {
                friendRepository.value.deleteFriend(data.did)
                Log.d(TAG, "Friend deleted: ${data.did}")
            }
        }
    }

    private suspend fun applyPostSync(syncItem: SyncItem) {
        val data = json.decodeFromString<PostSyncData>(syncItem.data)

        when (syncItem.operation) {
            SyncOperation.CREATE -> {
                val post = data.toEntity()
                postRepository.value.createPost(post)
                Log.d(TAG, "Post synced: ${post.id}")
            }
            SyncOperation.UPDATE -> {
                val post = data.toEntity()
                postRepository.value.updatePost(post)
                Log.d(TAG, "Post updated: ${post.id}")
            }
            SyncOperation.DELETE -> {
                postRepository.value.deletePost(data.id)
                Log.d(TAG, "Post deleted: ${data.id}")
            }
        }
    }

    private suspend fun applyLikeSync(syncItem: SyncItem) {
        val data = json.decodeFromString<PostLikeSyncData>(syncItem.data)

        when (syncItem.operation) {
            SyncOperation.CREATE -> {
                data.postId?.let { postId ->
                    data.userDid?.let { userDid ->
                        postRepository.value.likePost(postId, userDid)
                        Log.d(TAG, "Like synced: ${data.id}")
                    }
                }
            }
            SyncOperation.DELETE -> {
                data.postId?.let { postId ->
                    data.userDid?.let { userDid ->
                        postRepository.value.unlikePost(postId, userDid)
                        Log.d(TAG, "Like removed: ${data.id}")
                    }
                }
            }
            else -> {}
        }
    }

    private suspend fun applyCommentSync(syncItem: SyncItem) {
        val data = json.decodeFromString<PostCommentSyncData>(syncItem.data)

        when (syncItem.operation) {
            SyncOperation.CREATE -> {
                val comment = data.toEntity()
                postRepository.value.addComment(comment)
                Log.d(TAG, "Comment synced: ${comment.id}")
            }
            SyncOperation.DELETE -> {
                data.toEntity().let { comment ->
                    postRepository.value.deleteComment(comment)
                    Log.d(TAG, "Comment deleted: ${data.id}")
                }
            }
            else -> {}
        }
    }

    private suspend fun applyNotificationSync(syncItem: SyncItem) {
        val data = json.decodeFromString<NotificationSyncData>(syncItem.data)

        when (syncItem.operation) {
            SyncOperation.CREATE -> {
                val notification = data.toEntity()
                notificationRepository.value.createNotification(notification)
                Log.d(TAG, "Notification synced: ${notification.id}")
            }
            else -> {}
        }
    }
}

// ===== 同步数据类 =====

@Serializable
data class FriendSyncData(
    val did: String,
    val nickname: String? = null,
    val avatar: String? = null,
    val bio: String? = null,
    val remarkName: String? = null,
    val groupId: String? = null,
    val addedAt: Long? = null,
    val status: String? = null,
    val isBlocked: Boolean? = null,
    val lastActiveAt: Long? = null
)

@Serializable
data class PostSyncData(
    val id: String,
    val authorDid: String? = null,
    val content: String? = null,
    val images: List<String>? = null,
    val tags: List<String>? = null,
    val mentions: List<String>? = null,
    val visibility: String? = null,
    val createdAt: Long? = null,
    val updatedAt: Long? = null,
    val isPinned: Boolean? = null
)

@Serializable
data class PostLikeSyncData(
    val id: String,
    val postId: String? = null,
    val userDid: String? = null,
    val createdAt: Long? = null
)

@Serializable
data class PostCommentSyncData(
    val id: String,
    val postId: String? = null,
    val authorDid: String? = null,
    val content: String? = null,
    val parentCommentId: String? = null,
    val createdAt: Long? = null
)

@Serializable
data class NotificationSyncData(
    val id: String,
    val type: String? = null,
    val title: String? = null,
    val content: String? = null,
    val actorDid: String? = null,
    val targetId: String? = null,
    val createdAt: Long? = null,
    val isRead: Boolean? = null
)

// ===== 扩展函数：实体 -> 同步数据 =====

fun FriendEntity.toSyncData() = FriendSyncData(
    did = did,
    nickname = nickname,
    avatar = avatar,
    bio = bio,
    remarkName = remarkName,
    groupId = groupId,
    addedAt = addedAt,
    status = status.name,
    isBlocked = isBlocked,
    lastActiveAt = lastActiveAt
)

fun PostEntity.toSyncData() = PostSyncData(
    id = id,
    authorDid = authorDid,
    content = content,
    images = images,
    tags = tags,
    mentions = mentions,
    visibility = visibility.name,
    createdAt = createdAt,
    updatedAt = updatedAt,
    isPinned = isPinned
)

fun PostLikeEntity.toSyncData() = PostLikeSyncData(
    id = id,
    postId = postId,
    userDid = userDid,
    createdAt = createdAt
)

fun PostCommentEntity.toSyncData() = PostCommentSyncData(
    id = id,
    postId = postId,
    authorDid = authorDid,
    content = content,
    parentCommentId = parentCommentId,
    createdAt = createdAt
)

fun NotificationEntity.toSyncData() = NotificationSyncData(
    id = id,
    type = type.name,
    title = title,
    content = content,
    actorDid = actorDid,
    targetId = targetId,
    createdAt = createdAt,
    isRead = isRead
)

// ===== 扩展函数：同步数据 -> 实体 =====

fun FriendSyncData.toEntity() = FriendEntity(
    did = did,
    nickname = nickname ?: "",
    avatar = avatar,
    bio = bio,
    remarkName = remarkName,
    groupId = groupId,
    addedAt = addedAt ?: System.currentTimeMillis(),
    status = status?.let { FriendStatus.valueOf(it) } ?: FriendStatus.PENDING,
    isBlocked = isBlocked ?: false,
    lastActiveAt = lastActiveAt
)

fun PostSyncData.toEntity() = PostEntity(
    id = id,
    authorDid = authorDid ?: "",
    content = content ?: "",
    images = images ?: emptyList(),
    tags = tags ?: emptyList(),
    mentions = mentions ?: emptyList(),
    visibility = visibility?.let { PostVisibility.valueOf(it) } ?: PostVisibility.PUBLIC,
    createdAt = createdAt ?: System.currentTimeMillis(),
    updatedAt = updatedAt,
    isPinned = isPinned ?: false
)

fun PostCommentSyncData.toEntity() = PostCommentEntity(
    id = id,
    postId = postId ?: "",
    authorDid = authorDid ?: "",
    content = content ?: "",
    parentCommentId = parentCommentId,
    createdAt = createdAt ?: System.currentTimeMillis()
)

fun NotificationSyncData.toEntity() = NotificationEntity(
    id = id,
    type = type?.let { NotificationType.valueOf(it) } ?: NotificationType.SYSTEM,
    title = title ?: "",
    content = content ?: "",
    actorDid = actorDid,
    targetId = targetId,
    createdAt = createdAt ?: System.currentTimeMillis(),
    isRead = isRead ?: false
)
