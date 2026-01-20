package com.chainlesschain.android.feature.project.domain

import java.time.LocalDateTime

/**
 * 项目实体
 */
data class ProjectEntity(
    val id: String,
    val name: String,
    val description: String? = null,
    val type: ProjectType = ProjectType.GENERAL,
    val status: ProjectStatus = ProjectStatus.DRAFT,
    val fileCount: Int = 0,
    val totalSize: Long = 0,
    val isShared: Boolean = false,
    val createdAt: LocalDateTime = LocalDateTime.now(),
    val updatedAt: LocalDateTime = LocalDateTime.now(),
    val tags: List<String> = emptyList(),
    val progress: Float = 0f, // 0.0 - 1.0
    val dueDate: LocalDateTime? = null
) {
    val typeIcon: String
        get() = when (type) {
            ProjectType.GENERAL -> "folder"
            ProjectType.RESEARCH -> "science"
            ProjectType.DEVELOPMENT -> "code"
            ProjectType.WRITING -> "edit"
            ProjectType.DESIGN -> "palette"
        }

    val formattedSize: String
        get() = formatBytes(totalSize)

    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
            else -> "${bytes / (1024 * 1024 * 1024)} GB"
        }
    }
}

/**
 * 项目类型
 */
enum class ProjectType(val displayName: String) {
    GENERAL("通用"),
    RESEARCH("研究"),
    DEVELOPMENT("开发"),
    WRITING("写作"),
    DESIGN("设计")
}

/**
 * 项目状态
 */
enum class ProjectStatus(val displayName: String) {
    DRAFT("草稿"),
    ACTIVE("进行中"),
    PAUSED("暂停"),
    COMPLETED("已完成"),
    ARCHIVED("已归档")
}

/**
 * 项目文件实体
 */
data class ProjectFileEntity(
    val id: String,
    val projectId: String,
    val name: String,
    val path: String,
    val type: FileType = FileType.DOCUMENT,
    val size: Long = 0,
    val content: String? = null,
    val createdAt: LocalDateTime = LocalDateTime.now(),
    val updatedAt: LocalDateTime = LocalDateTime.now()
) {
    val extension: String
        get() = name.substringAfterLast(".", "")

    val formattedSize: String
        get() = when {
            size < 1024 -> "$size B"
            size < 1024 * 1024 -> "${size / 1024} KB"
            else -> "${size / (1024 * 1024)} MB"
        }
}

/**
 * 文件类型
 */
enum class FileType(val displayName: String) {
    DOCUMENT("文档"),
    CODE("代码"),
    IMAGE("图片"),
    VIDEO("视频"),
    AUDIO("音频"),
    OTHER("其他")
}

/**
 * 项目统计数据
 */
data class ProjectStatistics(
    val totalProjects: Int = 0,
    val activeProjects: Int = 0,
    val draftProjects: Int = 0,
    val completedProjects: Int = 0,
    val totalFiles: Int = 0,
    val totalSize: Long = 0
)

/**
 * 任务实体
 */
data class TaskEntity(
    val id: String,
    val projectId: String? = null,
    val title: String,
    val description: String? = null,
    val status: TaskStatus = TaskStatus.TODO,
    val priority: TaskPriority = TaskPriority.MEDIUM,
    val dueDate: LocalDateTime? = null,
    val completedAt: LocalDateTime? = null,
    val createdAt: LocalDateTime = LocalDateTime.now(),
    val updatedAt: LocalDateTime = LocalDateTime.now(),
    val tags: List<String> = emptyList(),
    val steps: List<TaskStep> = emptyList()
) {
    val isOverdue: Boolean
        get() = dueDate?.isBefore(LocalDateTime.now()) == true && status != TaskStatus.COMPLETED

    val completionRate: Float
        get() = if (steps.isEmpty()) {
            if (status == TaskStatus.COMPLETED) 1f else 0f
        } else {
            steps.count { it.completed }.toFloat() / steps.size
        }
}

/**
 * 任务状态
 */
enum class TaskStatus(val displayName: String) {
    TODO("待处理"),
    IN_PROGRESS("进行中"),
    COMPLETED("已完成"),
    CANCELLED("已取消")
}

/**
 * 任务优先级
 */
enum class TaskPriority(val displayName: String) {
    LOW("低"),
    MEDIUM("中"),
    HIGH("高"),
    URGENT("紧急")
}

/**
 * 任务步骤
 */
data class TaskStep(
    val id: String,
    val title: String,
    val completed: Boolean = false,
    val order: Int = 0
)

/**
 * 探索内容实体
 */
data class ExploreItem(
    val id: String,
    val title: String,
    val description: String,
    val category: ExploreCategory,
    val imageUrl: String? = null,
    val viewCount: Int = 0,
    val likeCount: Int = 0,
    val createdAt: LocalDateTime = LocalDateTime.now(),
    val tags: List<String> = emptyList()
)

/**
 * 探索分类
 */
enum class ExploreCategory(val displayName: String) {
    ALL("全部"),
    PROJECT("项目"),
    DOCUMENT("文档"),
    AI_CHAT("AI对话"),
    KNOWLEDGE("知识库")
}
