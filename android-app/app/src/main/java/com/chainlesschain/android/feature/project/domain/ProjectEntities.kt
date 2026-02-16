package com.chainlesschain.android.feature.project.domain

import androidx.annotation.StringRes
import com.chainlesschain.android.R
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
            ProjectType.ANDROID -> "android"
            ProjectType.BACKEND -> "storage"
            ProjectType.DATA_SCIENCE -> "analytics"
            ProjectType.MULTIPLATFORM -> "devices"
            ProjectType.FLUTTER -> "flutter"
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
enum class ProjectType(@StringRes val displayNameResId: Int) {
    GENERAL(R.string.project_type_general),
    RESEARCH(R.string.project_type_research),
    DEVELOPMENT(R.string.project_type_development),
    WRITING(R.string.project_type_writing),
    DESIGN(R.string.project_type_design),
    ANDROID(R.string.project_type_android),
    BACKEND(R.string.project_type_backend),
    DATA_SCIENCE(R.string.project_type_data_science),
    MULTIPLATFORM(R.string.project_type_multiplatform),
    FLUTTER(R.string.project_type_flutter)
}

/**
 * 项目状态
 */
enum class ProjectStatus(@StringRes val displayNameResId: Int) {
    DRAFT(R.string.project_status_draft),
    ACTIVE(R.string.project_status_active),
    PAUSED(R.string.project_status_paused_enum),
    COMPLETED(R.string.project_status_completed_enum),
    ARCHIVED(R.string.project_status_archived_enum)
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
enum class FileType(@StringRes val displayNameResId: Int) {
    DOCUMENT(R.string.file_type_document),
    CODE(R.string.file_type_code),
    IMAGE(R.string.file_type_image),
    VIDEO(R.string.file_type_video),
    AUDIO(R.string.file_type_audio),
    OTHER(R.string.file_type_other)
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
enum class TaskStatus(@StringRes val displayNameResId: Int) {
    TODO(R.string.task_status_todo),
    IN_PROGRESS(R.string.task_status_in_progress),
    COMPLETED(R.string.task_status_completed),
    CANCELLED(R.string.task_status_cancelled)
}

/**
 * 任务优先级
 */
enum class TaskPriority(@StringRes val displayNameResId: Int) {
    LOW(R.string.task_priority_low),
    MEDIUM(R.string.task_priority_medium),
    HIGH(R.string.task_priority_high),
    URGENT(R.string.task_priority_urgent)
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
enum class ExploreCategory(@StringRes val displayNameResId: Int) {
    ALL(R.string.explore_category_all),
    PROJECT(R.string.explore_category_project),
    DOCUMENT(R.string.explore_category_document),
    AI_CHAT(R.string.explore_category_ai_chat),
    KNOWLEDGE(R.string.explore_category_knowledge)
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
enum class MessageType(@StringRes val displayNameResId: Int) {
    USER(R.string.message_type_user),
    AI(R.string.message_type_ai),
    SYSTEM(R.string.message_type_system)
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
enum class StepType(@StringRes val displayNameResId: Int, val iconName: String) {
    USER_MESSAGE(R.string.step_type_user_message, "person"),
    FILE_READ(R.string.step_type_file_read, "folder"),
    AI_MESSAGE(R.string.step_type_ai_message, "smart_toy"),
    TERMINAL(R.string.step_type_terminal, "terminal"),
    WEB_BROWSE(R.string.step_type_web_browse, "language"),
    CODE_EXECUTE(R.string.step_type_code_execute, "code")
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
