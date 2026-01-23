package com.chainlesschain.android.core.database.dao.social

import androidx.room.*
import com.chainlesschain.android.core.database.entity.social.NotificationEntity
import com.chainlesschain.android.core.database.entity.social.NotificationType
import kotlinx.coroutines.flow.Flow

/**
 * 通知数据访问对象
 */
@Dao
interface NotificationDao {

    // ===== 查询方法 =====

    /**
     * 获取所有通知
     */
    @Query("SELECT * FROM notifications ORDER BY createdAt DESC")
    fun getAllNotifications(): Flow<List<NotificationEntity>>

    /**
     * 获取未读通知
     */
    @Query("SELECT * FROM notifications WHERE isRead = 0 ORDER BY createdAt DESC")
    fun getUnreadNotifications(): Flow<List<NotificationEntity>>

    /**
     * 获取指定类型的通知
     */
    @Query("SELECT * FROM notifications WHERE type = :type ORDER BY createdAt DESC")
    fun getNotificationsByType(type: NotificationType): Flow<List<NotificationEntity>>

    /**
     * 获取指定类型的未读通知
     */
    @Query("SELECT * FROM notifications WHERE type = :type AND isRead = 0 ORDER BY createdAt DESC")
    fun getUnreadNotificationsByType(type: NotificationType): Flow<List<NotificationEntity>>

    /**
     * 根据 ID 获取通知
     */
    @Query("SELECT * FROM notifications WHERE id = :id")
    suspend fun getNotificationById(id: String): NotificationEntity?

    /**
     * 根据 ID 获取通知（Flow）
     */
    @Query("SELECT * FROM notifications WHERE id = :id")
    fun observeNotificationById(id: String): Flow<NotificationEntity?>

    /**
     * 获取来自指定用户的通知
     */
    @Query("SELECT * FROM notifications WHERE actorDid = :actorDid ORDER BY createdAt DESC")
    fun getNotificationsByActor(actorDid: String): Flow<List<NotificationEntity>>

    /**
     * 获取与指定目标相关的通知
     */
    @Query("SELECT * FROM notifications WHERE targetId = :targetId ORDER BY createdAt DESC")
    fun getNotificationsByTarget(targetId: String): Flow<List<NotificationEntity>>

    /**
     * 获取未读通知数
     */
    @Query("SELECT COUNT(*) FROM notifications WHERE isRead = 0")
    fun getUnreadCount(): Flow<Int>

    /**
     * 获取指定类型的未读通知数
     */
    @Query("SELECT COUNT(*) FROM notifications WHERE type = :type AND isRead = 0")
    fun getUnreadCountByType(type: NotificationType): Flow<Int>

    /**
     * 获取总通知数
     */
    @Query("SELECT COUNT(*) FROM notifications")
    suspend fun getTotalCount(): Int

    /**
     * 分页获取通知
     */
    @Query("SELECT * FROM notifications ORDER BY createdAt DESC LIMIT :limit OFFSET :offset")
    fun getNotificationsPaged(limit: Int, offset: Int): Flow<List<NotificationEntity>>

    /**
     * 分页获取未读通知
     */
    @Query("SELECT * FROM notifications WHERE isRead = 0 ORDER BY createdAt DESC LIMIT :limit OFFSET :offset")
    fun getUnreadNotificationsPaged(limit: Int, offset: Int): Flow<List<NotificationEntity>>

    /**
     * 获取最近的通知（限制数量）
     */
    @Query("SELECT * FROM notifications ORDER BY createdAt DESC LIMIT :limit")
    fun getRecentNotifications(limit: Int = 20): Flow<List<NotificationEntity>>

    /**
     * 搜索通知
     */
    @Query("""
        SELECT * FROM notifications
        WHERE title LIKE '%' || :query || '%' OR content LIKE '%' || :query || '%'
        ORDER BY createdAt DESC
        LIMIT :limit
    """)
    fun searchNotifications(query: String, limit: Int = 50): Flow<List<NotificationEntity>>

    // ===== 插入方法 =====

    /**
     * 插入通知
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(notification: NotificationEntity)

    /**
     * 批量插入通知
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(notifications: List<NotificationEntity>)

    // ===== 更新方法 =====

    /**
     * 更新通知
     */
    @Update
    suspend fun update(notification: NotificationEntity)

    /**
     * 标记通知为已读
     */
    @Query("UPDATE notifications SET isRead = 1 WHERE id = :id")
    suspend fun markAsRead(id: String)

    /**
     * 标记多个通知为已读
     */
    @Query("UPDATE notifications SET isRead = 1 WHERE id IN (:ids)")
    suspend fun markAsRead(ids: List<String>)

    /**
     * 标记通知为未读
     */
    @Query("UPDATE notifications SET isRead = 0 WHERE id = :id")
    suspend fun markAsUnread(id: String)

    /**
     * 标记所有通知为已读
     */
    @Query("UPDATE notifications SET isRead = 1")
    suspend fun markAllAsRead()

    /**
     * 标记指定类型的所有通知为已读
     */
    @Query("UPDATE notifications SET isRead = 1 WHERE type = :type")
    suspend fun markTypeAsRead(type: NotificationType)

    /**
     * 标记来自指定用户的通知为已读
     */
    @Query("UPDATE notifications SET isRead = 1 WHERE actorDid = :actorDid")
    suspend fun markActorNotificationsAsRead(actorDid: String)

    /**
     * 标记与指定目标相关的通知为已读
     */
    @Query("UPDATE notifications SET isRead = 1 WHERE targetId = :targetId")
    suspend fun markTargetNotificationsAsRead(targetId: String)

    // ===== 删除方法 =====

    /**
     * 删除通知
     */
    @Delete
    suspend fun delete(notification: NotificationEntity)

    /**
     * 根据 ID 删除通知
     */
    @Query("DELETE FROM notifications WHERE id = :id")
    suspend fun deleteById(id: String)

    /**
     * 批量删除通知
     */
    @Query("DELETE FROM notifications WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    /**
     * 删除所有已读通知
     */
    @Query("DELETE FROM notifications WHERE isRead = 1")
    suspend fun deleteAllRead()

    /**
     * 删除指定类型的通知
     */
    @Query("DELETE FROM notifications WHERE type = :type")
    suspend fun deleteByType(type: NotificationType)

    /**
     * 删除来自指定用户的通知
     */
    @Query("DELETE FROM notifications WHERE actorDid = :actorDid")
    suspend fun deleteByActor(actorDid: String)

    /**
     * 删除与指定目标相关的通知
     */
    @Query("DELETE FROM notifications WHERE targetId = :targetId")
    suspend fun deleteByTarget(targetId: String)

    /**
     * 清理旧通知
     */
    @Query("DELETE FROM notifications WHERE createdAt < :cutoffTime")
    suspend fun cleanupOldNotifications(cutoffTime: Long)

    /**
     * 清理已读的旧通知
     */
    @Query("DELETE FROM notifications WHERE isRead = 1 AND createdAt < :cutoffTime")
    suspend fun cleanupOldReadNotifications(cutoffTime: Long)

    /**
     * 删除所有通知
     */
    @Query("DELETE FROM notifications")
    suspend fun deleteAll()

    // ===== 统计方法 =====

    /**
     * 获取各类型未读通知数的分组统计
     */
    @Query("""
        SELECT type, COUNT(*) as count
        FROM notifications
        WHERE isRead = 0
        GROUP BY type
    """)
    suspend fun getUnreadCountByTypeGrouped(): Map<NotificationType, Int>

    /**
     * 检查是否存在未读通知
     */
    @Query("SELECT COUNT(*) > 0 FROM notifications WHERE isRead = 0")
    suspend fun hasUnreadNotifications(): Boolean

    /**
     * 检查指定类型是否存在未读通知
     */
    @Query("SELECT COUNT(*) > 0 FROM notifications WHERE type = :type AND isRead = 0")
    suspend fun hasUnreadNotificationsOfType(type: NotificationType): Boolean
}
