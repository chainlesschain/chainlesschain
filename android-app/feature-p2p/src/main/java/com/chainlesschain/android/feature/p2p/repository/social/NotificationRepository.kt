package com.chainlesschain.android.feature.p2p.repository.social

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.common.asResult
import com.chainlesschain.android.core.database.dao.social.NotificationDao
import com.chainlesschain.android.core.database.entity.social.NotificationEntity
import com.chainlesschain.android.core.database.entity.social.NotificationType
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 通知数据仓库
 *
 * 管理应用通知、未读状态和通知类型
 */
@Singleton
class NotificationRepository @Inject constructor(
    private val notificationDao: NotificationDao,
    private val syncAdapter: Lazy<SocialSyncAdapter> // 使用 Lazy 避免循环依赖
) {

    // ===== 查询方法 =====

    /**
     * 获取所有通知
     */
    fun getAllNotifications(): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.getAllNotifications()
            .asResult()
    }

    /**
     * 获取未读通知
     */
    fun getUnreadNotifications(): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.getUnreadNotifications()
            .asResult()
    }

    /**
     * 获取指定类型的通知
     */
    fun getNotificationsByType(type: NotificationType): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.getNotificationsByType(type)
            .asResult()
    }

    /**
     * 获取指定类型的未读通知
     */
    fun getUnreadNotificationsByType(type: NotificationType): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.getUnreadNotificationsByType(type)
            .asResult()
    }

    /**
     * 根据 ID 获取通知
     */
    suspend fun getNotificationById(id: String): Result<NotificationEntity?> {
        return try {
            Result.Success(notificationDao.getNotificationById(id))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 观察通知
     */
    fun observeNotificationById(id: String): Flow<Result<NotificationEntity?>> {
        return notificationDao.observeNotificationById(id)
            .asResult()
    }

    /**
     * 获取来自指定用户的通知
     */
    fun getNotificationsByActor(actorDid: String): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.getNotificationsByActor(actorDid)
            .asResult()
    }

    /**
     * 获取与指定目标相关的通知
     */
    fun getNotificationsByTarget(targetId: String): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.getNotificationsByTarget(targetId)
            .asResult()
    }

    /**
     * 获取未读通知数
     */
    fun getUnreadCount(): Flow<Result<Int>> {
        return notificationDao.getUnreadCount()
            .asResult()
    }

    /**
     * 获取指定类型的未读通知数
     */
    fun getUnreadCountByType(type: NotificationType): Flow<Result<Int>> {
        return notificationDao.getUnreadCountByType(type)
            .asResult()
    }

    /**
     * 分页获取通知
     */
    fun getNotificationsPaged(limit: Int, offset: Int): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.getNotificationsPaged(limit, offset)
            .asResult()
    }

    /**
     * 获取最近的通知
     */
    fun getRecentNotifications(limit: Int = 20): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.getRecentNotifications(limit)
            .asResult()
    }

    /**
     * 搜索通知
     */
    fun searchNotifications(query: String, limit: Int = 50): Flow<Result<List<NotificationEntity>>> {
        return notificationDao.searchNotifications(query, limit)
            .asResult()
    }

    // ===== 插入方法 =====

    /**
     * 创建通知
     */
    suspend fun createNotification(notification: NotificationEntity): Result<Unit> {
        return try {
            notificationDao.insert(notification)
            syncAdapter.value.syncNotificationCreated(notification)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 批量创建通知
     */
    suspend fun createNotifications(notifications: List<NotificationEntity>): Result<Unit> {
        return try {
            notificationDao.insertAll(notifications)
            notifications.forEach { syncAdapter.value.syncNotificationCreated(it) }
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 更新方法 =====

    /**
     * 更新通知
     */
    suspend fun updateNotification(notification: NotificationEntity): Result<Unit> {
        return try {
            notificationDao.update(notification)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 标记通知为已读
     */
    suspend fun markAsRead(id: String): Result<Unit> {
        return try {
            notificationDao.markAsRead(id)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 批量标记为已读
     */
    suspend fun markAsRead(ids: List<String>): Result<Unit> {
        return try {
            notificationDao.markAsRead(ids)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 标记通知为未读
     */
    suspend fun markAsUnread(id: String): Result<Unit> {
        return try {
            notificationDao.markAsUnread(id)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 标记所有通知为已读
     */
    suspend fun markAllAsRead(): Result<Unit> {
        return try {
            notificationDao.markAllAsRead()
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 标记指定类型的所有通知为已读
     */
    suspend fun markTypeAsRead(type: NotificationType): Result<Unit> {
        return try {
            notificationDao.markTypeAsRead(type)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 标记来自指定用户的通知为已读
     */
    suspend fun markActorNotificationsAsRead(actorDid: String): Result<Unit> {
        return try {
            notificationDao.markActorNotificationsAsRead(actorDid)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 标记与指定目标相关的通知为已读
     */
    suspend fun markTargetNotificationsAsRead(targetId: String): Result<Unit> {
        return try {
            notificationDao.markTargetNotificationsAsRead(targetId)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 删除方法 =====

    /**
     * 删除通知
     */
    suspend fun deleteNotification(id: String): Result<Unit> {
        return try {
            notificationDao.deleteById(id)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 批量删除通知
     */
    suspend fun deleteNotifications(ids: List<String>): Result<Unit> {
        return try {
            notificationDao.deleteByIds(ids)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除所有已读通知
     */
    suspend fun deleteAllRead(): Result<Unit> {
        return try {
            notificationDao.deleteAllRead()
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除指定类型的通知
     */
    suspend fun deleteByType(type: NotificationType): Result<Unit> {
        return try {
            notificationDao.deleteByType(type)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 清理旧通知
     */
    suspend fun cleanupOldNotifications(cutoffTime: Long): Result<Unit> {
        return try {
            notificationDao.cleanupOldNotifications(cutoffTime)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 清理已读的旧通知
     */
    suspend fun cleanupOldReadNotifications(cutoffTime: Long): Result<Unit> {
        return try {
            notificationDao.cleanupOldReadNotifications(cutoffTime)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除所有通知
     */
    suspend fun deleteAll(): Result<Unit> {
        return try {
            notificationDao.deleteAll()
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 统计方法 =====

    /**
     * 检查是否存在未读通知
     */
    suspend fun hasUnreadNotifications(): Result<Boolean> {
        return try {
            Result.Success(notificationDao.hasUnreadNotifications())
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 检查指定类型是否存在未读通知
     */
    suspend fun hasUnreadNotificationsOfType(type: NotificationType): Result<Boolean> {
        return try {
            Result.Success(notificationDao.hasUnreadNotificationsOfType(type))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 便捷方法 =====

    /**
     * 创建好友请求通知
     */
    suspend fun createFriendRequestNotification(
        fromDid: String,
        fromNickname: String
    ): Result<Unit> {
        val notification = NotificationEntity(
            id = "friend_request_${fromDid}_${System.currentTimeMillis()}",
            type = NotificationType.FRIEND_REQUEST,
            title = "新的好友请求",
            content = "$fromNickname 请求添加你为好友",
            actorDid = fromDid,
            createdAt = System.currentTimeMillis()
        )
        return createNotification(notification)
    }

    /**
     * 创建好友接受通知
     */
    suspend fun createFriendAcceptedNotification(
        fromDid: String,
        fromNickname: String
    ): Result<Unit> {
        val notification = NotificationEntity(
            id = "friend_accepted_${fromDid}_${System.currentTimeMillis()}",
            type = NotificationType.FRIEND_ACCEPTED,
            title = "好友请求已接受",
            content = "$fromNickname 接受了你的好友请求",
            actorDid = fromDid,
            createdAt = System.currentTimeMillis()
        )
        return createNotification(notification)
    }

    /**
     * 创建动态点赞通知
     */
    suspend fun createPostLikedNotification(
        postId: String,
        fromDid: String,
        fromNickname: String
    ): Result<Unit> {
        val notification = NotificationEntity(
            id = "post_liked_${postId}_${fromDid}_${System.currentTimeMillis()}",
            type = NotificationType.POST_LIKED,
            title = "动态被点赞",
            content = "$fromNickname 赞了你的动态",
            actorDid = fromDid,
            targetId = postId,
            createdAt = System.currentTimeMillis()
        )
        return createNotification(notification)
    }

    /**
     * 创建动态评论通知
     */
    suspend fun createPostCommentedNotification(
        postId: String,
        commentId: String,
        fromDid: String,
        fromNickname: String,
        commentContent: String
    ): Result<Unit> {
        val notification = NotificationEntity(
            id = "post_commented_${commentId}",
            type = NotificationType.POST_COMMENTED,
            title = "动态被评论",
            content = "$fromNickname 评论了你的动态: $commentContent",
            actorDid = fromDid,
            targetId = postId,
            createdAt = System.currentTimeMillis()
        )
        return createNotification(notification)
    }

    /**
     * 创建评论回复通知
     */
    suspend fun createCommentRepliedNotification(
        postId: String,
        commentId: String,
        replyId: String,
        fromDid: String,
        fromNickname: String,
        replyContent: String
    ): Result<Unit> {
        val notification = NotificationEntity(
            id = "comment_replied_${replyId}",
            type = NotificationType.COMMENT_REPLIED,
            title = "评论被回复",
            content = "$fromNickname 回复了你的评论: $replyContent",
            actorDid = fromDid,
            targetId = commentId,
            createdAt = System.currentTimeMillis()
        )
        return createNotification(notification)
    }

    /**
     * 创建被提及通知
     */
    suspend fun createPostMentionedNotification(
        postId: String,
        fromDid: String,
        fromNickname: String
    ): Result<Unit> {
        val notification = NotificationEntity(
            id = "post_mentioned_${postId}_${System.currentTimeMillis()}",
            type = NotificationType.POST_MENTIONED,
            title = "有人提到了你",
            content = "$fromNickname 在动态中提到了你",
            actorDid = fromDid,
            targetId = postId,
            createdAt = System.currentTimeMillis()
        )
        return createNotification(notification)
    }
}
