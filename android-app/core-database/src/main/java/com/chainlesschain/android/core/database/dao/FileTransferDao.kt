package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.FileTransferEntity
import kotlinx.coroutines.flow.Flow

/**
 * 文件传输数据访问对象
 */
@Dao
interface FileTransferDao {

    // ===== 查询方法 =====

    /**
     * 根据ID获取传输记录
     */
    @Query("SELECT * FROM file_transfers WHERE id = :transferId")
    suspend fun getById(transferId: String): FileTransferEntity?

    /**
     * 根据ID获取传输记录（Flow）
     */
    @Query("SELECT * FROM file_transfers WHERE id = :transferId")
    fun observeById(transferId: String): Flow<FileTransferEntity?>

    /**
     * 获取与指定设备的所有传输记录（按时间倒序）
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE peerId = :peerId
        ORDER BY createdAt DESC
    """)
    fun getByPeer(peerId: String): Flow<List<FileTransferEntity>>

    /**
     * 获取与指定设备的传输记录（分页）
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE peerId = :peerId
        ORDER BY createdAt DESC
        LIMIT :limit OFFSET :offset
    """)
    suspend fun getByPeerPaged(peerId: String, limit: Int, offset: Int): List<FileTransferEntity>

    /**
     * 获取所有传输记录（按时间倒序）
     */
    @Query("""
        SELECT * FROM file_transfers
        ORDER BY createdAt DESC
    """)
    fun getAll(): Flow<List<FileTransferEntity>>

    /**
     * 获取所有传输记录（分页）
     */
    @Query("""
        SELECT * FROM file_transfers
        ORDER BY createdAt DESC
        LIMIT :limit OFFSET :offset
    """)
    suspend fun getAllPaged(limit: Int, offset: Int): List<FileTransferEntity>

    /**
     * 获取活跃的传输记录（非终态）
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE status IN ('PENDING', 'REQUESTING', 'TRANSFERRING', 'PAUSED')
        ORDER BY createdAt DESC
    """)
    fun getActive(): Flow<List<FileTransferEntity>>

    /**
     * 获取与指定设备的活跃传输
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE peerId = :peerId
          AND status IN ('PENDING', 'REQUESTING', 'TRANSFERRING', 'PAUSED')
        ORDER BY createdAt DESC
    """)
    fun getActiveByPeer(peerId: String): Flow<List<FileTransferEntity>>

    /**
     * 获取待处理的入站传输请求
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE isOutgoing = 0
          AND status = 'REQUESTING'
        ORDER BY createdAt ASC
    """)
    fun getPendingIncomingRequests(): Flow<List<FileTransferEntity>>

    /**
     * 获取与指定设备的待处理入站请求
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE peerId = :peerId
          AND isOutgoing = 0
          AND status = 'REQUESTING'
        ORDER BY createdAt ASC
    """)
    fun getPendingRequestsByPeer(peerId: String): Flow<List<FileTransferEntity>>

    /**
     * 获取已完成的传输记录
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE status = 'COMPLETED'
        ORDER BY completedAt DESC
    """)
    fun getCompleted(): Flow<List<FileTransferEntity>>

    /**
     * 获取失败的传输记录（可重试）
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE status IN ('FAILED', 'CANCELLED')
        ORDER BY updatedAt DESC
    """)
    fun getFailed(): Flow<List<FileTransferEntity>>

    /**
     * 获取暂停的传输记录
     */
    @Query("""
        SELECT * FROM file_transfers
        WHERE status = 'PAUSED'
        ORDER BY updatedAt DESC
    """)
    fun getPaused(): Flow<List<FileTransferEntity>>

    /**
     * 统计活跃传输数量
     */
    @Query("""
        SELECT COUNT(*) FROM file_transfers
        WHERE status IN ('PENDING', 'REQUESTING', 'TRANSFERRING', 'PAUSED')
    """)
    suspend fun countActive(): Int

    /**
     * 统计与设备的活跃传输数量
     */
    @Query("""
        SELECT COUNT(*) FROM file_transfers
        WHERE peerId = :peerId
          AND status IN ('PENDING', 'REQUESTING', 'TRANSFERRING', 'PAUSED')
    """)
    suspend fun countActiveByPeer(peerId: String): Int

    // ===== 插入方法 =====

    /**
     * 插入传输记录
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(transfer: FileTransferEntity): Long

    /**
     * 批量插入传输记录
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(transfers: List<FileTransferEntity>)

    // ===== 更新方法 =====

    /**
     * 更新传输记录
     */
    @Update
    suspend fun update(transfer: FileTransferEntity)

    /**
     * 更新传输状态
     */
    @Query("""
        UPDATE file_transfers
        SET status = :status, updatedAt = :updatedAt
        WHERE id = :transferId
    """)
    suspend fun updateStatus(transferId: String, status: String, updatedAt: Long = System.currentTimeMillis())

    /**
     * 更新传输进度
     */
    @Query("""
        UPDATE file_transfers
        SET completedChunks = :completedChunks,
            bytesTransferred = :bytesTransferred,
            updatedAt = :updatedAt
        WHERE id = :transferId
    """)
    suspend fun updateProgress(
        transferId: String,
        completedChunks: Int,
        bytesTransferred: Long,
        updatedAt: Long = System.currentTimeMillis()
    )

    /**
     * 标记传输完成
     */
    @Query("""
        UPDATE file_transfers
        SET status = 'COMPLETED',
            completedChunks = totalChunks,
            bytesTransferred = fileSize,
            localFilePath = :localFilePath,
            tempFilePath = NULL,
            completedAt = :completedAt,
            updatedAt = :completedAt
        WHERE id = :transferId
    """)
    suspend fun markCompleted(
        transferId: String,
        localFilePath: String?,
        completedAt: Long = System.currentTimeMillis()
    )

    /**
     * 标记传输失败
     */
    @Query("""
        UPDATE file_transfers
        SET status = 'FAILED',
            errorMessage = :errorMessage,
            retryCount = retryCount + 1,
            updatedAt = :updatedAt
        WHERE id = :transferId
    """)
    suspend fun markFailed(
        transferId: String,
        errorMessage: String?,
        updatedAt: Long = System.currentTimeMillis()
    )

    /**
     * 重置重试计数
     */
    @Query("""
        UPDATE file_transfers
        SET retryCount = 0,
            errorMessage = NULL,
            updatedAt = :updatedAt
        WHERE id = :transferId
    """)
    suspend fun resetRetryCount(transferId: String, updatedAt: Long = System.currentTimeMillis())

    // ===== 删除方法 =====

    /**
     * 删除传输记录
     */
    @Delete
    suspend fun delete(transfer: FileTransferEntity)

    /**
     * 根据ID删除传输记录
     */
    @Query("DELETE FROM file_transfers WHERE id = :transferId")
    suspend fun deleteById(transferId: String)

    /**
     * 删除与指定设备的所有传输记录
     */
    @Query("DELETE FROM file_transfers WHERE peerId = :peerId")
    suspend fun deleteByPeer(peerId: String)

    /**
     * 删除已完成且过期的传输记录
     */
    @Query("""
        DELETE FROM file_transfers
        WHERE status = 'COMPLETED'
          AND completedAt < :cutoffTime
    """)
    suspend fun deleteOldCompleted(cutoffTime: Long)

    /**
     * 删除终态的传输记录（保留最近N条）
     */
    @Query("""
        DELETE FROM file_transfers
        WHERE id NOT IN (
            SELECT id FROM file_transfers
            WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED')
            ORDER BY updatedAt DESC
            LIMIT :keepCount
        )
        AND status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED')
    """)
    suspend fun deleteOldTerminal(keepCount: Int = 100)

    /**
     * 清理所有已完成的传输记录
     */
    @Query("DELETE FROM file_transfers WHERE status = 'COMPLETED'")
    suspend fun clearCompleted()

    /**
     * 清理所有失败的传输记录
     */
    @Query("DELETE FROM file_transfers WHERE status IN ('FAILED', 'CANCELLED', 'REJECTED')")
    suspend fun clearFailed()
}
