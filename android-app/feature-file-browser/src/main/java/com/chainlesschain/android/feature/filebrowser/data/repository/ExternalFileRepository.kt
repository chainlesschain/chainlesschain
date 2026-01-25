package com.chainlesschain.android.feature.filebrowser.data.repository

import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 外部文件仓库
 *
 * 提供外部文件的搜索、分类、统计功能
 */
@Singleton
class ExternalFileRepository @Inject constructor(
    private val externalFileDao: ExternalFileDao
) {

    /**
     * 搜索文件
     *
     * @param query 搜索关键词
     * @param category 文件分类（可选）
     * @param limit 返回数量限制
     * @return 文件列表Flow
     */
    fun searchFiles(
        query: String,
        category: FileCategory? = null,
        limit: Int = 50
    ): Flow<List<ExternalFileEntity>> {
        return if (category != null) {
            externalFileDao.searchFilesByCategory(category, query, limit)
        } else {
            externalFileDao.searchFiles(query, limit)
        }
    }

    /**
     * 获取最近的文件
     *
     * @param categories 文件分类列表
     * @param limit 返回数量限制
     * @return 文件列表
     */
    suspend fun getRecentFiles(
        categories: List<FileCategory>,
        limit: Int = 20
    ): List<ExternalFileEntity> {
        // Get recent files from the last 30 days
        val thirtyDaysAgo = System.currentTimeMillis() - (30 * 24 * 60 * 60 * 1000L)

        return categories.flatMap { category ->
            externalFileDao.getRecentFilesByCategory(
                category = category,
                fromTimestamp = thirtyDaysAgo,
                limit = limit / categories.size
            ).first()
        }.sortedByDescending { it.lastModified }
            .take(limit)
    }

    /**
     * 根据ID获取文件
     *
     * @param fileId 文件ID
     * @return 文件实体，如果不存在则返回null
     */
    suspend fun getById(fileId: String): ExternalFileEntity? {
        return externalFileDao.getById(fileId)
    }

    /**
     * 根据分类获取文件
     *
     * @param category 文件分类
     * @param limit 返回数量限制
     * @param offset 偏移量
     * @return 文件列表Flow
     */
    fun getFilesByCategory(
        category: FileCategory,
        limit: Int = 50,
        offset: Int = 0
    ): Flow<List<ExternalFileEntity>> {
        return externalFileDao.getFilesByCategory(category, limit, offset)
    }

    /**
     * 获取所有文件
     *
     * @param limit 返回数量限制
     * @param offset 偏移量
     * @return 文件列表Flow
     */
    fun getAllFiles(limit: Int = 50, offset: Int = 0): Flow<List<ExternalFileEntity>> {
        return externalFileDao.getAllFiles(limit, offset)
    }

    /**
     * 获取收藏文件
     *
     * @return 收藏文件列表Flow
     */
    fun getFavoriteFiles(): Flow<List<ExternalFileEntity>> {
        return externalFileDao.getFavoriteFiles()
    }

    /**
     * 切换收藏状态
     *
     * @param fileId 文件ID
     * @return 切换后的收藏状态
     */
    suspend fun toggleFavorite(fileId: String): Boolean {
        val file = externalFileDao.getById(fileId) ?: return false
        val newStatus = !file.isFavorite
        externalFileDao.updateFavorite(fileId, newStatus)
        return newStatus
    }

    /**
     * 更新文件分类
     *
     * @param fileId 文件ID
     * @param newCategory 新的文件分类
     */
    suspend fun updateFileCategory(fileId: String, newCategory: FileCategory) {
        externalFileDao.updateCategory(fileId, newCategory)
    }

    /**
     * 获取文件总数
     */
    suspend fun getFilesCount(): Int {
        return externalFileDao.getFileCount()
    }

    /**
     * 获取总文件大小
     */
    suspend fun getTotalSize(): Long {
        return externalFileDao.getTotalSize() ?: 0L
    }

    /**
     * 获取指定分类的文件数量
     */
    suspend fun getFileCountByCategory(category: FileCategory): Int {
        return externalFileDao.getFileCountByCategory(category)
    }

    /**
     * 观察文件变化
     */
    fun observeFileChanges(): Flow<Unit> {
        // 返回一个Flow，当文件有变化时发射事件
        return kotlinx.coroutines.flow.flow {
            // 简单实现：定期检查
            // 实际可以使用ContentObserver监听MediaStore变化
            emit(Unit)
        }
    }

    /**
     * 删除所有文件记录
     */
    suspend fun deleteAll() {
        externalFileDao.deleteAll()
    }
}
