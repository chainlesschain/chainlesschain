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

// ==================== 项目详情和步骤相关实体 ====================

/**
 * 项目会话实体 - 用于项目详情页的对话式展示
 */
data class ProjectConversation(
    val id: String,
    val projectId: String,
    val title: String,
    val messages: List<ProjectMessage> = emptyList(),
    val steps: List<ExecutionStep> = emptyList(),
    val createdAt: LocalDateTime = LocalDateTime.now(),
    val updatedAt: LocalDateTime = LocalDateTime.now()
)

/**
 * 项目消息实体 - 对话式交互中的单条消息
 */
data class ProjectMessage(
    val id: String,
    val type: MessageType,
    val content: String,
    val imageUrl: String? = null,
    val webPreview: WebPreviewData? = null,
    val codeBlock: CodeBlockData? = null,
    val timestamp: LocalDateTime = LocalDateTime.now()
)

/**
 * 消息类型
 */
enum class MessageType(val displayName: String) {
    USER("用户消息"),
    AI("AI消息"),
    SYSTEM("系统消息")
}

/**
 * 网页预览数据
 */
data class WebPreviewData(
    val url: String,
    val title: String,
    val description: String? = null,
    val imageUrl: String? = null
)

/**
 * 代码块数据
 */
data class CodeBlockData(
    val language: String,
    val code: String,
    val fileName: String? = null
)

/**
 * 执行步骤实体 - 用于步骤详情页的时间线展示
 */
data class ExecutionStep(
    val id: String,
    val type: StepType,
    val title: String,
    val content: String? = null,
    val imageUrl: String? = null,
    val fileData: StepFileData? = null,
    val codeBlock: CodeBlockData? = null,
    val terminalOutput: TerminalOutputData? = null,
    val order: Int = 0,
    val timestamp: LocalDateTime = LocalDateTime.now()
)

/**
 * 步骤类型
 */
enum class StepType(val displayName: String, val iconName: String) {
    USER_MESSAGE("用户发送消息", "person"),
    FILE_READ("文件读取", "folder"),
    AI_MESSAGE("AI发送消息", "smart_toy"),
    TERMINAL("虚拟终端", "terminal"),
    WEB_BROWSE("网页浏览", "language"),
    CODE_EXECUTE("代码执行", "code")
}

/**
 * 步骤文件数据
 */
data class StepFileData(
    val fileName: String,
    val filePath: String? = null,
    val fileType: FileType = FileType.OTHER,
    val fileSize: Long? = null
)

/**
 * 终端输出数据
 */
data class TerminalOutputData(
    val command: String,
    val output: String,
    val isError: Boolean = false,
    val language: String = "bash"
)
