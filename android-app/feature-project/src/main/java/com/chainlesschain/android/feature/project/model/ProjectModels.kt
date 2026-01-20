package com.chainlesschain.android.feature.project.model

import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectType

/**
 * 创建项目请求
 */
data class CreateProjectRequest(
    val name: String,
    val description: String? = null,
    val type: String = ProjectType.OTHER,
    val userId: String,
    val rootPath: String? = null,
    val icon: String? = null,
    val tags: List<String>? = null
)

/**
 * 更新项目请求
 */
data class UpdateProjectRequest(
    val name: String? = null,
    val description: String? = null,
    val type: String? = null,
    val icon: String? = null,
    val coverImage: String? = null,
    val tags: List<String>? = null,
    val metadata: String? = null
)

/**
 * 带统计信息的项目
 */
data class ProjectWithStats(
    val project: ProjectEntity,
    val fileCountByExtension: Map<String, Int> = emptyMap()
) {
    /**
     * 获取主要文件类型（数量最多的）
     */
    fun getPrimaryFileType(): String? {
        return fileCountByExtension.maxByOrNull { it.value }?.key
    }

    /**
     * 获取文件类型分布描述
     */
    fun getFileTypeDistribution(): String {
        if (fileCountByExtension.isEmpty()) return "空项目"

        val top3 = fileCountByExtension.entries
            .sortedByDescending { it.value }
            .take(3)
            .map { "${it.key.ifEmpty { "无扩展名" }}: ${it.value}" }

        return top3.joinToString(", ")
    }
}

/**
 * 项目筛选选项
 */
data class ProjectFilter(
    val status: String? = null,
    val type: String? = null,
    val isFavorite: Boolean? = null,
    val isArchived: Boolean? = null,
    val searchQuery: String? = null
)

/**
 * 项目排序方式
 */
enum class ProjectSortBy {
    UPDATED_AT,
    CREATED_AT,
    NAME,
    ACCESS_COUNT,
    FILE_COUNT,
    TOTAL_SIZE
}

/**
 * 排序方向
 */
enum class SortDirection {
    ASC,
    DESC
}

/**
 * 项目列表状态
 */
sealed class ProjectListState {
    object Loading : ProjectListState()
    data class Success(
        val projects: List<ProjectWithStats>,
        val filter: ProjectFilter = ProjectFilter(),
        val sortBy: ProjectSortBy = ProjectSortBy.UPDATED_AT,
        val sortDirection: SortDirection = SortDirection.DESC
    ) : ProjectListState()
    data class Error(val message: String) : ProjectListState()
    object Empty : ProjectListState()
}

/**
 * 项目详情状态
 */
sealed class ProjectDetailState {
    object Loading : ProjectDetailState()
    data class Success(val project: ProjectEntity) : ProjectDetailState()
    data class Error(val message: String) : ProjectDetailState()
}

/**
 * 文件树节点
 */
data class FileTreeNode(
    val id: String,
    val name: String,
    val path: String,
    val type: String,
    val extension: String?,
    val size: Long,
    val isDirty: Boolean,
    val isOpen: Boolean,
    val children: MutableList<FileTreeNode> = mutableListOf(),
    var isExpanded: Boolean = false
) {
    fun isFolder(): Boolean = type == "folder"
    fun isFile(): Boolean = type == "file"
}
