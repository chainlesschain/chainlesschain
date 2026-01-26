package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.TransferCheckpointEntity
import kotlinx.coroutines.flow.Flow

/**
 * 传输断点DAO
 *
 * 提供断点续传所需的数据库操作
 */
@Dao
interface TransferCheckpointDao {

    /**
     * 插入或更新检查点
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(checkpoint: TransferCheckpointEntity): Long

    /**
     * 批量插入或更新检查点
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(checkpoints: List<TransferCheckpointEntity>)

    /**
     * 根据transferId获取检查点
     */
    @Query("SELECT * FROM transfer_checkpoints WHERE transferId = :transferId LIMIT 1")
    suspend fun getByTransferId(transferId: String): TransferCheckpointEntity?

    /**
     * 根据transferId获取检查点（Flow）
     */
    @Query("SELECT * FROM transfer_checkpoints WHERE transferId = :transferId LIMIT 1")
    fun observeByTransferId(transferId: String): Flow<TransferCheckpointEntity?>

    /**
     * 获取所有检查点
     */
    @Query("SELECT * FROM transfer_checkpoints ORDER BY updatedAt DESC")
    suspend fun getAll(): List<TransferCheckpointEntity>

    /**
     * 观察所有检查点
     */
    @Query("SELECT * FROM transfer_checkpoints ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<TransferCheckpointEntity>>

    /**
     * 获取可恢复的检查点（有部分分块但未完成）
     */
    @Query("""
        SELECT * FROM transfer_checkpoints
        WHERE receivedChunksJson != '[]'
        ORDER BY updatedAt DESC
    """)
    suspend fun getResumableCheckpoints(): List<TransferCheckpointEntity>

    /**
     * 观察可恢复的检查点
     */
    @Query("""
        SELECT * FROM transfer_checkpoints
        WHERE receivedChunksJson != '[]'
        ORDER BY updatedAt DESC
    """)
    fun observeResumableCheckpoints(): Flow<List<TransferCheckpointEntity>>

    /**
     * 根据peerId获取检查点
     */
    @Query("SELECT * FROM transfer_checkpoints WHERE peerId = :peerId ORDER BY updatedAt DESC")
    suspend fun getByPeerId(peerId: String): List<TransferCheckpointEntity>

    /**
     * 获取出站检查点
     */
    @Query("SELECT * FROM transfer_checkpoints WHERE isOutgoing = 1 ORDER BY updatedAt DESC")
    suspend fun getOutgoingCheckpoints(): List<TransferCheckpointEntity>

    /**
     * 获取入站检查点
     */
    @Query("SELECT * FROM transfer_checkpoints WHERE isOutgoing = 0 ORDER BY updatedAt DESC")
    suspend fun getIncomingCheckpoints(): List<TransferCheckpointEntity>

    /**
     * 更新检查点（部分字段）
     */
    @Update
    suspend fun update(checkpoint: TransferCheckpointEntity): Int

    /**
     * 删除检查点
     */
    @Delete
    suspend fun delete(checkpoint: TransferCheckpointEntity): Int

    /**
     * 根据transferId删除检查点
     */
    @Query("DELETE FROM transfer_checkpoints WHERE transferId = :transferId")
    suspend fun deleteByTransferId(transferId: String): Int

    /**
     * 删除指定时间之前的旧检查点
     */
    @Query("DELETE FROM transfer_checkpoints WHERE updatedAt < :timestampMs")
    suspend fun deleteOlderThan(timestampMs: Long): Int

    /**
     * 清空所有检查点
     */
    @Query("DELETE FROM transfer_checkpoints")
    suspend fun deleteAll(): Int

    /**
     * 获取检查点总数
     */
    @Query("SELECT COUNT(*) FROM transfer_checkpoints")
    suspend fun getCount(): Int

    /**
     * 获取可恢复检查点总数
     */
    @Query("""
        SELECT COUNT(*) FROM transfer_checkpoints
        WHERE receivedChunksJson != '[]'
    """)
    suspend fun getResumableCount(): Int

    /**
     * 检查transferId是否存在检查点
     */
    @Query("SELECT EXISTS(SELECT 1 FROM transfer_checkpoints WHERE transferId = :transferId LIMIT 1)")
    suspend fun exists(transferId: String): Boolean

    /**
     * 获取特定peer的检查点数量
     */
    @Query("SELECT COUNT(*) FROM transfer_checkpoints WHERE peerId = :peerId")
    suspend fun getCountByPeer(peerId: String): Int
}
