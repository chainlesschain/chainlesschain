package com.chainlesschain.android.remote.data

import androidx.paging.PagingSource
import androidx.room.*
import kotlinx.coroutines.flow.Flow

/**
 * 命令历史 DAO
 */
@Dao
interface CommandHistoryDao {

    /**
     * 插入命令历史
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(command: CommandHistoryEntity): Long

    /**
     * 插入多条命令历史
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(commands: List<CommandHistoryEntity>)

    /**
     * 更新命令历史
     */
    @Update
    suspend fun update(command: CommandHistoryEntity)

    /**
     * 删除命令历史
     */
    @Delete
    suspend fun delete(command: CommandHistoryEntity)

    /**
     * 删除所有命令历史
     */
    @Query("DELETE FROM command_history")
    suspend fun deleteAll()

    /**
     * 根据 ID 获取命令历史
     */
    @Query("SELECT * FROM command_history WHERE id = :id")
    suspend fun getById(id: Long): CommandHistoryEntity?

    /**
     * 获取所有命令历史（分页）
     */
    @Query("SELECT * FROM command_history ORDER BY timestamp DESC")
    fun getAllPaged(): PagingSource<Int, CommandHistoryEntity>

    /**
     * 获取最近的命令历史（Flow）
     */
    @Query("SELECT * FROM command_history ORDER BY timestamp DESC LIMIT :limit")
    fun getRecentFlow(limit: Int = 20): Flow<List<CommandHistoryEntity>>

    /**
     * 根据命名空间获取命令历史
     */
    @Query("SELECT * FROM command_history WHERE namespace = :namespace ORDER BY timestamp DESC")
    fun getByNamespacePaged(namespace: String): PagingSource<Int, CommandHistoryEntity>

    /**
     * 根据状态获取命令历史
     */
    @Query("SELECT * FROM command_history WHERE status = :status ORDER BY timestamp DESC")
    fun getByStatusPaged(status: CommandStatus): PagingSource<Int, CommandHistoryEntity>

    /**
     * 搜索命令历史
     */
    @Query("""
        SELECT * FROM command_history
        WHERE action LIKE '%' || :query || '%'
        OR namespace LIKE '%' || :query || '%'
        OR error LIKE '%' || :query || '%'
        ORDER BY timestamp DESC
    """)
    fun searchPaged(query: String): PagingSource<Int, CommandHistoryEntity>

    /**
     * 获取命令统计
     */
    @Query("SELECT COUNT(*) FROM command_history")
    suspend fun getCount(): Int

    @Query("SELECT COUNT(*) FROM command_history WHERE status = :status")
    suspend fun getCountByStatus(status: CommandStatus): Int

    @Query("SELECT COUNT(*) FROM command_history WHERE namespace = :namespace")
    suspend fun getCountByNamespace(namespace: String): Int

    /**
     * 获取统计信息（Flow）
     */
    @Query("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status = 'FAILURE' THEN 1 ELSE 0 END) as failure,
            AVG(duration) as avgDuration
        FROM command_history
    """)
    fun getStatisticsFlow(): Flow<CommandStatistics>

    /**
     * 删除旧记录（保留最近 N 条）
     */
    @Query("""
        DELETE FROM command_history
        WHERE id NOT IN (
            SELECT id FROM command_history
            ORDER BY timestamp DESC
            LIMIT :keepCount
        )
    """)
    suspend fun deleteOldRecords(keepCount: Int = 1000)

    /**
     * 删除指定时间之前的记录
     */
    @Query("DELETE FROM command_history WHERE timestamp < :timestamp")
    suspend fun deleteBeforeTimestamp(timestamp: Long)
}

/**
 * 命令统计
 */
data class CommandStatistics(
    val total: Int,
    val success: Int,
    val failure: Int,
    val avgDuration: Double
)
