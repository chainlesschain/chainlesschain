package com.chainlesschain.android.core.database.dao

import androidx.paging.PagingSource
import androidx.room.*
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import kotlinx.coroutines.flow.Flow

/**
 * 知识库条目数据访问对象
 */
@Dao
interface KnowledgeItemDao {

    /**
     * 获取所有知识库条目（分页）
     */
    @Query("""
        SELECT * FROM knowledge_items
        WHERE isDeleted = 0
        ORDER BY isPinned DESC, updatedAt DESC
    """)
    fun getItems(): PagingSource<Int, KnowledgeItemEntity>

    /**
     * 获取指定数量的条目（用于测试）
     */
    @Query("""
        SELECT * FROM knowledge_items
        WHERE isDeleted = 0
        ORDER BY updatedAt DESC
        LIMIT :limit OFFSET :offset
    """)
    suspend fun getItemsList(limit: Int, offset: Int): List<KnowledgeItemEntity>

    /**
     * 根据ID获取条目
     */
    @Query("SELECT * FROM knowledge_items WHERE id = :id AND isDeleted = 0")
    fun getItemById(id: String): Flow<KnowledgeItemEntity?>

    /**
     * 全文搜索（FTS5）
     * 使用FTS5虚拟表提供高性能全文搜索
     */
    @Query("""
        SELECT knowledge_items.* FROM knowledge_items
        INNER JOIN knowledge_items_fts ON knowledge_items.id = knowledge_items_fts.rowid
        WHERE knowledge_items_fts MATCH :query
        AND knowledge_items.isDeleted = 0
        ORDER BY rank
    """)
    fun searchItems(query: String): PagingSource<Int, KnowledgeItemEntity>

    /**
     * 简单搜索（LIKE查询，用于备用）
     */
    @Query("""
        SELECT * FROM knowledge_items
        WHERE isDeleted = 0
        AND (title LIKE '%' || :query || '%' OR content LIKE '%' || :query || '%')
        ORDER BY updatedAt DESC
    """)
    fun searchItemsSimple(query: String): PagingSource<Int, KnowledgeItemEntity>

    /**
     * 插入条目
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: KnowledgeItemEntity): Long

    /**
     * 批量插入
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<KnowledgeItemEntity>)

    /**
     * 更新条目
     */
    @Update
    suspend fun update(item: KnowledgeItemEntity)

    /**
     * 软删除条目
     */
    @Query("""
        UPDATE knowledge_items
        SET isDeleted = 1, updatedAt = :timestamp
        WHERE id = :id
    """)
    suspend fun softDelete(id: String, timestamp: Long = System.currentTimeMillis())

    /**
     * 硬删除条目
     */
    @Query("DELETE FROM knowledge_items WHERE id = :id")
    suspend fun hardDelete(id: String)

    /**
     * 获取收藏条目
     */
    @Query("""
        SELECT * FROM knowledge_items
        WHERE isDeleted = 0 AND isFavorite = 1
        ORDER BY updatedAt DESC
    """)
    fun getFavoriteItems(): PagingSource<Int, KnowledgeItemEntity>

    /**
     * 获取指定文件夹下的条目
     */
    @Query("""
        SELECT * FROM knowledge_items
        WHERE isDeleted = 0 AND folderId = :folderId
        ORDER BY isPinned DESC, updatedAt DESC
    """)
    fun getItemsByFolder(folderId: String): PagingSource<Int, KnowledgeItemEntity>

    /**
     * 获取需要同步的条目
     */
    @Query("""
        SELECT * FROM knowledge_items
        WHERE syncStatus = 'pending'
        LIMIT :limit
    """)
    suspend fun getPendingSyncItems(limit: Int = 100): List<KnowledgeItemEntity>

    /**
     * 更新同步状态
     */
    @Query("""
        UPDATE knowledge_items
        SET syncStatus = :status, updatedAt = :timestamp
        WHERE id = :id
    """)
    suspend fun updateSyncStatus(
        id: String,
        status: String,
        timestamp: Long = System.currentTimeMillis()
    )
}
