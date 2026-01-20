package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 项目类型枚举
 */
object ProjectType {
    const val DOCUMENT = "document"    // 文档类项目
    const val WEB = "web"              // Web开发项目
    const val APP = "app"              // 应用开发项目
    const val DATA = "data"            // 数据分析项目
    const val DESIGN = "design"        // 设计类项目
    const val RESEARCH = "research"    // 研究类项目
    const val OTHER = "other"          // 其他

    val ALL_TYPES = listOf(DOCUMENT, WEB, APP, DATA, DESIGN, RESEARCH, OTHER)
}

/**
 * 项目状态枚举
 */
object ProjectStatus {
    const val ACTIVE = "active"        // 活跃中
    const val PAUSED = "paused"        // 已暂停
    const val COMPLETED = "completed"  // 已完成
    const val ARCHIVED = "archived"    // 已归档
    const val DELETED = "deleted"      // 已删除

    val ALL_STATUS = listOf(ACTIVE, PAUSED, COMPLETED, ARCHIVED)

    fun isTerminal(status: String): Boolean {
        return status == COMPLETED || status == ARCHIVED || status == DELETED
    }
}

/**
 * 项目实体
 *
 * 存储项目元数据、状态和统计信息
 */
@Entity(
    tableName = "projects",
    indices = [
        Index(value = ["userId"]),
        Index(value = ["status"]),
        Index(value = ["type"]),
        Index(value = ["createdAt"]),
        Index(value = ["updatedAt"]),
        Index(value = ["isFavorite"]),
        Index(value = ["isArchived"])
    ]
)
data class ProjectEntity(
    @PrimaryKey
    val id: String,

    /** 项目名称 */
    val name: String,

    /** 项目描述 */
    val description: String? = null,

    /** 项目类型 */
    val type: String = ProjectType.OTHER,

    /** 项目状态 */
    val status: String = ProjectStatus.ACTIVE,

    /** 所属用户ID */
    val userId: String,

    /** 项目根路径（本地文件系统） */
    val rootPath: String? = null,

    /** 项目图标（Base64或URL） */
    val icon: String? = null,

    /** 项目封面图（Base64或URL） */
    val coverImage: String? = null,

    /** 标签（JSON数组） */
    val tags: String? = null, // ["tag1", "tag2"]

    /** 项目元数据（JSON对象） */
    val metadata: String? = null, // {"key": "value"}

    /** 是否收藏 */
    val isFavorite: Boolean = false,

    /** 是否已归档 */
    val isArchived: Boolean = false,

    /** 是否已同步到后端 */
    val isSynced: Boolean = false,

    /** 后端项目ID（用于同步） */
    val remoteId: String? = null,

    /** 最后同步时间 */
    val lastSyncedAt: Long? = null,

    // ===== 统计信息 =====

    /** 文件总数 */
    val fileCount: Int = 0,

    /** 总大小（字节） */
    val totalSize: Long = 0,

    /** 最后访问时间 */
    val lastAccessedAt: Long? = null,

    /** 访问次数 */
    val accessCount: Int = 0,

    // ===== Git 相关 =====

    /** 是否启用Git */
    val gitEnabled: Boolean = false,

    /** Git远程仓库URL */
    val gitRemoteUrl: String? = null,

    /** Git当前分支 */
    val gitBranch: String? = null,

    /** 最后提交哈希 */
    val lastCommitHash: String? = null,

    /** 未提交更改数 */
    val uncommittedChanges: Int = 0,

    // ===== 时间戳 =====

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 更新时间 */
    val updatedAt: Long = System.currentTimeMillis(),

    /** 完成时间 */
    val completedAt: Long? = null
) {
    /**
     * 获取标签列表
     */
    fun getTagList(): List<String> {
        return try {
            tags?.let {
                kotlinx.serialization.json.Json.decodeFromString<List<String>>(it)
            } ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * 获取可读的文件大小
     */
    fun getReadableSize(): String {
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        var size = totalSize.toDouble()
        var unitIndex = 0

        while (size >= 1024 && unitIndex < units.size - 1) {
            size /= 1024
            unitIndex++
        }

        return String.format("%.2f %s", size, units[unitIndex])
    }

    /**
     * 获取状态显示名称
     */
    fun getStatusDisplayName(): String {
        return when (status) {
            ProjectStatus.ACTIVE -> "进行中"
            ProjectStatus.PAUSED -> "已暂停"
            ProjectStatus.COMPLETED -> "已完成"
            ProjectStatus.ARCHIVED -> "已归档"
            ProjectStatus.DELETED -> "已删除"
            else -> "未知"
        }
    }

    /**
     * 获取类型显示名称
     */
    fun getTypeDisplayName(): String {
        return when (type) {
            ProjectType.DOCUMENT -> "文档"
            ProjectType.WEB -> "网站"
            ProjectType.APP -> "应用"
            ProjectType.DATA -> "数据"
            ProjectType.DESIGN -> "设计"
            ProjectType.RESEARCH -> "研究"
            ProjectType.OTHER -> "其他"
            else -> "未知"
        }
    }
}

/**
 * 项目文件实体
 *
 * 存储项目中的文件信息
 */
@Entity(
    tableName = "project_files",
    indices = [
        Index(value = ["projectId"]),
        Index(value = ["parentId"]),
        Index(value = ["type"]),
        Index(value = ["path"]),
        Index(value = ["updatedAt"])
    ]
)
data class ProjectFileEntity(
    @PrimaryKey
    val id: String,

    /** 所属项目ID */
    val projectId: String,

    /** 父文件夹ID（null表示根目录） */
    val parentId: String? = null,

    /** 文件名 */
    val name: String,

    /** 相对路径（相对于项目根目录） */
    val path: String,

    /** 文件类型：file / folder */
    val type: String = "file",

    /** MIME类型 */
    val mimeType: String? = null,

    /** 文件大小（字节） */
    val size: Long = 0,

    /** 文件扩展名 */
    val extension: String? = null,

    /** 文件内容（小文件可直接存储） */
    val content: String? = null,

    /** 内容是否已加密 */
    val isEncrypted: Boolean = false,

    /** 文件哈希（用于同步检测） */
    val hash: String? = null,

    /** 是否在编辑器中打开 */
    val isOpen: Boolean = false,

    /** 是否有未保存更改 */
    val isDirty: Boolean = false,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 更新时间 */
    val updatedAt: Long = System.currentTimeMillis(),

    /** 最后访问时间 */
    val lastAccessedAt: Long? = null
) {
    /**
     * 是否为文件夹
     */
    fun isFolder(): Boolean = type == "folder"

    /**
     * 是否为文件
     */
    fun isFile(): Boolean = type == "file"

    /**
     * 获取可读大小
     */
    fun getReadableSize(): String {
        if (isFolder()) return "-"

        val units = arrayOf("B", "KB", "MB", "GB")
        var size = this.size.toDouble()
        var unitIndex = 0

        while (size >= 1024 && unitIndex < units.size - 1) {
            size /= 1024
            unitIndex++
        }

        return String.format("%.1f %s", size, units[unitIndex])
    }

    /**
     * 获取文件图标类型
     */
    fun getIconType(): String {
        if (isFolder()) return "folder"

        return when (extension?.lowercase()) {
            "md", "markdown" -> "markdown"
            "txt" -> "text"
            "json" -> "json"
            "xml" -> "xml"
            "html", "htm" -> "html"
            "css" -> "css"
            "js", "jsx", "ts", "tsx" -> "javascript"
            "kt", "kts" -> "kotlin"
            "java" -> "java"
            "py" -> "python"
            "swift" -> "swift"
            "go" -> "go"
            "rs" -> "rust"
            "c", "cpp", "h", "hpp" -> "cpp"
            "sql" -> "sql"
            "sh", "bash", "zsh" -> "shell"
            "yml", "yaml" -> "yaml"
            "png", "jpg", "jpeg", "gif", "webp", "svg" -> "image"
            "mp4", "mov", "avi", "mkv" -> "video"
            "mp3", "wav", "ogg", "flac" -> "audio"
            "pdf" -> "pdf"
            "doc", "docx" -> "word"
            "xls", "xlsx" -> "excel"
            "ppt", "pptx" -> "powerpoint"
            "zip", "rar", "7z", "tar", "gz" -> "archive"
            else -> "file"
        }
    }
}

/**
 * 项目活动记录实体
 *
 * 记录项目的操作历史
 */
@Entity(
    tableName = "project_activities",
    indices = [
        Index(value = ["projectId"]),
        Index(value = ["createdAt"])
    ]
)
data class ProjectActivityEntity(
    @PrimaryKey
    val id: String,

    /** 所属项目ID */
    val projectId: String,

    /** 活动类型 */
    val type: String, // created, updated, file_added, file_deleted, status_changed, etc.

    /** 活动描述 */
    val description: String,

    /** 相关文件ID（可选） */
    val fileId: String? = null,

    /** 额外数据（JSON） */
    val data: String? = null,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis()
)
