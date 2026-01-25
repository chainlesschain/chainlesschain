package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 文件分类枚举
 */
enum class FileCategory {
    DOCUMENT,   // 文档 (pdf, doc, txt, md, etc.)
    IMAGE,      // 图片 (jpg, png, gif, etc.)
    VIDEO,      // 视频 (mp4, avi, mkv, etc.)
    AUDIO,      // 音频 (mp3, wav, flac, etc.)
    ARCHIVE,    // 压缩包 (zip, rar, 7z, etc.)
    CODE,       // 代码文件 (kt, java, py, js, etc.)
    OTHER;      // 其他

    companion object {
        /**
         * 根据MIME类型判断文件分类
         */
        fun fromMimeType(mimeType: String): FileCategory {
            return when {
                mimeType.startsWith("image/") -> IMAGE
                mimeType.startsWith("video/") -> VIDEO
                mimeType.startsWith("audio/") -> AUDIO
                mimeType.startsWith("text/") -> DOCUMENT
                mimeType == "application/pdf" -> DOCUMENT
                mimeType == "application/msword" -> DOCUMENT
                mimeType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" -> DOCUMENT
                mimeType == "application/vnd.ms-excel" -> DOCUMENT
                mimeType == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" -> DOCUMENT
                mimeType == "application/vnd.ms-powerpoint" -> DOCUMENT
                mimeType == "application/vnd.openxmlformats-officedocument.presentationml.presentation" -> DOCUMENT
                mimeType == "application/zip" -> ARCHIVE
                mimeType == "application/x-rar-compressed" -> ARCHIVE
                mimeType == "application/x-7z-compressed" -> ARCHIVE
                mimeType == "application/x-tar" -> ARCHIVE
                mimeType == "application/gzip" -> ARCHIVE
                else -> OTHER
            }
        }

        /**
         * 根据文件扩展名判断文件分类
         */
        fun fromExtension(extension: String): FileCategory {
            return when (extension.lowercase()) {
                // 文档
                "pdf", "doc", "docx", "txt", "md", "rtf", "odt", "xls", "xlsx", "ppt", "pptx" -> DOCUMENT

                // 图片
                "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico" -> IMAGE

                // 视频
                "mp4", "avi", "mkv", "mov", "wmv", "flv", "webm", "m4v" -> VIDEO

                // 音频
                "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma" -> AUDIO

                // 压缩包
                "zip", "rar", "7z", "tar", "gz", "bz2", "xz" -> ARCHIVE

                // 代码文件
                "kt", "kts", "java", "py", "js", "jsx", "ts", "tsx", "c", "cpp", "h", "hpp",
                "swift", "go", "rs", "rb", "php", "html", "css", "scss", "sass", "json", "xml",
                "yml", "yaml", "sql", "sh", "bash", "gradle", "properties" -> CODE

                else -> OTHER
            }
        }
    }
}

/**
 * 外部文件实体
 *
 * 用于缓存手机上的文件索引，提供快速浏览和搜索功能
 */
@Entity(
    tableName = "external_files",
    indices = [
        Index(value = ["uri"], unique = true),
        Index(value = ["mimeType"]),
        Index(value = ["category"]),
        Index(value = ["size"]),
        Index(value = ["lastModified"]),
        Index(value = ["scannedAt"]),
        Index(value = ["isFavorite"]),
        Index(value = ["displayName"])
    ]
)
data class ExternalFileEntity(
    @PrimaryKey
    val id: String,

    /** Content URI (唯一标识符) */
    val uri: String,

    /** 显示名称（文件名） */
    val displayName: String,

    /** MIME类型 */
    val mimeType: String,

    /** 文件大小（字节） */
    val size: Long,

    /** 文件分类 */
    val category: FileCategory,

    /** 最后修改时间戳 */
    val lastModified: Long,

    /** 显示路径（用户友好的路径） */
    val displayPath: String? = null,

    /** 父文件夹名称 */
    val parentFolder: String? = null,

    /** 扫描时间戳 */
    val scannedAt: Long = System.currentTimeMillis(),

    /** 是否收藏 */
    val isFavorite: Boolean = false,

    /** 文件扩展名 */
    val extension: String? = null
) {
    /**
     * 获取可读的文件大小
     */
    fun getReadableSize(): String {
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        var currentSize = size.toDouble()
        var unitIndex = 0

        while (currentSize >= 1024 && unitIndex < units.size - 1) {
            currentSize /= 1024
            unitIndex++
        }

        return String.format("%.2f %s", currentSize, units[unitIndex])
    }

    /**
     * 获取分类显示名称
     */
    fun getCategoryDisplayName(): String {
        return when (category) {
            FileCategory.DOCUMENT -> "文档"
            FileCategory.IMAGE -> "图片"
            FileCategory.VIDEO -> "视频"
            FileCategory.AUDIO -> "音频"
            FileCategory.ARCHIVE -> "压缩包"
            FileCategory.CODE -> "代码"
            FileCategory.OTHER -> "其他"
        }
    }

    /**
     * 是否过期（扫描时间超过7天）
     */
    fun isStale(): Boolean {
        val sevenDaysInMillis = 7 * 24 * 60 * 60 * 1000L
        return System.currentTimeMillis() - scannedAt > sevenDaysInMillis
    }
}
