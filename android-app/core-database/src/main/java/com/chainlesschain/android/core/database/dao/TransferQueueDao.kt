package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.TransferQueueEntity
import kotlinx.coroutines.flow.Flow

/**
 * 传输队列DAO
 *
 * 提供队列管理所需的数据库操作
 */
@Dao
interface TransferQueueDao {

    /**
     * 插入队列项
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(queueItem: TransferQueueEntity): Long

    /**
     * 批量插入队列项
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(queueItems: List<TransferQueueEntity>)

    /**
     * 更新队列项
     */
    @Update
    suspend fun update(queueItem: TransferQueueEntity): Int

    /**
     * 根据transferId获取队列项
     */
    @Query("SELECT * FROM transfer_queue WHERE transferId = :transferId LIMIT 1")
    suspend fun getByTransferId(transferId: String): TransferQueueEntity?

    /**
     * 观察特定transferId的队列项
     */
    @Query("SELECT * FROM transfer_queue WHERE transferId = :transferId LIMIT 1")
    fun observeByTransferId(transferId: String): Flow<TransferQueueEntity?>

    /**
     * 获取所有队列项（按优先级和创建时间排序）
     */
    @Query("""
        SELECT * FROM transfer_queue
        ORDER BY
            CASE status
                WHEN 'TRANSFERRING' THEN 1
                WHEN 'QUEUED' THEN 2
                ELSE 3
            END,
            priority ASC,
            createdAt ASC
    """)
    suspend fun getAll(): List<TransferQueueEntity>

    /**
     * 观察所有队列项
     */
    @Query("""
        SELECT * FROM transfer_queue
        ORDER BY
            CASE status
                WHEN 'TRANSFERRING' THEN 1
                WHEN 'QUEUED' THEN 2
                ELSE 3
            END,
            priority ASC,
            createdAt ASC
    """)
    fun observeAll(): Flow<List<TransferQueueEntity>>

    /**
     * 获取排队中的项（按优先级排序）
     */
    @Query("""
        SELECT * FROM transfer_queue
        WHERE status = 'QUEUED'
        ORDER BY priority ASC, createdAt ASC
    """)
    suspend fun getQueued(): List<TransferQueueEntity>

    /**
     * 观察排队中的项
     */
    @Query("""
        SELECT * FROM transfer_queue
        WHERE status = 'QUEUED'
        ORDER BY priority ASC, createdAt ASC
    """)
    fun observeQueued(): Flow<List<TransferQueueEntity>>

    /**
     * 获取传输中的项
     */
    @Query("SELECT * FROM transfer_queue WHERE status = 'TRANSFERRING' ORDER BY startedAt ASC")
    suspend fun getTransferring(): List<TransferQueueEntity>

    /**
     * 观察传输中的项
     */
    @Query("SELECT * FROM transfer_queue WHERE status = 'TRANSFERRING' ORDER BY startedAt ASC")
    fun observeTransferring(): Flow<List<TransferQueueEntity>>

    /**
     * 获取已完成的项
     */
    @Query("""
        SELECT * FROM transfer_queue
        WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED')
        ORDER BY completedAt DESC
        LIMIT :limit
    """)
    suspend fun getCompleted(limit: Int = 50): List<TransferQueueEntity>

    /**
     * 观察已完成的项
     */
    @Query("""
        SELECT * FROM transfer_queue
        WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED')
        ORDER BY completedAt DESC
        LIMIT :limit
    """)
    fun observeCompleted(limit: Int = 50): Flow<List<TransferQueueEntity>>

    /**
     * 获取可重试的失败项
     */
    @Query("""
        SELECT * FROM transfer_queue
        WHERE status = 'FAILED' AND retryCount < 3
        ORDER BY updatedAt ASC
    """)
    suspend fun getRetryable(): List<TransferQueueEntity>

    /**
     * 根据peerId获取队列项
     */
    @Query("""
        SELECT * FROM transfer_queue
        WHERE peerId = :peerId
        ORDER BY createdAt DESC
    """)
    suspend fun getByPeer(peerId: String): List<TransferQueueEntity>

    /**
     * 获取出站队列项
     */
    @Query("""
        SELECT * FROM transfer_queue
        WHERE isOutgoing = 1
        ORDER BY createdAt DESC
    """)
    suspend fun getOutgoing(): List<TransferQueueEntity>

    /**
     * 获取入站队列项
     */
    @Query("""
        SELECT * FROM transfer_queue
        WHERE isOutgoing = 0
        ORDER BY createdAt DESC
    """)
    suspend fun getIncoming(): List<TransferQueueEntity>

    /**
     * 删除队列项
     */
    @Delete
    suspend fun delete(queueItem: TransferQueueEntity): Int

    /**
     * 根据transferId删除队列项
     */
    @Query("DELETE FROM transfer_queue WHERE transferId = :transferId")
    suspend fun deleteByTransferId(transferId: String): Int

    /**
     * 删除已完成的项（超过指定时间）
     */
    @Query("""
        DELETE FROM transfer_queue
        WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED')
        AND completedAt < :timestampMs
    """)
    suspend fun deleteCompletedBefore(timestampMs: Long): Int

    /**
     * 清空所有队列项
     */
    @Query("DELETE FROM transfer_queue")
    suspend fun deleteAll(): Int

    /**
     * 获取队列统计
     */
    @Query("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) as queued,
            SUM(CASE WHEN status = 'TRANSFERRING' THEN 1 ELSE 0 END) as transferring,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
        FROM transfer_queue
    """)
    suspend fun getStatistics(): QueueStatistics

    /**
     * 获取队列长度（排队+传输中）
     */
    @Query("""
        SELECT COUNT(*) FROM transfer_queue
        WHERE status IN ('QUEUED', 'TRANSFERRING')
    """)
    suspend fun getActiveCount(): Int

    /**
     * 获取传输中的数量
     */
    @Query("SELECT COUNT(*) FROM transfer_queue WHERE status = 'TRANSFERRING'")
    suspend fun getTransferringCount(): Int

    /**
     * 获取排队中的数量
     */
    @Query("SELECT COUNT(*) FROM transfer_queue WHERE status = 'QUEUED'")
    suspend fun getQueuedCount(): Int

    /**
     * 检查transferId是否存在
     */
    @Query("SELECT EXISTS(SELECT 1 FROM transfer_queue WHERE transferId = :transferId LIMIT 1)")
    suspend fun exists(transferId: String): Boolean

    /**
     * 更新队列项状态
     */
    @Query("""
        UPDATE transfer_queue
        SET status = :status,
            updatedAt = :updatedAt,
            startedAt = CASE WHEN :status = 'TRANSFERRING' AND startedAt IS NULL THEN :updatedAt ELSE startedAt END,
            completedAt = CASE WHEN :status IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN :updatedAt ELSE completedAt END
        WHERE transferId = :transferId
    """)
    suspend fun updateStatus(transferId: String, status: String, updatedAt: Long = System.currentTimeMillis()): Int
}

/**
 * 队列统计数据类
 */
data class QueueStatistics(
    val total: Int,
    val queued: Int,
    val transferring: Int,
    val completed: Int,
    val failed: Int
)
