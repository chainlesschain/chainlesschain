package com.chainlesschain.android.feature.knowledge.data.repository

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import androidx.paging.map
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeItem
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeType
import com.chainlesschain.android.feature.knowledge.domain.model.SyncStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 知识库仓库
 *
 * 负责知识库CRUD操作和数据转换
 */
@Singleton
class KnowledgeRepository @Inject constructor(
    private val knowledgeItemDao: KnowledgeItemDao
) {

    companion object {
        private const val PAGE_SIZE = 20
        private val json = Json { ignoreUnknownKeys = true }
    }

    /**
     * 获取所有知识库条目（分页）
     */
    fun getItems(): Flow<PagingData<KnowledgeItem>> {
        return Pager(
            config = PagingConfig(
                pageSize = PAGE_SIZE,
                enablePlaceholders = false,
                prefetchDistance = 5
            ),
            pagingSourceFactory = { knowledgeItemDao.getItems() }
        ).flow.map { pagingData ->
            pagingData.map { entity -> entity.toDomainModel() }
        }
    }

    /**
     * 根据文件夹获取条目（分页）
     */
    fun getItemsByFolder(folderId: String): Flow<PagingData<KnowledgeItem>> {
        return Pager(
            config = PagingConfig(pageSize = PAGE_SIZE, enablePlaceholders = false),
            pagingSourceFactory = { knowledgeItemDao.getItemsByFolder(folderId) }
        ).flow.map { pagingData ->
            pagingData.map { entity -> entity.toDomainModel() }
        }
    }

    /**
     * 获取收藏条目（分页）
     */
    fun getFavoriteItems(): Flow<PagingData<KnowledgeItem>> {
        return Pager(
            config = PagingConfig(pageSize = PAGE_SIZE, enablePlaceholders = false),
            pagingSourceFactory = { knowledgeItemDao.getFavoriteItems() }
        ).flow.map { pagingData ->
            pagingData.map { entity -> entity.toDomainModel() }
        }
    }

    /**
     * 搜索知识库条目（分页）
     * 使用FTS4全文搜索提供高性能搜索
     */
    fun searchItems(query: String): Flow<PagingData<KnowledgeItem>> {
        return Pager(
            config = PagingConfig(pageSize = PAGE_SIZE, enablePlaceholders = false),
            pagingSourceFactory = { knowledgeItemDao.searchItems(query) }
        ).flow.map { pagingData ->
            pagingData.map { entity -> entity.toDomainModel() }
        }
    }

    /**
     * 根据ID获取条目
     */
    fun getItemById(id: String): Flow<KnowledgeItem?> {
        return knowledgeItemDao.getItemById(id).map { entity ->
            entity?.toDomainModel()
        }
    }

    /**
     * 创建新条目
     */
    suspend fun createItem(
        title: String,
        content: String,
        type: KnowledgeType = KnowledgeType.NOTE,
        folderId: String? = null,
        tags: List<String> = emptyList(),
        deviceId: String
    ): Result<KnowledgeItem> {
        return try {
            val entity = KnowledgeItemEntity(
                id = UUID.randomUUID().toString(),
                title = title,
                content = content,
                type = type.value,
                folderId = folderId,
                deviceId = deviceId,
                tags = if (tags.isNotEmpty()) json.encodeToString(tags) else null,
                createdAt = System.currentTimeMillis(),
                updatedAt = System.currentTimeMillis()
            )

            knowledgeItemDao.insert(entity)
            Result.success(entity.toDomainModel())
        } catch (e: Exception) {
            Result.error(e, "创建知识库条目失败")
        }
    }

    /**
     * 更新条目
     */
    suspend fun updateItem(
        id: String,
        title: String,
        content: String,
        tags: List<String> = emptyList()
    ): Result<Unit> {
        return try {
            // 先获取原条目（直接按ID查询）
            val entity = knowledgeItemDao.getItemById(id).first()
                ?: return Result.error(IllegalArgumentException(), "条目不存在")

            // 更新
            val updatedEntity = entity.copy(
                title = title,
                content = content,
                tags = if (tags.isNotEmpty()) json.encodeToString(tags) else null,
                updatedAt = System.currentTimeMillis(),
                syncStatus = "pending"
            )

            knowledgeItemDao.update(updatedEntity)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "更新知识库条目失败")
        }
    }

    /**
     * 切换收藏状态
     */
    suspend fun toggleFavorite(id: String): Result<Unit> {
        return try {
            val items = knowledgeItemDao.getItemsList(limit = 1, offset = 0)
            val entity = items.firstOrNull { it.id == id }
                ?: return Result.error(IllegalArgumentException(), "条目不存在")

            val updated = entity.copy(
                isFavorite = !entity.isFavorite,
                updatedAt = System.currentTimeMillis()
            )

            knowledgeItemDao.update(updated)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "更新收藏状态失败")
        }
    }

    /**
     * 切换置顶状态
     */
    suspend fun togglePinned(id: String): Result<Unit> {
        return try {
            val items = knowledgeItemDao.getItemsList(limit = 1, offset = 0)
            val entity = items.firstOrNull { it.id == id }
                ?: return Result.error(IllegalArgumentException(), "条目不存在")

            val updated = entity.copy(
                isPinned = !entity.isPinned,
                updatedAt = System.currentTimeMillis()
            )

            knowledgeItemDao.update(updated)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "更新置顶状态失败")
        }
    }

    /**
     * 删除条目（软删除）
     */
    suspend fun deleteItem(id: String): Result<Unit> {
        return try {
            knowledgeItemDao.softDelete(id)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "删除知识库条目失败")
        }
    }

    /**
     * 实体转领域模型
     */
    private fun KnowledgeItemEntity.toDomainModel(): KnowledgeItem {
        return KnowledgeItem(
            id = id,
            title = title,
            content = content,
            type = KnowledgeType.fromValue(type),
            folderId = folderId,
            createdAt = createdAt,
            updatedAt = updatedAt,
            syncStatus = SyncStatus.fromValue(syncStatus),
            deviceId = deviceId,
            isDeleted = isDeleted,
            tags = tags?.let {
                try {
                    json.decodeFromString<List<String>>(it)
                } catch (e: Exception) {
                    emptyList()
                }
            } ?: emptyList(),
            isFavorite = isFavorite,
            isPinned = isPinned
        )
    }
}
