package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.FileImportHistoryEntity
import com.chainlesschain.android.core.database.entity.ImportSource
import com.chainlesschain.android.core.database.entity.ImportType
import kotlinx.coroutines.flow.Flow

/**
 * 文件导入历史数据访问对象
 */
@Dao
interface FileImportHistoryDao {

    // ===== 基础 CRUD =====

    @Query("SELECT * FROM file_import_history WHERE id = :historyId")
    suspend fun getById(historyId: String): FileImportHistoryEntity?

    @Query("SELECT * FROM file_import_history WHERE projectFileId = :projectFileId")
    suspend fun getByProjectFileId(projectFileId: String): FileImportHistoryEntity?

    @Query("SELECT * FROM file_import_history WHERE sourceUri = :sourceUri")
    suspend fun getBySourceUri(sourceUri: String): List<FileImportHistoryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(history: FileImportHistoryEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(histories: List<FileImportHistoryEntity>): List<Long>

    @Update
    suspend fun update(history: FileImportHistoryEntity)

    @Delete
    suspend fun delete(history: FileImportHistoryEntity)

    @Query("DELETE FROM file_import_history WHERE id = :historyId")
    suspend fun deleteById(historyId: String)

    // ===== 项目相关查询 =====

    @Query("SELECT * FROM file_import_history WHERE projectId = :projectId ORDER BY importedAt DESC")
    fun getByProject(projectId: String): Flow<List<FileImportHistoryEntity>>

    @Query("SELECT * FROM file_import_history WHERE projectId = :projectId ORDER BY importedAt DESC LIMIT :limit")
    suspend fun getRecentByProject(projectId: String, limit: Int = 20): List<FileImportHistoryEntity>

    @Query("SELECT COUNT(*) FROM file_import_history WHERE projectId = :projectId")
    suspend fun getCountByProject(projectId: String): Int

    @Query("SELECT SUM(sourceFileSize) FROM file_import_history WHERE projectId = :projectId")
    suspend fun getTotalSizeByProject(projectId: String): Long?

    // ===== 导入类型查询 =====

    @Query("SELECT * FROM file_import_history WHERE importType = :importType ORDER BY importedAt DESC")
    fun getByImportType(importType: ImportType): Flow<List<FileImportHistoryEntity>>

    @Query("SELECT * FROM file_import_history WHERE projectId = :projectId AND importType = :importType ORDER BY importedAt DESC")
    fun getByProjectAndImportType(projectId: String, importType: ImportType): Flow<List<FileImportHistoryEntity>>

    @Query("SELECT COUNT(*) FROM file_import_history WHERE importType = :importType")
    suspend fun getCountByImportType(importType: ImportType): Int

    // ===== 导入来源查询 =====

    @Query("SELECT * FROM file_import_history WHERE importedFrom = :source ORDER BY importedAt DESC")
    fun getByImportSource(source: ImportSource): Flow<List<FileImportHistoryEntity>>

    @Query("SELECT * FROM file_import_history WHERE projectId = :projectId AND importedFrom = :source ORDER BY importedAt DESC")
    fun getByProjectAndSource(projectId: String, source: ImportSource): Flow<List<FileImportHistoryEntity>>

    @Query("SELECT COUNT(*) FROM file_import_history WHERE importedFrom = :source")
    suspend fun getCountByImportSource(source: ImportSource): Int

    // ===== 时间范围查询 =====

    @Query("SELECT * FROM file_import_history WHERE importedAt >= :fromTimestamp ORDER BY importedAt DESC")
    fun getImportsSince(fromTimestamp: Long): Flow<List<FileImportHistoryEntity>>

    @Query("SELECT * FROM file_import_history WHERE importedAt BETWEEN :fromTimestamp AND :toTimestamp ORDER BY importedAt DESC")
    fun getImportsInRange(fromTimestamp: Long, toTimestamp: Long): Flow<List<FileImportHistoryEntity>>

    @Query("SELECT * FROM file_import_history WHERE projectId = :projectId AND importedAt >= :fromTimestamp ORDER BY importedAt DESC")
    fun getRecentImportsByProject(projectId: String, fromTimestamp: Long): Flow<List<FileImportHistoryEntity>>

    // ===== 统计查询 =====

    @Query("SELECT COUNT(*) FROM file_import_history")
    suspend fun getTotalCount(): Int

    @Query("SELECT SUM(sourceFileSize) FROM file_import_history")
    suspend fun getTotalSize(): Long?

    @Query("SELECT importType, COUNT(*) as count FROM file_import_history GROUP BY importType")
    suspend fun getCountByType(): List<ImportTypeCount>

    @Query("SELECT importedFrom, COUNT(*) as count FROM file_import_history GROUP BY importedFrom")
    suspend fun getCountBySource(): List<ImportSourceCount>

    @Query("""
        SELECT projectId, COUNT(*) as importCount, SUM(sourceFileSize) as totalSize
        FROM file_import_history
        GROUP BY projectId
        ORDER BY importCount DESC
    """)
    suspend fun getStatsPerProject(): List<ProjectImportStats>

    // ===== 重复检测 =====

    @Query("""
        SELECT COUNT(*) FROM file_import_history
        WHERE projectId = :projectId AND sourceUri = :sourceUri
    """)
    suspend fun checkDuplicate(projectId: String, sourceUri: String): Int

    @Query("""
        SELECT * FROM file_import_history
        WHERE sourceUri = :sourceUri
        ORDER BY importedAt DESC
        LIMIT 1
    """)
    suspend fun getLatestImportByUri(sourceUri: String): FileImportHistoryEntity?

    // ===== 搜索 =====

    @Query("""
        SELECT * FROM file_import_history
        WHERE sourceFileName LIKE '%' || :query || '%'
           OR note LIKE '%' || :query || '%'
        ORDER BY importedAt DESC
        LIMIT :limit
    """)
    fun searchImports(query: String, limit: Int = 50): Flow<List<FileImportHistoryEntity>>

    // ===== 批量删除 =====

    @Query("DELETE FROM file_import_history WHERE projectId = :projectId")
    suspend fun deleteByProject(projectId: String)

    @Query("DELETE FROM file_import_history WHERE importedAt < :timestamp")
    suspend fun deleteOldImports(timestamp: Long): Int
}

/**
 * 导入类型统计数据类
 */
data class ImportTypeCount(
    val importType: ImportType,
    val count: Int
)

/**
 * 导入来源统计数据类
 */
data class ImportSourceCount(
    val importedFrom: ImportSource,
    val count: Int
)

/**
 * 项目导入统计数据类
 */
data class ProjectImportStats(
    val projectId: String,
    val importCount: Int,
    val totalSize: Long
)
