package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import kotlinx.coroutines.flow.Flow

/**
 * 外部文件数据访问对象
 */
@Dao
interface ExternalFileDao {

    // ===== 基础 CRUD =====

    @Query("SELECT * FROM external_files WHERE id = :fileId")
    suspend fun getById(fileId: String): ExternalFileEntity?

    @Query("SELECT * FROM external_files WHERE uri = :uri")
    suspend fun getByUri(uri: String): ExternalFileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(file: ExternalFileEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(files: List<ExternalFileEntity>): List<Long>

    @Update
    suspend fun update(file: ExternalFileEntity)

    @Delete
    suspend fun delete(file: ExternalFileEntity)

    @Query("DELETE FROM external_files WHERE id = :fileId")
    suspend fun deleteById(fileId: String)

    @Query("DELETE FROM external_files")
    suspend fun deleteAll()

    // ===== 分类查询 =====

    @Query("SELECT * FROM external_files WHERE category = :category ORDER BY lastModified DESC LIMIT :limit OFFSET :offset")
    fun getFilesByCategory(category: FileCategory, limit: Int = 50, offset: Int = 0): Flow<List<ExternalFileEntity>>

    @Query("SELECT * FROM external_files ORDER BY lastModified DESC LIMIT :limit OFFSET :offset")
    fun getAllFiles(limit: Int = 50, offset: Int = 0): Flow<List<ExternalFileEntity>>

    @Query("SELECT * FROM external_files WHERE isFavorite = 1 ORDER BY lastModified DESC")
    fun getFavoriteFiles(): Flow<List<ExternalFileEntity>>

    // ===== 搜索 =====

    @Query("""
        SELECT * FROM external_files
        WHERE displayName LIKE '%' || :query || '%'
           OR displayPath LIKE '%' || :query || '%'
           OR parentFolder LIKE '%' || :query || '%'
        ORDER BY lastModified DESC
        LIMIT :limit
    """)
    fun searchFiles(query: String, limit: Int = 50): Flow<List<ExternalFileEntity>>

    @Query("""
        SELECT * FROM external_files
        WHERE category = :category
          AND (displayName LIKE '%' || :query || '%'
               OR displayPath LIKE '%' || :query || '%'
               OR parentFolder LIKE '%' || :query || '%')
        ORDER BY lastModified DESC
        LIMIT :limit
    """)
    fun searchFilesByCategory(category: FileCategory, query: String, limit: Int = 50): Flow<List<ExternalFileEntity>>

    @Query("""
        SELECT * FROM external_files
        WHERE category IN (:categories)
          AND (displayName LIKE '%' || :query || '%'
               OR displayPath LIKE '%' || :query || '%')
        ORDER BY lastModified DESC
        LIMIT :limit
    """)
    fun searchFilesByCategories(categories: List<FileCategory>, query: String, limit: Int = 50): Flow<List<ExternalFileEntity>>

    // ===== 排序和过滤 =====

    @Query("SELECT * FROM external_files WHERE category = :category ORDER BY displayName ASC LIMIT :limit OFFSET :offset")
    fun getFilesByCategorySortedByName(category: FileCategory, limit: Int = 50, offset: Int = 0): Flow<List<ExternalFileEntity>>

    @Query("SELECT * FROM external_files WHERE category = :category ORDER BY size DESC LIMIT :limit OFFSET :offset")
    fun getFilesByCategorySortedBySize(category: FileCategory, limit: Int = 50, offset: Int = 0): Flow<List<ExternalFileEntity>>

    @Query("SELECT * FROM external_files WHERE category = :category AND lastModified >= :fromTimestamp ORDER BY lastModified DESC LIMIT :limit")
    fun getRecentFilesByCategory(category: FileCategory, fromTimestamp: Long, limit: Int = 50): Flow<List<ExternalFileEntity>>

    @Query("SELECT * FROM external_files WHERE lastModified >= :fromTimestamp ORDER BY lastModified DESC LIMIT :limit")
    fun getRecentFiles(fromTimestamp: Long, limit: Int = 50): Flow<List<ExternalFileEntity>>

    @Query("SELECT * FROM external_files WHERE size >= :minSize AND size <= :maxSize ORDER BY lastModified DESC LIMIT :limit")
    fun getFilesBySizeRange(minSize: Long, maxSize: Long, limit: Int = 50): Flow<List<ExternalFileEntity>>

    // ===== 统计查询 =====

    @Query("SELECT COUNT(*) FROM external_files")
    suspend fun getFileCount(): Int

    @Query("SELECT COUNT(*) FROM external_files WHERE category = :category")
    suspend fun getFileCountByCategory(category: FileCategory): Int

    @Query("SELECT SUM(size) FROM external_files")
    suspend fun getTotalSize(): Long?

    @Query("SELECT SUM(size) FROM external_files WHERE category = :category")
    suspend fun getTotalSizeByCategory(category: FileCategory): Long?

    @Query("SELECT category, COUNT(*) as count FROM external_files GROUP BY category")
    suspend fun getCountByCategory(): List<CategoryCount>

    @Query("SELECT COUNT(*) FROM external_files WHERE scannedAt >= :timestamp")
    suspend fun getNewFilesCount(timestamp: Long): Int

    // ===== 收藏操作 =====

    @Query("UPDATE external_files SET isFavorite = :isFavorite WHERE id = :fileId")
    suspend fun updateFavorite(fileId: String, isFavorite: Boolean)

    // ===== 批量操作 =====

    @Query("DELETE FROM external_files WHERE scannedAt < :timestamp")
    suspend fun deleteStaleFiles(timestamp: Long): Int

    @Query("UPDATE external_files SET scannedAt = :timestamp WHERE uri IN (:uris)")
    suspend fun updateScannedTime(uris: List<String>, timestamp: Long = System.currentTimeMillis())

    // ===== MIME类型查询 =====

    @Query("SELECT * FROM external_files WHERE mimeType = :mimeType ORDER BY lastModified DESC LIMIT :limit")
    fun getFilesByMimeType(mimeType: String, limit: Int = 50): Flow<List<ExternalFileEntity>>

    @Query("SELECT DISTINCT mimeType FROM external_files WHERE category = :category")
    suspend fun getMimeTypesByCategory(category: FileCategory): List<String>

    // ===== 路径相关查询 =====

    @Query("SELECT * FROM external_files WHERE parentFolder = :folderName ORDER BY displayName ASC")
    fun getFilesByFolder(folderName: String): Flow<List<ExternalFileEntity>>

    @Query("SELECT DISTINCT parentFolder FROM external_files WHERE parentFolder IS NOT NULL ORDER BY parentFolder ASC")
    suspend fun getAllFolders(): List<String>

    // ===== P2P文件同步支持 =====

    /**
     * 获取文件列表（支持分类过滤、增量同步）
     * 用于响应PC端的索引请求
     *
     * @param categories 文件分类列表（可选）
     * @param since 时间戳，仅返回此时间之后修改的文件（可选）
     * @param limit 返回数量限制
     * @param offset 偏移量
     * @return 文件列表
     */
    @Query("""
        SELECT * FROM external_files
        WHERE (:categories IS NULL OR category IN (:categories))
          AND (:since IS NULL OR :since = 0 OR lastModified >= :since)
        ORDER BY lastModified DESC
        LIMIT :limit OFFSET :offset
    """)
    suspend fun getFiles(
        categories: List<String>? = null,
        since: Long? = null,
        limit: Int = 500,
        offset: Int = 0
    ): List<ExternalFileEntity>

    /**
     * 获取文件总数（支持分类过滤、增量同步）
     * 用于计算分页总数
     *
     * @param categories 文件分类列表（可选）
     * @param since 时间戳，仅计算此时间之后修改的文件（可选）
     * @return 文件总数
     */
    @Query("""
        SELECT COUNT(*) FROM external_files
        WHERE (:categories IS NULL OR category IN (:categories))
          AND (:since IS NULL OR :since = 0 OR lastModified >= :since)
    """)
    suspend fun getCount(
        categories: List<String>? = null,
        since: Long? = null
    ): Int
}

/**
 * 分类统计数据类
 */
data class CategoryCount(
    val category: FileCategory,
    val count: Int
)
