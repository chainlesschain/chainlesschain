package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.ProjectActivityEntity
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import kotlinx.coroutines.flow.Flow

/**
 * 项目数据访问对象
 */
@Dao
interface ProjectDao {

    // ===== 项目 CRUD =====

    @Query("SELECT * FROM projects WHERE userId = :userId AND status != 'deleted' ORDER BY updatedAt DESC")
    fun getProjectsByUser(userId: String): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM projects WHERE userId = :userId AND status = :status ORDER BY updatedAt DESC")
    fun getProjectsByStatus(userId: String, status: String): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM projects WHERE userId = :userId AND type = :type AND status != 'deleted' ORDER BY updatedAt DESC")
    fun getProjectsByType(userId: String, type: String): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM projects WHERE userId = :userId AND isFavorite = 1 AND status != 'deleted' ORDER BY updatedAt DESC")
    fun getFavoriteProjects(userId: String): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM projects WHERE userId = :userId AND isArchived = 1 ORDER BY updatedAt DESC")
    fun getArchivedProjects(userId: String): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM projects WHERE id = :projectId")
    suspend fun getProjectById(projectId: String): ProjectEntity?

    @Query("SELECT * FROM projects WHERE id = :projectId")
    fun observeProject(projectId: String): Flow<ProjectEntity?>

    @Query("SELECT * FROM projects WHERE remoteId = :remoteId")
    suspend fun getProjectByRemoteId(remoteId: String): ProjectEntity?

    @Query("""
        SELECT * FROM projects
        WHERE userId = :userId
          AND status != 'deleted'
          AND (name LIKE '%' || :query || '%' OR description LIKE '%' || :query || '%' OR tags LIKE '%' || :query || '%')
        ORDER BY updatedAt DESC
    """)
    fun searchProjects(userId: String, query: String): Flow<List<ProjectEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProject(project: ProjectEntity): Long

    @Update
    suspend fun updateProject(project: ProjectEntity)

    @Query("UPDATE projects SET status = :status, updatedAt = :updatedAt WHERE id = :projectId")
    suspend fun updateProjectStatus(projectId: String, status: String, updatedAt: Long = System.currentTimeMillis())

    @Query("UPDATE projects SET isFavorite = :isFavorite, updatedAt = :updatedAt WHERE id = :projectId")
    suspend fun updateFavorite(projectId: String, isFavorite: Boolean, updatedAt: Long = System.currentTimeMillis())

    @Query("UPDATE projects SET isArchived = :isArchived, status = CASE WHEN :isArchived = 1 THEN 'archived' ELSE 'active' END, updatedAt = :updatedAt WHERE id = :projectId")
    suspend fun updateArchived(projectId: String, isArchived: Boolean, updatedAt: Long = System.currentTimeMillis())

    @Query("UPDATE projects SET lastAccessedAt = :accessedAt, accessCount = accessCount + 1 WHERE id = :projectId")
    suspend fun recordAccess(projectId: String, accessedAt: Long = System.currentTimeMillis())

    @Query("UPDATE projects SET isSynced = :isSynced, lastSyncedAt = :syncedAt, remoteId = :remoteId WHERE id = :projectId")
    suspend fun updateSyncStatus(projectId: String, isSynced: Boolean, syncedAt: Long?, remoteId: String?)

    @Query("UPDATE projects SET fileCount = :fileCount, totalSize = :totalSize, updatedAt = :updatedAt WHERE id = :projectId")
    suspend fun updateProjectStats(projectId: String, fileCount: Int, totalSize: Long, updatedAt: Long = System.currentTimeMillis())

    @Query("UPDATE projects SET gitEnabled = :enabled, gitRemoteUrl = :remoteUrl, gitBranch = :branch WHERE id = :projectId")
    suspend fun updateGitConfig(projectId: String, enabled: Boolean, remoteUrl: String?, branch: String?)

    @Query("UPDATE projects SET lastCommitHash = :hash, uncommittedChanges = :changes WHERE id = :projectId")
    suspend fun updateGitStatus(projectId: String, hash: String?, changes: Int)

    @Query("DELETE FROM projects WHERE id = :projectId")
    suspend fun deleteProject(projectId: String)

    @Transaction
    suspend fun hardDeleteProject(projectId: String) {
        deleteAllProjectFiles(projectId)
        deleteProjectActivities(projectId)
        deleteProject(projectId)
    }

    @Query("UPDATE projects SET status = 'deleted', updatedAt = :updatedAt WHERE id = :projectId")
    suspend fun softDeleteProject(projectId: String, updatedAt: Long = System.currentTimeMillis())

    // ===== 统计查询 =====

    @Query("SELECT COUNT(*) FROM projects WHERE userId = :userId AND status != 'deleted'")
    suspend fun getProjectCount(userId: String): Int

    @Query("SELECT COUNT(*) FROM projects WHERE userId = :userId AND status = :status")
    suspend fun getProjectCountByStatus(userId: String, status: String): Int

    @Query("SELECT type, COUNT(*) as count FROM projects WHERE userId = :userId AND status != 'deleted' GROUP BY type")
    suspend fun getProjectCountByType(userId: String): List<TypeCount>

    @Query("SELECT SUM(totalSize) FROM projects WHERE userId = :userId AND status != 'deleted'")
    suspend fun getTotalProjectsSize(userId: String): Long?

    @Query("SELECT * FROM projects WHERE userId = :userId AND isSynced = 0")
    suspend fun getUnsyncedProjects(userId: String): List<ProjectEntity>

    // ===== 项目文件 =====

    @Query("SELECT * FROM project_files WHERE projectId = :projectId ORDER BY type DESC, name ASC")
    fun getProjectFiles(projectId: String): Flow<List<ProjectFileEntity>>

    @Query("SELECT * FROM project_files WHERE projectId = :projectId ORDER BY type DESC, name ASC")
    suspend fun getProjectFilesSync(projectId: String): List<ProjectFileEntity>

    @Query("SELECT * FROM project_files WHERE projectId = :projectId AND parentId IS NULL ORDER BY type DESC, name ASC")
    fun getRootFiles(projectId: String): Flow<List<ProjectFileEntity>>

    @Query("SELECT * FROM project_files WHERE projectId = :projectId AND parentId = :parentId ORDER BY type DESC, name ASC")
    fun getFilesByParent(projectId: String, parentId: String): Flow<List<ProjectFileEntity>>

    @Query("SELECT * FROM project_files WHERE id = :fileId")
    suspend fun getFileById(fileId: String): ProjectFileEntity?

    @Query("SELECT * FROM project_files WHERE projectId = :projectId AND path = :path")
    suspend fun getFileByPath(projectId: String, path: String): ProjectFileEntity?

    @Query("""
        SELECT * FROM project_files
        WHERE projectId = :projectId
          AND (name LIKE '%' || :query || '%' OR path LIKE '%' || :query || '%')
        ORDER BY type DESC, name ASC
    """)
    fun searchFiles(projectId: String, query: String): Flow<List<ProjectFileEntity>>

    @Query("SELECT * FROM project_files WHERE projectId = :projectId AND isOpen = 1")
    fun getOpenFiles(projectId: String): Flow<List<ProjectFileEntity>>

    @Query("SELECT * FROM project_files WHERE projectId = :projectId AND isDirty = 1")
    suspend fun getDirtyFiles(projectId: String): List<ProjectFileEntity>

    @Query("""
        SELECT * FROM project_files
        WHERE projectId = :projectId
          AND type = 'file'
          AND lastAccessedAt IS NOT NULL
        ORDER BY lastAccessedAt DESC
        LIMIT :limit
    """)
    fun getRecentlyOpenedFiles(projectId: String, limit: Int = 10): Flow<List<ProjectFileEntity>>

    @Query("""
        SELECT * FROM project_files
        WHERE projectId = :projectId AND type = 'file'
        ORDER BY updatedAt DESC
        LIMIT :limit
    """)
    fun getRecentlyModifiedFiles(projectId: String, limit: Int = 10): Flow<List<ProjectFileEntity>>

    @Query("""
        SELECT * FROM project_files
        WHERE projectId = :projectId
          AND type = 'file'
          AND extension IN (:extensions)
        ORDER BY name ASC
    """)
    fun getFilesByExtensions(projectId: String, extensions: List<String>): Flow<List<ProjectFileEntity>>

    @Query("""
        SELECT * FROM project_files
        WHERE projectId = :projectId
          AND type = 'file'
          AND size > :minSize AND size < :maxSize
        ORDER BY size DESC
    """)
    fun getFilesBySizeRange(projectId: String, minSize: Long, maxSize: Long): Flow<List<ProjectFileEntity>>

    @Query("UPDATE project_files SET lastAccessedAt = :accessedAt, isOpen = 1 WHERE id = :fileId")
    suspend fun markFileAsOpened(fileId: String, accessedAt: Long = System.currentTimeMillis())

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFile(file: ProjectFileEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFiles(files: List<ProjectFileEntity>)

    @Update
    suspend fun updateFile(file: ProjectFileEntity)

    @Query("UPDATE project_files SET content = :content, isDirty = :isDirty, updatedAt = :updatedAt WHERE id = :fileId")
    suspend fun updateFileContent(fileId: String, content: String?, isDirty: Boolean, updatedAt: Long = System.currentTimeMillis())

    @Query("UPDATE project_files SET isOpen = :isOpen WHERE id = :fileId")
    suspend fun updateFileOpenStatus(fileId: String, isOpen: Boolean)

    @Query("UPDATE project_files SET isDirty = :isDirty WHERE id = :fileId")
    suspend fun updateFileDirtyStatus(fileId: String, isDirty: Boolean)

    @Query("UPDATE project_files SET hash = :hash, updatedAt = :updatedAt WHERE id = :fileId")
    suspend fun updateFileHash(fileId: String, hash: String, updatedAt: Long = System.currentTimeMillis())

    @Query("DELETE FROM project_files WHERE id = :fileId")
    suspend fun deleteFile(fileId: String)

    @Query("DELETE FROM project_files WHERE projectId = :projectId")
    suspend fun deleteAllProjectFiles(projectId: String)

    @Query("DELETE FROM project_files WHERE projectId = :projectId AND parentId = :parentId")
    suspend fun deleteFilesByParent(projectId: String, parentId: String)

    // ===== 文件统计 =====

    @Query("SELECT COUNT(*) FROM project_files WHERE projectId = :projectId AND type = 'file'")
    suspend fun getFileCount(projectId: String): Int

    @Query("SELECT COUNT(*) FROM project_files WHERE projectId = :projectId AND type = 'folder'")
    suspend fun getFolderCount(projectId: String): Int

    @Query("SELECT SUM(size) FROM project_files WHERE projectId = :projectId AND type = 'file'")
    suspend fun getTotalFilesSize(projectId: String): Long?

    @Query("SELECT extension, COUNT(*) as count FROM project_files WHERE projectId = :projectId AND type = 'file' GROUP BY extension")
    suspend fun getFileCountByExtension(projectId: String): List<ExtensionCount>

    // ===== 项目活动 =====

    @Query("SELECT * FROM project_activities WHERE projectId = :projectId ORDER BY createdAt DESC LIMIT :limit")
    fun getProjectActivities(projectId: String, limit: Int = 50): Flow<List<ProjectActivityEntity>>

    @Query("SELECT * FROM project_activities WHERE projectId = :projectId AND type = :type ORDER BY createdAt DESC LIMIT :limit")
    fun getActivitiesByType(projectId: String, type: String, limit: Int = 20): Flow<List<ProjectActivityEntity>>

    @Insert
    suspend fun insertActivity(activity: ProjectActivityEntity): Long

    @Query("DELETE FROM project_activities WHERE projectId = :projectId")
    suspend fun deleteProjectActivities(projectId: String)

    @Query("DELETE FROM project_activities WHERE projectId = :projectId AND createdAt < :cutoffTime")
    suspend fun deleteOldActivities(projectId: String, cutoffTime: Long)

    // ===== 辅助数据类 =====

    data class TypeCount(
        val type: String,
        val count: Int
    )

    data class ExtensionCount(
        val extension: String?,
        val count: Int
    )
}
