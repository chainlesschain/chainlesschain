package com.chainlesschain.android.remote.data

import androidx.paging.PagingSource
import androidx.room.*
import kotlinx.coroutines.flow.Flow

/**
 * 文件传输 DAO
 */
@Dao
interface FileTransferDao {

    /**
     * 插入传输任务
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(transfer: FileTransferEntity): Long

    /**
     * 插入多个传输任务
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(transfers: List<FileTransferEntity>)

    /**
     * 更新传输任务
     */
    @Update
    suspend fun update(transfer: FileTransferEntity)

    /**
     * 删除传输任务
     */
    @Delete
    suspend fun delete(transfer: FileTransferEntity)

    /**
     * 删除所有传输任务
     */
    @Query("DELETE FROM file_transfers")
    suspend fun deleteAll()

    /**
     * 根据 ID 获取传输任务
     */
    @Query("SELECT * FROM file_transfers WHERE id = :id")
    suspend fun getById(id: String): FileTransferEntity?

    /**
     * 根据 ID 获取传输任务（Flow）
     */
    @Query("SELECT * FROM file_transfers WHERE id = :id")
    fun getByIdFlow(id: String): Flow<FileTransferEntity?>

    /**
     * 获取所有传输任务（分页）
     */
    @Query("SELECT * FROM file_transfers ORDER BY createdAt DESC")
    fun getAllPaged(): PagingSource<Int, FileTransferEntity>

    /**
     * 获取最近的传输任务
     */
    @Query("SELECT * FROM file_transfers ORDER BY createdAt DESC LIMIT :limit")
    suspend fun getRecent(limit: Int = 20): List<FileTransferEntity>

    /**
     * 获取最近的传输任务（Flow）
     */
    @Query("SELECT * FROM file_transfers ORDER BY createdAt DESC LIMIT :limit")
    fun getRecentFlow(limit: Int = 20): Flow<List<FileTransferEntity>>

    /**
     * 根据方向获取传输任务（分页）
     */
    @Query("SELECT * FROM file_transfers WHERE direction = :direction ORDER BY createdAt DESC")
    fun getByDirectionPaged(direction: TransferDirection): PagingSource<Int, FileTransferEntity>

    /**
     * 根据状态获取传输任务（分页）
     */
    @Query("SELECT * FROM file_transfers WHERE status = :status ORDER BY createdAt DESC")
    fun getByStatusPaged(status: TransferStatus): PagingSource<Int, FileTransferEntity>

    /**
     * 根据状态获取传输任务（Flow）
     */
    @Query("SELECT * FROM file_transfers WHERE status = :status ORDER BY createdAt DESC")
    fun getByStatusFlow(status: TransferStatus): Flow<List<FileTransferEntity>>

    /**
     * 获取进行中的传输任务
     */
    @Query("SELECT * FROM file_transfers WHERE status = 'IN_PROGRESS' OR status = 'PENDING'")
    suspend fun getActiveTransfers(): List<FileTransferEntity>

    /**
     * 获取进行中的传输任务（Flow）
     */
    @Query("SELECT * FROM file_transfers WHERE status = 'IN_PROGRESS' OR status = 'PENDING'")
    fun getActiveTransfersFlow(): Flow<List<FileTransferEntity>>

    /**
     * 搜索传输任务
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE fileName LIKE '%' || :query || '%'
        OR error LIKE '%' || :query || '%'
        ORDER BY createdAt DESC
    """)
    fun searchPaged(query: String): PagingSource<Int, FileTransferEntity>

    /**
     * 获取传输统计
     */
    @Query("SELECT COUNT(*) FROM file_transfers")
    suspend fun getCount(): Int

    @Query("SELECT COUNT(*) FROM file_transfers WHERE status = :status")
    suspend fun getCountByStatus(status: TransferStatus): Int

    @Query("SELECT COUNT(*) FROM file_transfers WHERE direction = :direction")
    suspend fun getCountByDirection(direction: TransferDirection): Int

    /**
     * 获取传输统计（Flow）
     */
    @Query("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as inProgress,
            SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN direction = 'UPLOAD' THEN 1 ELSE 0 END) as uploads,
            SUM(CASE WHEN direction = 'DOWNLOAD' THEN 1 ELSE 0 END) as downloads,
            SUM(fileSize) as totalBytes,
            SUM(bytesTransferred) as transferredBytes,
            AVG(speed) as avgSpeed
        FROM file_transfers
    """)
    fun getStatisticsFlow(): Flow<FileTransferStatistics>

    /**
     * 获取每日传输统计
     */
    @Query("""
        SELECT
            DATE(createdAt / 1000, 'unixepoch') as date,
            COUNT(*) as count,
            SUM(fileSize) as totalBytes
        FROM file_transfers
        WHERE createdAt >= :startTimestamp
        GROUP BY date
        ORDER BY date DESC
    """)
    suspend fun getDailyStatistics(startTimestamp: Long): List<DailyTransferStats>

    /**
     * 删除旧记录（保留最近 N 条）
     */
    @Query("""
        DELETE FROM file_transfers
        WHERE id NOT IN (
            SELECT id FROM file_transfers
            ORDER BY createdAt DESC
            LIMIT :keepCount
        )
    """)
    suspend fun deleteOldRecords(keepCount: Int = 1000)

    /**
     * 删除指定时间之前的记录
     */
    @Query("DELETE FROM file_transfers WHERE createdAt < :timestamp")
    suspend fun deleteBeforeTimestamp(timestamp: Long)

    /**
     * 删除已完成的传输（超过指定天数）
     */
    @Query("""
        DELETE FROM file_transfers
        WHERE status = 'COMPLETED'
        AND completedAt < :timestamp
    """)
    suspend fun deleteCompletedBefore(timestamp: Long)

    /**
     * 更新传输进度
     */
    @Query("""
        UPDATE file_transfers
        SET progress = :progress,
            bytesTransferred = :bytesTransferred,
            updatedAt = :updatedAt
        WHERE id = :id
    """)
    suspend fun updateProgress(
        id: String,
        progress: Double,
        bytesTransferred: Long,
        updatedAt: Long = System.currentTimeMillis()
    )

    /**
     * 更新传输状态
     */
    @Query("""
        UPDATE file_transfers
        SET status = :status,
            updatedAt = :updatedAt,
            error = :error
        WHERE id = :id
    """)
    suspend fun updateStatus(
        id: String,
        status: TransferStatus,
        error: String? = null,
        updatedAt: Long = System.currentTimeMillis()
    )

    /**
     * 标记传输完成
     */
    @Query("""
        UPDATE file_transfers
        SET status = 'COMPLETED',
            progress = 100.0,
            completedAt = :completedAt,
            updatedAt = :updatedAt,
            duration = :duration,
            speed = :speed
        WHERE id = :id
    """)
    suspend fun markCompleted(
        id: String,
        completedAt: Long = System.currentTimeMillis(),
        updatedAt: Long = System.currentTimeMillis(),
        duration: Long,
        speed: Double
    )
}

/**
 * 文件传输统计
 */
data class FileTransferStatistics(
    val total: Int,
    val completed: Int,
    val failed: Int,
    val inProgress: Int,
    val cancelled: Int,
    val uploads: Int,
    val downloads: Int,
    val totalBytes: Long,
    val transferredBytes: Long,
    val avgSpeed: Double
)

/**
 * 每日传输统计
 */
data class DailyTransferStats(
    val date: String,
    val count: Int,
    val totalBytes: Long
)
