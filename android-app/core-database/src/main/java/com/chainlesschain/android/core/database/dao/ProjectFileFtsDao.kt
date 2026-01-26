package com.chainlesschain.android.core.database.dao

import androidx.room.Dao
import androidx.room.Query
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import kotlinx.coroutines.flow.Flow

/**
 * 项目文件全文搜索 DAO
 *
 * 使用 FTS4 提供高性能的内容搜索
 */
@Dao
interface ProjectFileFtsDao {

    /**
     * 全文搜索文件内容（使用FTS4）
     *
     * @param query 搜索查询
     * @return 匹配的文件列表（按相关性排序）
     */
    @Query("""
        SELECT pf.*
        FROM project_files pf
        JOIN project_files_fts fts ON pf.rowid = fts.rowid
        WHERE project_files_fts MATCH :query
        ORDER BY pf.updatedAt DESC
    """)
    fun searchFileContent(query: String): Flow<List<ProjectFileEntity>>

    /**
     * 在特定项目中全文搜索（使用FTS4）
     *
     * @param projectId 项目 ID
     * @param query 搜索查询
     * @return 匹配的文件列表
     */
    @Query("""
        SELECT pf.*
        FROM project_files pf
        JOIN project_files_fts fts ON pf.rowid = fts.rowid
        WHERE pf.projectId = :projectId
          AND project_files_fts MATCH :query
        ORDER BY pf.updatedAt DESC
        LIMIT :limit
    """)
    fun searchInProject(projectId: String, query: String, limit: Int = 50): Flow<List<ProjectFileEntity>>

    /**
     * 搜索特定类型的文件（使用FTS4）
     *
     * @param projectId 项目 ID
     * @param query 搜索查询
     * @param extension 文件扩展名
     * @return 匹配的文件列表
     */
    @Query("""
        SELECT pf.*
        FROM project_files pf
        JOIN project_files_fts fts ON pf.rowid = fts.rowid
        WHERE pf.projectId = :projectId
          AND pf.extension = :extension
          AND project_files_fts MATCH :query
        ORDER BY pf.updatedAt DESC
        LIMIT :limit
    """)
    fun searchByExtension(
        projectId: String,
        query: String,
        extension: String,
        limit: Int = 50
    ): Flow<List<ProjectFileEntity>>

    /**
     * 使用 FTS4 snippet 函数搜索并返回匹配的上下文
     *
     * @param projectId 项目 ID
     * @param query 搜索查询
     * @return 搜索结果（包含上下文片段）
     */
    @Query("""
        SELECT
            pf.id,
            pf.projectId,
            pf.name,
            pf.path,
            pf.content,
            pf.extension,
            pf.size,
            pf.type,
            snippet(project_files_fts, 2, '<b>', '</b>', '...', 20) as snippet
        FROM project_files pf
        JOIN project_files_fts fts ON pf.rowid = fts.rowid
        WHERE pf.projectId = :projectId
          AND project_files_fts MATCH :query
        ORDER BY pf.updatedAt DESC
        LIMIT :limit
    """)
    suspend fun searchWithSnippets(
        projectId: String,
        query: String,
        limit: Int = 50
    ): List<FileSearchResult>

    /**
     * 搜索多个项目（使用FTS4）
     *
     * @param projectIds 项目 ID 列表
     * @param query 搜索查询
     * @return 匹配的文件列表
     */
    @Query("""
        SELECT pf.*
        FROM project_files pf
        JOIN project_files_fts fts ON pf.rowid = fts.rowid
        WHERE pf.projectId IN (:projectIds)
          AND project_files_fts MATCH :query
        ORDER BY pf.projectId, pf.updatedAt DESC
        LIMIT :limit
    """)
    fun searchInMultipleProjects(
        projectIds: List<String>,
        query: String,
        limit: Int = 100
    ): Flow<List<ProjectFileEntity>>
}

/**
 * 文件搜索结果（包含上下文片段）
 */
data class FileSearchResult(
    val id: String,
    val projectId: String,
    val name: String,
    val path: String,
    val content: String?,
    val extension: String?,
    val size: Long,
    val type: String,
    val snippet: String  // 匹配的上下文片段
)
