package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 存储信息命令 API
 *
 * 提供类型安全的存储相关命令
 */
@Singleton
class StorageCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取磁盘列表
     */
    suspend fun getDisks(): Result<DisksResponse> {
        return client.invoke("storage.getDisks", emptyMap())
    }

    /**
     * 获取存储使用情况摘要
     */
    suspend fun getUsage(): Result<StorageUsageResponse> {
        return client.invoke("storage.getUsage", emptyMap())
    }

    /**
     * 获取分区信息
     */
    suspend fun getPartitions(): Result<PartitionsResponse> {
        return client.invoke("storage.getPartitions", emptyMap())
    }

    /**
     * 获取文件系统统计
     *
     * @param targetPath 目标路径
     */
    suspend fun getStats(targetPath: String? = null): Result<FileStatsResponse> {
        val params = mutableMapOf<String, Any>()
        targetPath?.let { params["targetPath"] = it }

        return client.invoke("storage.getStats", params)
    }

    /**
     * 获取文件夹大小
     *
     * @param folderPath 文件夹路径
     */
    suspend fun getFolderSize(folderPath: String): Result<FolderSizeResponse> {
        val params = mapOf("folderPath" to folderPath)
        return client.invoke("storage.getFolderSize", params)
    }

    /**
     * 查找大文件
     *
     * @param searchPath 搜索路径
     * @param minSize 最小文件大小（字节）
     * @param limit 返回数量限制
     */
    suspend fun getLargeFiles(
        searchPath: String? = null,
        minSize: Long = 100 * 1024 * 1024, // 100 MB
        limit: Int = 20
    ): Result<LargeFilesResponse> {
        val params = mutableMapOf<String, Any>(
            "minSize" to minSize,
            "limit" to limit
        )
        searchPath?.let { params["searchPath"] = it }

        return client.invoke("storage.getLargeFiles", params)
    }

    /**
     * 获取最近修改的文件
     *
     * @param searchPath 搜索路径
     * @param days 天数范围
     * @param limit 返回数量限制
     */
    suspend fun getRecentFiles(
        searchPath: String? = null,
        days: Int = 7,
        limit: Int = 50
    ): Result<RecentFilesResponse> {
        val params = mutableMapOf<String, Any>(
            "days" to days,
            "limit" to limit
        )
        searchPath?.let { params["searchPath"] = it }

        return client.invoke("storage.getRecentFiles", params)
    }

    /**
     * 清理临时文件
     *
     * @param dryRun 是否仅预览（不实际删除）
     * @param maxAge 最大文件年龄（天）
     */
    suspend fun cleanup(
        dryRun: Boolean = true,
        maxAge: Int = 7
    ): Result<CleanupResponse> {
        val params = mapOf(
            "dryRun" to dryRun,
            "maxAge" to maxAge
        )
        return client.invoke("storage.cleanup", params)
    }

    /**
     * 清空回收站
     *
     * @param dryRun 是否仅预览（不实际删除）
     */
    suspend fun emptyTrash(dryRun: Boolean = true): Result<EmptyTrashResponse> {
        val params = mapOf("dryRun" to dryRun)
        return client.invoke("storage.emptyTrash", params)
    }

    /**
     * 获取驱动器健康状态
     */
    suspend fun getDriveHealth(): Result<DriveHealthResponse> {
        return client.invoke("storage.getDriveHealth", emptyMap())
    }
}

// 响应数据类

@Serializable
data class DisksResponse(
    val success: Boolean,
    val disks: List<DiskInfo>,
    val total: Int
)

@Serializable
data class DiskInfo(
    val name: String,
    val label: String? = null,
    val fileSystem: String? = null,
    val type: String? = null,
    val mountPoint: String? = null,
    val size: Long,
    val free: Long,
    val used: Long,
    val usagePercent: Double,
    val sizeFormatted: String,
    val freeFormatted: String,
    val usedFormatted: String
)

@Serializable
data class StorageUsageResponse(
    val success: Boolean,
    val usage: StorageUsage
)

@Serializable
data class StorageUsage(
    val total: Long,
    val used: Long,
    val free: Long,
    val usagePercent: Double,
    val totalFormatted: String,
    val usedFormatted: String,
    val freeFormatted: String,
    val diskCount: Int
)

@Serializable
data class PartitionsResponse(
    val success: Boolean,
    val partitions: List<PartitionInfo>,
    val total: Int
)

@Serializable
data class PartitionInfo(
    val name: String,
    val size: Long,
    val type: String? = null,
    val blockSize: Int? = null,
    val fileSystem: String? = null,
    val mountPoint: String? = null,
    val uuid: String? = null
)

@Serializable
data class FileStatsResponse(
    val success: Boolean,
    val stats: FileStats
)

@Serializable
data class FileStats(
    val path: String,
    val isDirectory: Boolean,
    val fileCount: Int,
    val dirCount: Int,
    val totalSize: Long,
    val totalSizeFormatted: String,
    val createdAt: String? = null,
    val modifiedAt: String? = null,
    val accessedAt: String? = null
)

@Serializable
data class FolderSizeResponse(
    val success: Boolean,
    val folderPath: String,
    val size: Long,
    val sizeFormatted: String
)

@Serializable
data class LargeFilesResponse(
    val success: Boolean,
    val files: List<LargeFile>,
    val total: Int,
    val returned: Int,
    val minSize: Long,
    val minSizeFormatted: String
)

@Serializable
data class LargeFile(
    val path: String,
    val name: String,
    val size: Long,
    val sizeFormatted: String,
    val modifiedAt: String? = null
)

@Serializable
data class RecentFilesResponse(
    val success: Boolean,
    val files: List<RecentFile>,
    val total: Int,
    val returned: Int,
    val days: Int
)

@Serializable
data class RecentFile(
    val path: String,
    val name: String,
    val size: Long,
    val sizeFormatted: String,
    val modifiedAt: String,
    val modifiedTime: Long
)

@Serializable
data class CleanupResponse(
    val success: Boolean,
    val dryRun: Boolean,
    val maxAge: Int,
    val cleaned: CleanedInfo
)

@Serializable
data class CleanedInfo(
    val fileCount: Int,
    val totalSize: Long,
    val totalSizeFormatted: String,
    val files: List<CleanedFile>
)

@Serializable
data class CleanedFile(
    val path: String,
    val size: Long
)

@Serializable
data class EmptyTrashResponse(
    val success: Boolean,
    val dryRun: Boolean,
    val message: String
)

@Serializable
data class DriveHealthResponse(
    val success: Boolean,
    val drives: List<DriveHealth>,
    val total: Int,
    val error: String? = null
)

@Serializable
data class DriveHealth(
    val name: String? = null,
    val model: String? = null,
    val mediaType: String? = null,
    val size: Long? = null,
    val status: String? = null,
    val rotational: Boolean? = null,
    val state: String? = null
)
