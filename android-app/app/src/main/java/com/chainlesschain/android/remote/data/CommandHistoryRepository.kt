package com.chainlesschain.android.remote.data

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 命令历史仓库
 */
@Singleton
class CommandHistoryRepository @Inject constructor(
    private val dao: CommandHistoryDao
) {

    /**
     * 插入命令历史
     */
    suspend fun insert(command: CommandHistoryEntity): Long {
        return dao.insert(command)
    }

    /**
     * 更新命令历史
     */
    suspend fun update(command: CommandHistoryEntity) {
        dao.update(command)
    }

    /**
     * 删除命令历史
     */
    suspend fun delete(command: CommandHistoryEntity) {
        dao.delete(command)
    }

    /**
     * 删除所有命令历史
     */
    suspend fun deleteAll() {
        dao.deleteAll()
    }

    /**
     * 根据 ID 获取命令历史
     */
    suspend fun getById(id: Long): CommandHistoryEntity? {
        return dao.getById(id)
    }

    /**
     * 获取所有命令历史（分页）
     */
    fun getAllPaged(): Flow<PagingData<CommandHistoryEntity>> {
        return Pager(
            config = PagingConfig(
                pageSize = 20,
                enablePlaceholders = false
            ),
            pagingSourceFactory = { dao.getAllPaged() }
        ).flow
    }

    /**
     * 获取最近的命令历史
     */
    fun getRecentFlow(limit: Int = 20): Flow<List<CommandHistoryEntity>> {
        return dao.getRecentFlow(limit)
    }

    /**
     * 根据命名空间获取命令历史
     */
    fun getByNamespacePaged(namespace: String): Flow<PagingData<CommandHistoryEntity>> {
        return Pager(
            config = PagingConfig(
                pageSize = 20,
                enablePlaceholders = false
            ),
            pagingSourceFactory = { dao.getByNamespacePaged(namespace) }
        ).flow
    }

    /**
     * 根据状态获取命令历史
     */
    fun getByStatusPaged(status: CommandStatus): Flow<PagingData<CommandHistoryEntity>> {
        return Pager(
            config = PagingConfig(
                pageSize = 20,
                enablePlaceholders = false
            ),
            pagingSourceFactory = { dao.getByStatusPaged(status) }
        ).flow
    }

    /**
     * 搜索命令历史
     */
    fun searchPaged(query: String): Flow<PagingData<CommandHistoryEntity>> {
        return Pager(
            config = PagingConfig(
                pageSize = 20,
                enablePlaceholders = false
            ),
            pagingSourceFactory = { dao.searchPaged(query) }
        ).flow
    }

    /**
     * 获取统计信息
     */
    fun getStatisticsFlow(): Flow<CommandStatistics> {
        return dao.getStatisticsFlow()
    }

    /**
     * 获取命令数量
     */
    suspend fun getCount(): Int {
        return dao.getCount()
    }

    /**
     * 清理旧记录
     */
    suspend fun cleanup(keepCount: Int = 1000) {
        dao.deleteOldRecords(keepCount)
    }

    /**
     * 删除指定时间之前的记录
     */
    suspend fun deleteBeforeTimestamp(timestamp: Long) {
        dao.deleteBeforeTimestamp(timestamp)
    }
}
