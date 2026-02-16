package com.chainlesschain.android.core.database.entity

import androidx.annotation.StringRes
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.chainlesschain.android.core.database.R

/**
 * 文件导入类型
 */
enum class ImportType {
    COPY,   // 复制模式：完整复制文件到项目
    LINK,   // 链接模式：仅引用外部文件（节省空间）
    SYNC    // 同步模式：保持与外部文件同步（未来功能）
}

/**
 * 导入来源
 */
enum class ImportSource {
    FILE_BROWSER,   // 从文件浏览器导入
    SHARE_INTENT,   // 从系统分享导入
    AI_CHAT         // 从AI对话中引用导入
}

/**
 * 文件导入历史实体
 *
 * 记录从外部导入到项目的文件历史，便于追踪和管理
 */
@Entity(
    tableName = "file_import_history",
    foreignKeys = [
        ForeignKey(
            entity = ProjectEntity::class,
            parentColumns = ["id"],
            childColumns = ["projectId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["projectId"]),
        Index(value = ["importedAt"]),
        Index(value = ["sourceUri"]),
        Index(value = ["importType"]),
        Index(value = ["importedFrom"]),
        Index(value = ["projectFileId"])
    ]
)
data class FileImportHistoryEntity(
    @PrimaryKey
    val id: String,

    /** 目标项目ID */
    val projectId: String,

    /** 导入后的项目文件ID */
    val projectFileId: String,

    /** 源文件URI */
    val sourceUri: String,

    /** 源文件名 */
    val sourceFileName: String,

    /** 源文件大小（字节） */
    val sourceFileSize: Long,

    /** 导入类型 */
    val importType: ImportType,

    /** 导入时间戳 */
    val importedAt: Long = System.currentTimeMillis(),

    /** 导入来源 */
    val importedFrom: ImportSource,

    /** 源文件MIME类型 */
    val sourceMimeType: String? = null,

    /** 导入备注 */
    val note: String? = null
) {
    /**
     * 获取导入类型显示名称的字符串资源ID
     */
    @StringRes
    fun getImportTypeDisplayNameResId(): Int {
        return when (importType) {
            ImportType.COPY -> R.string.import_type_copy
            ImportType.LINK -> R.string.import_type_link
            ImportType.SYNC -> R.string.import_type_sync
        }
    }

    /**
     * 获取导入来源显示名称的字符串资源ID
     */
    @StringRes
    fun getImportSourceDisplayNameResId(): Int {
        return when (importedFrom) {
            ImportSource.FILE_BROWSER -> R.string.import_source_file_browser
            ImportSource.SHARE_INTENT -> R.string.import_source_share_intent
            ImportSource.AI_CHAT -> R.string.import_source_ai_chat
        }
    }

    /**
     * 获取导入类型显示名称
     */
    @Deprecated("Use getImportTypeDisplayNameResId() instead", ReplaceWith("getImportTypeDisplayNameResId()"))
    fun getImportTypeDisplayName(): String {
        return when (importType) {
            ImportType.COPY -> "复制"
            ImportType.LINK -> "链接"
            ImportType.SYNC -> "同步"
        }
    }

    /**
     * 获取导入来源显示名称
     */
    @Deprecated("Use getImportSourceDisplayNameResId() instead", ReplaceWith("getImportSourceDisplayNameResId()"))
    fun getImportSourceDisplayName(): String {
        return when (importedFrom) {
            ImportSource.FILE_BROWSER -> "文件浏览器"
            ImportSource.SHARE_INTENT -> "系统分享"
            ImportSource.AI_CHAT -> "AI对话"
        }
    }

    /**
     * 获取可读的文件大小
     */
    fun getReadableSize(): String {
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        var currentSize = sourceFileSize.toDouble()
        var unitIndex = 0

        while (currentSize >= 1024 && unitIndex < units.size - 1) {
            currentSize /= 1024
            unitIndex++
        }

        return String.format("%.2f %s", currentSize, units[unitIndex])
    }
}
