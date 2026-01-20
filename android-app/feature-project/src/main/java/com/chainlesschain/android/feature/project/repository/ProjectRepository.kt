package com.chainlesschain.android.feature.project.repository

import android.util.Log
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ProjectActivityEntity
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.model.CreateProjectRequest
import com.chainlesschain.android.feature.project.model.ProjectWithStats
import com.chainlesschain.android.feature.project.model.UpdateProjectRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 项目事件
 */
sealed class ProjectEvent {
    data class Created(val project: ProjectEntity) : ProjectEvent()
    data class Updated(val project: ProjectEntity) : ProjectEvent()
    data class Deleted(val projectId: String) : ProjectEvent()
    data class StatusChanged(val projectId: String, val newStatus: String) : ProjectEvent()
    data class FileAdded(val projectId: String, val file: ProjectFileEntity) : ProjectEvent()
    data class FileDeleted(val projectId: String, val fileId: String) : ProjectEvent()
    data class FileUpdated(val projectId: String, val file: ProjectFileEntity) : ProjectEvent()
}

/**
 * 项目仓库
 *
 * 提供项目管理的业务逻辑层：
 * - 项目 CRUD 操作
 * - 项目文件管理
 * - 项目活动记录
 * - 项目统计信息
 */
@Singleton
class ProjectRepository @Inject constructor(
    private val projectDao: ProjectDao
) {
    companion object {
        private const val TAG = "ProjectRepository"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 项目事件流
    private val _projectEvents = MutableSharedFlow<ProjectEvent>(replay = 0)
    val projectEvents: SharedFlow<ProjectEvent> = _projectEvents.asSharedFlow()

    // ===== 项目 CRUD =====

    /**
     * 获取用户的所有项目
     */
    fun getProjectsByUser(userId: String): Flow<List<ProjectEntity>> {
        return projectDao.getProjectsByUser(userId)
    }

    /**
     * 获取用户项目（带统计信息）
     */
    fun getProjectsWithStats(userId: String): Flow<List<ProjectWithStats>> {
        return projectDao.getProjectsByUser(userId).map { projects ->
            projects.map { project ->
                val fileCountByType = try {
                    projectDao.getFileCountByExtension(project.id)
                        .associate { it.extension.orEmpty() to it.count }
                } catch (e: Exception) {
                    emptyMap()
                }
                ProjectWithStats(project, fileCountByType)
            }
        }
    }

    /**
     * 按状态获取项目
     */
    fun getProjectsByStatus(userId: String, status: String): Flow<List<ProjectEntity>> {
        return projectDao.getProjectsByStatus(userId, status)
    }

    /**
     * 按类型获取项目
     */
    fun getProjectsByType(userId: String, type: String): Flow<List<ProjectEntity>> {
        return projectDao.getProjectsByType(userId, type)
    }

    /**
     * 获取收藏的项目
     */
    fun getFavoriteProjects(userId: String): Flow<List<ProjectEntity>> {
        return projectDao.getFavoriteProjects(userId)
    }

    /**
     * 获取归档的项目
     */
    fun getArchivedProjects(userId: String): Flow<List<ProjectEntity>> {
        return projectDao.getArchivedProjects(userId)
    }

    /**
     * 搜索项目
     */
    fun searchProjects(userId: String, query: String): Flow<List<ProjectEntity>> {
        return projectDao.searchProjects(userId, query)
    }

    /**
     * 获取单个项目
     */
    suspend fun getProject(projectId: String): ProjectEntity? {
        return withContext(Dispatchers.IO) {
            projectDao.getProjectById(projectId)
        }
    }

    /**
     * 观察单个项目
     */
    fun observeProject(projectId: String): Flow<ProjectEntity?> {
        return projectDao.observeProject(projectId)
    }

    /**
     * 创建项目
     */
    suspend fun createProject(request: CreateProjectRequest): Result<ProjectEntity> {
        return withContext(Dispatchers.IO) {
            try {
                val now = System.currentTimeMillis()
                val project = ProjectEntity(
                    id = UUID.randomUUID().toString(),
                    name = request.name,
                    description = request.description,
                    type = request.type,
                    status = ProjectStatus.ACTIVE,
                    userId = request.userId,
                    rootPath = request.rootPath,
                    icon = request.icon,
                    tags = request.tags?.let {
                        kotlinx.serialization.json.Json.encodeToString(
                            kotlinx.serialization.builtins.ListSerializer(kotlinx.serialization.builtins.serializer<String>()),
                            it
                        )
                    },
                    createdAt = now,
                    updatedAt = now
                )

                projectDao.insertProject(project)

                // 记录活动
                recordActivity(project.id, "created", "项目已创建: ${project.name}")

                Log.i(TAG, "Created project: ${project.id} - ${project.name}")

                scope.launch {
                    _projectEvents.emit(ProjectEvent.Created(project))
                }

                Result.success(project)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to create project", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 更新项目
     */
    suspend fun updateProject(projectId: String, request: UpdateProjectRequest): Result<ProjectEntity> {
        return withContext(Dispatchers.IO) {
            try {
                val existing = projectDao.getProjectById(projectId)
                    ?: return@withContext Result.failure(IllegalArgumentException("Project not found"))

                val updated = existing.copy(
                    name = request.name ?: existing.name,
                    description = request.description ?: existing.description,
                    type = request.type ?: existing.type,
                    icon = request.icon ?: existing.icon,
                    coverImage = request.coverImage ?: existing.coverImage,
                    tags = request.tags?.let {
                        kotlinx.serialization.json.Json.encodeToString(
                            kotlinx.serialization.builtins.ListSerializer(kotlinx.serialization.builtins.serializer<String>()),
                            it
                        )
                    } ?: existing.tags,
                    metadata = request.metadata ?: existing.metadata,
                    updatedAt = System.currentTimeMillis()
                )

                projectDao.updateProject(updated)

                // 记录活动
                recordActivity(projectId, "updated", "项目已更新")

                Log.i(TAG, "Updated project: $projectId")

                scope.launch {
                    _projectEvents.emit(ProjectEvent.Updated(updated))
                }

                Result.success(updated)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update project: $projectId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 删除项目（软删除）
     */
    suspend fun deleteProject(projectId: String, hard: Boolean = false): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                if (hard) {
                    // 硬删除：删除所有文件和活动
                    projectDao.deleteAllProjectFiles(projectId)
                    projectDao.deleteProjectActivities(projectId)
                    projectDao.deleteProject(projectId)
                } else {
                    // 软删除
                    projectDao.softDeleteProject(projectId)
                }

                Log.i(TAG, "Deleted project: $projectId (hard=$hard)")

                scope.launch {
                    _projectEvents.emit(ProjectEvent.Deleted(projectId))
                }

                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to delete project: $projectId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 更新项目状态
     */
    suspend fun updateProjectStatus(projectId: String, status: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                projectDao.updateProjectStatus(projectId, status)

                // 如果状态为完成，记录完成时间
                if (status == ProjectStatus.COMPLETED) {
                    val project = projectDao.getProjectById(projectId)
                    if (project != null) {
                        projectDao.updateProject(
                            project.copy(
                                completedAt = System.currentTimeMillis(),
                                updatedAt = System.currentTimeMillis()
                            )
                        )
                    }
                }

                recordActivity(projectId, "status_changed", "状态变更为: ${getStatusDisplayName(status)}")

                Log.i(TAG, "Updated project status: $projectId -> $status")

                scope.launch {
                    _projectEvents.emit(ProjectEvent.StatusChanged(projectId, status))
                }

                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update project status: $projectId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 切换收藏状态
     */
    suspend fun toggleFavorite(projectId: String): Result<Boolean> {
        return withContext(Dispatchers.IO) {
            try {
                val project = projectDao.getProjectById(projectId)
                    ?: return@withContext Result.failure(IllegalArgumentException("Project not found"))

                val newFavorite = !project.isFavorite
                projectDao.updateFavorite(projectId, newFavorite)

                Log.i(TAG, "Toggled favorite: $projectId -> $newFavorite")

                Result.success(newFavorite)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to toggle favorite: $projectId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 切换归档状态
     */
    suspend fun toggleArchive(projectId: String): Result<Boolean> {
        return withContext(Dispatchers.IO) {
            try {
                val project = projectDao.getProjectById(projectId)
                    ?: return@withContext Result.failure(IllegalArgumentException("Project not found"))

                val newArchived = !project.isArchived
                projectDao.updateArchived(projectId, newArchived)

                recordActivity(
                    projectId,
                    if (newArchived) "archived" else "unarchived",
                    if (newArchived) "项目已归档" else "项目已取消归档"
                )

                Log.i(TAG, "Toggled archive: $projectId -> $newArchived")

                Result.success(newArchived)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to toggle archive: $projectId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 记录项目访问
     */
    suspend fun recordAccess(projectId: String) {
        withContext(Dispatchers.IO) {
            try {
                projectDao.recordAccess(projectId)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to record access: $projectId", e)
            }
        }
    }

    // ===== 项目文件管理 =====

    /**
     * 获取项目文件
     */
    fun getProjectFiles(projectId: String): Flow<List<ProjectFileEntity>> {
        return projectDao.getProjectFiles(projectId)
    }

    /**
     * 获取根目录文件
     */
    fun getRootFiles(projectId: String): Flow<List<ProjectFileEntity>> {
        return projectDao.getRootFiles(projectId)
    }

    /**
     * 获取子文件夹内容
     */
    fun getFilesByParent(projectId: String, parentId: String): Flow<List<ProjectFileEntity>> {
        return projectDao.getFilesByParent(projectId, parentId)
    }

    /**
     * 搜索文件
     */
    fun searchFiles(projectId: String, query: String): Flow<List<ProjectFileEntity>> {
        return projectDao.searchFiles(projectId, query)
    }

    /**
     * 获取已打开的文件
     */
    fun getOpenFiles(projectId: String): Flow<List<ProjectFileEntity>> {
        return projectDao.getOpenFiles(projectId)
    }

    /**
     * 获取单个文件
     */
    suspend fun getFile(fileId: String): ProjectFileEntity? {
        return withContext(Dispatchers.IO) {
            projectDao.getFileById(fileId)
        }
    }

    /**
     * 添加文件
     */
    suspend fun addFile(
        projectId: String,
        name: String,
        path: String,
        type: String = "file",
        parentId: String? = null,
        mimeType: String? = null,
        size: Long = 0,
        content: String? = null
    ): Result<ProjectFileEntity> {
        return withContext(Dispatchers.IO) {
            try {
                val now = System.currentTimeMillis()
                val extension = if (type == "file") {
                    name.substringAfterLast('.', "")
                } else null

                val file = ProjectFileEntity(
                    id = UUID.randomUUID().toString(),
                    projectId = projectId,
                    parentId = parentId,
                    name = name,
                    path = path,
                    type = type,
                    mimeType = mimeType,
                    size = size,
                    extension = extension,
                    content = content,
                    createdAt = now,
                    updatedAt = now
                )

                projectDao.insertFile(file)

                // 更新项目统计
                updateProjectStats(projectId)

                // 记录活动
                recordActivity(
                    projectId,
                    if (type == "folder") "folder_added" else "file_added",
                    "添加${if (type == "folder") "文件夹" else "文件"}: $name",
                    file.id
                )

                Log.i(TAG, "Added file: ${file.id} - $name to project $projectId")

                scope.launch {
                    _projectEvents.emit(ProjectEvent.FileAdded(projectId, file))
                }

                Result.success(file)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to add file to project: $projectId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 更新文件内容
     */
    suspend fun updateFileContent(fileId: String, content: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                projectDao.updateFileContent(fileId, content, isDirty = true)
                Log.i(TAG, "Updated file content: $fileId")
                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to update file content: $fileId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 保存文件（标记为已保存）
     */
    suspend fun saveFile(fileId: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val file = projectDao.getFileById(fileId)
                    ?: return@withContext Result.failure(IllegalArgumentException("File not found"))

                projectDao.updateFileDirtyStatus(fileId, isDirty = false)

                // 计算文件哈希
                file.content?.let { content ->
                    val hash = content.hashCode().toString(16)
                    projectDao.updateFileHash(fileId, hash)
                }

                // 记录活动
                recordActivity(
                    file.projectId,
                    "file_saved",
                    "文件已保存: ${file.name}",
                    fileId
                )

                Log.i(TAG, "Saved file: $fileId")
                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to save file: $fileId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 打开文件
     */
    suspend fun openFile(fileId: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                projectDao.updateFileOpenStatus(fileId, isOpen = true)
                Log.d(TAG, "Opened file: $fileId")
                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to open file: $fileId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 关闭文件
     */
    suspend fun closeFile(fileId: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                projectDao.updateFileOpenStatus(fileId, isOpen = false)
                Log.d(TAG, "Closed file: $fileId")
                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to close file: $fileId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 删除文件
     */
    suspend fun deleteFile(fileId: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val file = projectDao.getFileById(fileId)
                    ?: return@withContext Result.failure(IllegalArgumentException("File not found"))

                // 如果是文件夹，递归删除子文件
                if (file.isFolder()) {
                    projectDao.deleteFilesByParent(file.projectId, fileId)
                }

                projectDao.deleteFile(fileId)

                // 更新项目统计
                updateProjectStats(file.projectId)

                // 记录活动
                recordActivity(
                    file.projectId,
                    if (file.isFolder()) "folder_deleted" else "file_deleted",
                    "删除${if (file.isFolder()) "文件夹" else "文件"}: ${file.name}",
                    fileId
                )

                Log.i(TAG, "Deleted file: $fileId")

                scope.launch {
                    _projectEvents.emit(ProjectEvent.FileDeleted(file.projectId, fileId))
                }

                Result.success(Unit)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to delete file: $fileId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * 获取未保存的文件
     */
    suspend fun getDirtyFiles(projectId: String): List<ProjectFileEntity> {
        return withContext(Dispatchers.IO) {
            projectDao.getDirtyFiles(projectId)
        }
    }

    // ===== 项目活动 =====

    /**
     * 获取项目活动
     */
    fun getProjectActivities(projectId: String, limit: Int = 50): Flow<List<ProjectActivityEntity>> {
        return projectDao.getProjectActivities(projectId, limit)
    }

    /**
     * 记录活动
     */
    private suspend fun recordActivity(
        projectId: String,
        type: String,
        description: String,
        fileId: String? = null,
        data: String? = null
    ) {
        try {
            val activity = ProjectActivityEntity(
                id = UUID.randomUUID().toString(),
                projectId = projectId,
                type = type,
                description = description,
                fileId = fileId,
                data = data,
                createdAt = System.currentTimeMillis()
            )
            projectDao.insertActivity(activity)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to record activity", e)
        }
    }

    /**
     * 清理旧活动
     */
    suspend fun cleanupOldActivities(projectId: String, keepDays: Int = 30) {
        withContext(Dispatchers.IO) {
            val cutoffTime = System.currentTimeMillis() - (keepDays * 24 * 60 * 60 * 1000L)
            projectDao.deleteOldActivities(projectId, cutoffTime)
            Log.i(TAG, "Cleaned up activities older than $keepDays days for project: $projectId")
        }
    }

    // ===== 统计信息 =====

    /**
     * 获取项目数量
     */
    suspend fun getProjectCount(userId: String): Int {
        return withContext(Dispatchers.IO) {
            projectDao.getProjectCount(userId)
        }
    }

    /**
     * 按类型获取项目数量
     */
    suspend fun getProjectCountByType(userId: String): Map<String, Int> {
        return withContext(Dispatchers.IO) {
            projectDao.getProjectCountByType(userId)
                .associate { it.type to it.count }
        }
    }

    /**
     * 获取所有项目总大小
     */
    suspend fun getTotalProjectsSize(userId: String): Long {
        return withContext(Dispatchers.IO) {
            projectDao.getTotalProjectsSize(userId) ?: 0L
        }
    }

    /**
     * 更新项目统计信息
     */
    private suspend fun updateProjectStats(projectId: String) {
        try {
            val fileCount = projectDao.getFileCount(projectId)
            val totalSize = projectDao.getTotalFilesSize(projectId) ?: 0L
            projectDao.updateProjectStats(projectId, fileCount, totalSize)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update project stats: $projectId", e)
        }
    }

    // ===== 辅助方法 =====

    private fun getStatusDisplayName(status: String): String {
        return when (status) {
            ProjectStatus.ACTIVE -> "进行中"
            ProjectStatus.PAUSED -> "已暂停"
            ProjectStatus.COMPLETED -> "已完成"
            ProjectStatus.ARCHIVED -> "已归档"
            ProjectStatus.DELETED -> "已删除"
            else -> "未知"
        }
    }
}
