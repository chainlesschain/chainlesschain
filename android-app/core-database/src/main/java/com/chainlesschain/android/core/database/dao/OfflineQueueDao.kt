package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.OfflineQueueEntity
import com.chainlesschain.android.core.database.entity.QueueStatus
import kotlinx.coroutines.flow.Flow

/**
 * 离线消息队列数据访问对象
 */
@Dao
interface OfflineQueueDao {

    // ===== 查询方法 =====

    /**
     * 获取指定设备的待发送消息
     */
    @Query("""
        SELECT * FROM offline_message_queue
        WHERE peerId = :peerId
          AND status IN ('PENDING', 'RETRYING')
        ORDER BY
            CASE priority
                WHEN 'HIGH' THEN 0
                WHEN 'NORMAL' THEN 1
                WHEN 'LOW' THEN 2
                ELSE 1
            END,
            createdAt ASC
    """)
    fun getPendingMessages(peerId: String): Flow<List<OfflineQueueEntity>>

    /**
     * 获取指定设备的待发送消息（同步）
     */
    @Query("""
        SELECT * FROM offline_message_queue
        WHERE peerId = :peerId
          AND status IN ('PENDING', 'RETRYING')
        ORDER BY
            CASE priority
                WHEN 'HIGH' THEN 0
                WHEN 'NORMAL' THEN 1
                WHEN 'LOW' THEN 2
                ELSE 1
            END,
            createdAt ASC
    """)
    suspend fun getPendingMessagesSync(peerId: String): List<OfflineQueueEntity>

    /**
     * 获取所有待发送消息
     */
    @Query("""
        SELECT * FROM offline_message_queue
        WHERE status IN ('PENDING', 'RETRYING')
        ORDER BY
            CASE priority
                WHEN 'HIGH' THEN 0
                WHEN 'NORMAL' THEN 1
                WHEN 'LOW' THEN 2
                ELSE 1
            END,
            createdAt ASC
    """)
    fun getAllPendingMessages(): Flow<List<OfflineQueueEntity>>

    /**
     * 获取所有待发送消息（同步）
     */
    @Query("""
        SELECT * FROM offline_message_queue
        WHERE status IN ('PENDING', 'RETRYING')
        ORDER BY
            CASE priority
                WHEN 'HIGH' THEN 0
                WHEN 'NORMAL' THEN 1
                WHEN 'LOW' THEN 2
                ELSE 1
            END,
            createdAt ASC
    """)
    suspend fun getAllPendingMessagesSync(): List<OfflineQueueEntity>

    /**
     * 获取需要重试的消息
     */
    @Query("""
        SELECT * FROM offline_message_queue
        WHERE status = 'RETRYING'
          AND (lastRetryAt IS NULL OR :now - lastRetryAt >= :minDelay)
        ORDER BY lastRetryAt ASC
    """)
    suspend fun getRetryReadyMessages(now: Long, minDelay: Long = 1000): List<OfflineQueueEntity>

    /**
     * 根据ID获取消息
     */
    @Query("SELECT * FROM offline_message_queue WHERE id = :messageId")
    suspend fun getMessageById(messageId: String): OfflineQueueEntity?

    /**
     * 获取过期消息
     */
    @Query("""
        SELECT * FROM offline_message_queue
        WHERE expiresAt IS NOT NULL
          AND expiresAt < :now
          AND status NOT IN ('SENT', 'EXPIRED')
    """)
    suspend fun getExpiredMessages(now: Long = System.currentTimeMillis()): List<OfflineQueueEntity>

    /**
     * 获取队列统计
     */
    @Query("""
        SELECT peerId, COUNT(*) as count
        FROM offline_message_queue
        WHERE status IN ('PENDING', 'RETRYING')
        GROUP BY peerId
    """)
    suspend fun getQueueStats(): List<PeerQueueCount>

    /**
     * 获取总待发送数量
     */
    @Query("""
        SELECT COUNT(*) FROM offline_message_queue
        WHERE status IN ('PENDING', 'RETRYING')
    """)
    fun getTotalPendingCount(): Flow<Int>

    // ===== 插入方法 =====

    /**
     * 插入消息
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(message: OfflineQueueEntity): Long

    /**
     * 批量插入消息
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(messages: List<OfflineQueueEntity>)

    // ===== 更新方法 =====

    /**
     * 更新消息
     */
    @Update
    suspend fun update(message: OfflineQueueEntity)

    /**
     * 更新消息状态
     */
    @Query("""
        UPDATE offline_message_queue
        SET status = :status, updatedAt = :updatedAt
        WHERE id = :messageId
    """)
    suspend fun updateStatus(
        messageId: String,
        status: String,
        updatedAt: Long = System.currentTimeMillis()
    )

    /**
     * 更新重试信息
     */
    @Query("""
        UPDATE offline_message_queue
        SET retryCount = retryCount + 1,
            lastRetryAt = :lastRetryAt,
            status = :status,
            updatedAt = :updatedAt
        WHERE id = :messageId
    """)
    suspend fun updateRetry(
        messageId: String,
        lastRetryAt: Long = System.currentTimeMillis(),
        status: String = QueueStatus.RETRYING,
        updatedAt: Long = System.currentTimeMillis()
    )

    /**
     * 标记为已发送
     */
    @Query("""
        UPDATE offline_message_queue
        SET status = 'SENT', updatedAt = :updatedAt
        WHERE id = :messageId
    """)
    suspend fun markAsSent(messageId: String, updatedAt: Long = System.currentTimeMillis())

    /**
     * 标记为失败
     */
    @Query("""
        UPDATE offline_message_queue
        SET status = 'FAILED', updatedAt = :updatedAt
        WHERE id = :messageId
    """)
    suspend fun markAsFailed(messageId: String, updatedAt: Long = System.currentTimeMillis())

    /**
     * 标记为过期
     */
    @Query("""
        UPDATE offline_message_queue
        SET status = 'EXPIRED', updatedAt = :updatedAt
        WHERE id = :messageId
    """)
    suspend fun markAsExpired(messageId: String, updatedAt: Long = System.currentTimeMillis())

    // ===== 删除方法 =====

    /**
     * 删除消息
     */
    @Delete
    suspend fun delete(message: OfflineQueueEntity)

    /**
     * 根据ID删除消息
     */
    @Query("DELETE FROM offline_message_queue WHERE id = :messageId")
    suspend fun deleteById(messageId: String)

    /**
     * 清空指定设备的队列
     */
    @Query("DELETE FROM offline_message_queue WHERE peerId = :peerId")
    suspend fun clearQueue(peerId: String)

    /**
     * 清空所有已发送的消息
     */
    @Query("DELETE FROM offline_message_queue WHERE status = 'SENT'")
    suspend fun clearSentMessages()

    /**
     * 清空所有过期的消息
     */
    @Query("DELETE FROM offline_message_queue WHERE status = 'EXPIRED'")
    suspend fun clearExpiredMessages()

    /**
     * 清空所有失败的消息
     */
    @Query("DELETE FROM offline_message_queue WHERE status = 'FAILED'")
    suspend fun clearFailedMessages()

    /**
     * 清空所有队列
     */
    @Query("DELETE FROM offline_message_queue")
    suspend fun clearAll()

    /**
     * 删除旧的已完成消息（保留最近N天）
     */
    @Query("""
        DELETE FROM offline_message_queue
        WHERE status IN ('SENT', 'FAILED', 'EXPIRED')
          AND updatedAt < :beforeTime
    """)
    suspend fun deleteOldCompletedMessages(beforeTime: Long)
}

/**
 * 设备队列计数
 */
data class PeerQueueCount(
    val peerId: String,
    val count: Int
)
