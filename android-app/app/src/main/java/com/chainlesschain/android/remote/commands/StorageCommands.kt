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

    // ==================== SMART 数据 ====================

    /**
     * 获取 SMART 数据
     *
     * @param driveName 驱动器名称
     */
    suspend fun getSmartData(driveName: String): Result<SmartDataResponse> {
        return client.invoke("storage.getSmartData", mapOf("driveName" to driveName))
    }

    /**
     * 运行 SMART 测试
     *
     * @param driveName 驱动器名称
     * @param testType 测试类型 (short, long, conveyance)
     */
    suspend fun runSmartTest(
        driveName: String,
        testType: String = "short"
    ): Result<SmartTestResponse> {
        return client.invoke("storage.runSmartTest", mapOf(
            "driveName" to driveName,
            "testType" to testType
        ))
    }

    // ==================== 磁盘管理 ====================

    /**
     * 挂载磁盘
     *
     * @param device 设备路径
     * @param mountPoint 挂载点
     * @param fileSystem 文件系统类型
     * @param options 挂载选项
     */
    suspend fun mount(
        device: String,
        mountPoint: String,
        fileSystem: String? = null,
        options: List<String>? = null
    ): Result<MountResponse> {
        val params = mutableMapOf<String, Any>(
            "device" to device,
            "mountPoint" to mountPoint
        )
        fileSystem?.let { params["fileSystem"] = it }
        options?.let { params["options"] = it }
        return client.invoke("storage.mount", params)
    }

    /**
     * 卸载磁盘
     *
     * @param mountPoint 挂载点或设备
     * @param force 是否强制卸载
     */
    suspend fun unmount(
        mountPoint: String,
        force: Boolean = false
    ): Result<UnmountResponse> {
        return client.invoke("storage.unmount", mapOf(
            "mountPoint" to mountPoint,
            "force" to force
        ))
    }

    /**
     * 弹出可移动设备
     *
     * @param device 设备名称
     */
    suspend fun eject(device: String): Result<EjectResponse> {
        return client.invoke("storage.eject", mapOf("device" to device))
    }

    /**
     * 获取已挂载设备列表
     */
    suspend fun getMounts(): Result<MountsResponse> {
        return client.invoke("storage.getMounts", emptyMap())
    }

    // ==================== 磁盘基准测试 ====================

    /**
     * 磁盘读写速度测试
     *
     * @param targetPath 测试路径
     * @param blockSize 块大小 (KB)
     * @param testSize 测试数据大小 (MB)
     */
    suspend fun benchmark(
        targetPath: String,
        blockSize: Int = 1024,
        testSize: Int = 100
    ): Result<BenchmarkResponse> {
        return client.invoke("storage.benchmark", mapOf(
            "targetPath" to targetPath,
            "blockSize" to blockSize,
            "testSize" to testSize
        ))
    }

    /**
     * 顺序读写测试
     *
     * @param targetPath 测试路径
     */
    suspend fun sequentialTest(targetPath: String): Result<SequentialTestResponse> {
        return client.invoke("storage.sequentialTest", mapOf("targetPath" to targetPath))
    }

    /**
     * 随机读写测试
     *
     * @param targetPath 测试路径
     */
    suspend fun randomTest(targetPath: String): Result<RandomTestResponse> {
        return client.invoke("storage.randomTest", mapOf("targetPath" to targetPath))
    }

    // ==================== 存储分析 ====================

    /**
     * 按文件类型分析存储
     *
     * @param targetPath 分析路径
     */
    suspend fun analyzeByType(targetPath: String? = null): Result<TypeAnalysisResponse> {
        val params = mutableMapOf<String, Any>()
        targetPath?.let { params["targetPath"] = it }
        return client.invoke("storage.analyzeByType", params)
    }

    /**
     * 按文件年龄分析存储
     *
     * @param targetPath 分析路径
     */
    suspend fun analyzeByAge(targetPath: String? = null): Result<AgeAnalysisResponse> {
        val params = mutableMapOf<String, Any>()
        targetPath?.let { params["targetPath"] = it }
        return client.invoke("storage.analyzeByAge", params)
    }

    /**
     * 按文件夹大小分析
     *
     * @param targetPath 分析路径
     * @param depth 分析深度
     */
    suspend fun analyzeByFolder(
        targetPath: String? = null,
        depth: Int = 2
    ): Result<FolderAnalysisResponse> {
        val params = mutableMapOf<String, Any>("depth" to depth)
        targetPath?.let { params["targetPath"] = it }
        return client.invoke("storage.analyzeByFolder", params)
    }

    /**
     * 获取存储分析报告
     *
     * @param targetPath 分析路径
     */
    suspend fun getAnalysisReport(targetPath: String? = null): Result<AnalysisReportResponse> {
        val params = mutableMapOf<String, Any>()
        targetPath?.let { params["targetPath"] = it }
        return client.invoke("storage.getAnalysisReport", params)
    }

    // ==================== 重复文件 ====================

    /**
     * 查找重复文件
     *
     * @param targetPath 搜索路径
     * @param minSize 最小文件大小
     * @param method 比较方法 (hash, name, size)
     */
    suspend fun findDuplicates(
        targetPath: String? = null,
        minSize: Long = 1024,
        method: String = "hash"
    ): Result<DuplicatesResponse> {
        val params = mutableMapOf<String, Any>(
            "minSize" to minSize,
            "method" to method
        )
        targetPath?.let { params["targetPath"] = it }
        return client.invoke("storage.findDuplicates", params)
    }

    /**
     * 删除重复文件
     *
     * @param duplicateIds 要删除的重复文件 ID 列表
     * @param keepFirst 是否保留第一个
     */
    suspend fun deleteDuplicates(
        duplicateIds: List<String>,
        keepFirst: Boolean = true
    ): Result<DeleteDuplicatesResponse> {
        return client.invoke("storage.deleteDuplicates", mapOf(
            "duplicateIds" to duplicateIds,
            "keepFirst" to keepFirst
        ))
    }

    // ==================== 配额管理 ====================

    /**
     * 获取用户配额
     *
     * @param username 用户名（可选）
     */
    suspend fun getQuota(username: String? = null): Result<QuotaResponse> {
        val params = mutableMapOf<String, Any>()
        username?.let { params["username"] = it }
        return client.invoke("storage.getQuota", params)
    }

    /**
     * 设置用户配额
     *
     * @param username 用户名
     * @param softLimit 软限制（字节）
     * @param hardLimit 硬限制（字节）
     */
    suspend fun setQuota(
        username: String,
        softLimit: Long,
        hardLimit: Long
    ): Result<SetQuotaResponse> {
        return client.invoke("storage.setQuota", mapOf(
            "username" to username,
            "softLimit" to softLimit,
            "hardLimit" to hardLimit
        ))
    }

    // ==================== 磁盘加密 ====================

    /**
     * 获取加密状态
     *
     * @param driveName 驱动器名称
     */
    suspend fun getEncryptionStatus(driveName: String): Result<EncryptionStatusResponse> {
        return client.invoke("storage.getEncryptionStatus", mapOf("driveName" to driveName))
    }

    /**
     * 加密驱动器
     *
     * @param driveName 驱动器名称
     * @param password 密码
     * @param algorithm 加密算法
     */
    suspend fun encryptDrive(
        driveName: String,
        password: String,
        algorithm: String = "AES-256"
    ): Result<EncryptDriveResponse> {
        return client.invoke("storage.encryptDrive", mapOf(
            "driveName" to driveName,
            "password" to password,
            "algorithm" to algorithm
        ))
    }

    /**
     * 解锁加密驱动器
     *
     * @param driveName 驱动器名称
     * @param password 密码
     */
    suspend fun unlockDrive(
        driveName: String,
        password: String
    ): Result<UnlockDriveResponse> {
        return client.invoke("storage.unlockDrive", mapOf(
            "driveName" to driveName,
            "password" to password
        ))
    }

    /**
     * 锁定加密驱动器
     *
     * @param driveName 驱动器名称
     */
    suspend fun lockDrive(driveName: String): Result<LockDriveResponse> {
        return client.invoke("storage.lockDrive", mapOf("driveName" to driveName))
    }

    // ==================== 磁盘 I/O ====================

    /**
     * 获取磁盘 I/O 统计
     */
    suspend fun getDiskIO(): Result<DiskIOResponse> {
        return client.invoke("storage.getDiskIO", emptyMap())
    }

    /**
     * 获取磁盘 I/O 历史
     *
     * @param driveName 驱动器名称
     * @param duration 时间范围（秒）
     */
    suspend fun getDiskIOHistory(
        driveName: String? = null,
        duration: Int = 60
    ): Result<DiskIOHistoryResponse> {
        val params = mutableMapOf<String, Any>("duration" to duration)
        driveName?.let { params["driveName"] = it }
        return client.invoke("storage.getDiskIOHistory", params)
    }

    // ==================== 文件索引 ====================

    /**
     * 更新文件索引
     *
     * @param targetPath 索引路径
     */
    suspend fun updateIndex(targetPath: String? = null): Result<UpdateIndexResponse> {
        val params = mutableMapOf<String, Any>()
        targetPath?.let { params["targetPath"] = it }
        return client.invoke("storage.updateIndex", params)
    }

    /**
     * 获取索引状态
     */
    suspend fun getIndexStatus(): Result<IndexStatusResponse> {
        return client.invoke("storage.getIndexStatus", emptyMap())
    }

    /**
     * 快速搜索文件（使用索引）
     *
     * @param query 搜索关键词
     * @param limit 最大结果数
     */
    suspend fun indexSearch(
        query: String,
        limit: Int = 100
    ): Result<IndexSearchResponse> {
        return client.invoke("storage.indexSearch", mapOf(
            "query" to query,
            "limit" to limit
        ))
    }

    // ==================== 可移动设备 ====================

    /**
     * 获取可移动设备列表
     */
    suspend fun getRemovableDevices(): Result<RemovableDevicesResponse> {
        return client.invoke("storage.getRemovableDevices", emptyMap())
    }

    /**
     * 安全移除设备
     *
     * @param device 设备名称
     */
    suspend fun safelyRemove(device: String): Result<SafelyRemoveResponse> {
        return client.invoke("storage.safelyRemove", mapOf("device" to device))
    }

    // ==================== 磁盘空间清理建议 ====================

    /**
     * 获取清理建议
     *
     * @param targetPath 分析路径
     */
    suspend fun getCleanupSuggestions(targetPath: String? = null): Result<CleanupSuggestionsResponse> {
        val params = mutableMapOf<String, Any>()
        targetPath?.let { params["targetPath"] = it }
        return client.invoke("storage.getCleanupSuggestions", params)
    }

    /**
     * 清理系统缓存
     *
     * @param categories 清理类别
     */
    suspend fun clearSystemCache(
        categories: List<String> = listOf("temp", "cache", "logs")
    ): Result<ClearCacheResponse> {
        return client.invoke("storage.clearSystemCache", mapOf("categories" to categories))
    }

    /**
     * 获取可回收空间
     */
    suspend fun getReclaimableSpace(): Result<ReclaimableSpaceResponse> {
        return client.invoke("storage.getReclaimableSpace", emptyMap())
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

// ==================== SMART 数据响应 ====================

@Serializable
data class SmartDataResponse(
    val success: Boolean,
    val driveName: String,
    val smartSupported: Boolean,
    val smartEnabled: Boolean,
    val overallHealth: String,
    val temperature: Int? = null,
    val powerOnHours: Long? = null,
    val attributes: List<SmartAttribute>
)

@Serializable
data class SmartAttribute(
    val id: Int,
    val name: String,
    val value: Int,
    val worst: Int,
    val threshold: Int,
    val rawValue: Long,
    val status: String
)

@Serializable
data class SmartTestResponse(
    val success: Boolean,
    val driveName: String,
    val testType: String,
    val status: String,  // "started", "running", "completed", "failed"
    val estimatedDuration: Long? = null,
    val message: String
)

// ==================== 磁盘管理响应 ====================

@Serializable
data class MountResponse(
    val success: Boolean,
    val device: String,
    val mountPoint: String,
    val message: String
)

@Serializable
data class UnmountResponse(
    val success: Boolean,
    val mountPoint: String,
    val message: String
)

@Serializable
data class EjectResponse(
    val success: Boolean,
    val device: String,
    val message: String
)

@Serializable
data class MountsResponse(
    val success: Boolean,
    val mounts: List<MountInfo>,
    val total: Int
)

@Serializable
data class MountInfo(
    val device: String,
    val mountPoint: String,
    val fileSystem: String,
    val options: List<String>,
    val total: Long,
    val used: Long,
    val available: Long
)

// ==================== 基准测试响应 ====================

@Serializable
data class BenchmarkResponse(
    val success: Boolean,
    val targetPath: String,
    val readSpeed: Long,  // bytes per second
    val writeSpeed: Long,
    val readSpeedFormatted: String,
    val writeSpeedFormatted: String,
    val iops: Int? = null,
    val latency: Double? = null,
    val duration: Long
)

@Serializable
data class SequentialTestResponse(
    val success: Boolean,
    val readSpeed: Long,
    val writeSpeed: Long,
    val readSpeedFormatted: String,
    val writeSpeedFormatted: String
)

@Serializable
data class RandomTestResponse(
    val success: Boolean,
    val read4kSpeed: Long,
    val write4kSpeed: Long,
    val readIops: Int,
    val writeIops: Int,
    val readLatency: Double,
    val writeLatency: Double
)

// ==================== 存储分析响应 ====================

@Serializable
data class TypeAnalysisResponse(
    val success: Boolean,
    val categories: List<TypeCategory>,
    val totalSize: Long,
    val totalFiles: Int
)

@Serializable
data class TypeCategory(
    val type: String,  // "documents", "images", "videos", "audio", "archives", "other"
    val extensions: List<String>,
    val fileCount: Int,
    val size: Long,
    val sizeFormatted: String,
    val percentage: Double
)

@Serializable
data class AgeAnalysisResponse(
    val success: Boolean,
    val ranges: List<AgeRange>,
    val totalSize: Long,
    val totalFiles: Int
)

@Serializable
data class AgeRange(
    val label: String,  // "last 24 hours", "last week", "last month", etc.
    val fileCount: Int,
    val size: Long,
    val sizeFormatted: String,
    val percentage: Double
)

@Serializable
data class FolderAnalysisResponse(
    val success: Boolean,
    val folders: List<FolderSizeInfo>,
    val totalSize: Long
)

@Serializable
data class FolderSizeInfo(
    val path: String,
    val name: String,
    val size: Long,
    val sizeFormatted: String,
    val fileCount: Int,
    val percentage: Double,
    val children: List<FolderSizeInfo>? = null
)

@Serializable
data class AnalysisReportResponse(
    val success: Boolean,
    val report: StorageAnalysisReport
)

@Serializable
data class StorageAnalysisReport(
    val analyzedPath: String,
    val totalSize: Long,
    val totalFiles: Int,
    val totalFolders: Int,
    val largestFiles: List<LargeFile>,
    val oldestFiles: List<RecentFile>,
    val duplicateSpaceWasted: Long,
    val reclaimableSpace: Long,
    val suggestions: List<String>
)

// ==================== 重复文件响应 ====================

@Serializable
data class DuplicatesResponse(
    val success: Boolean,
    val groups: List<DuplicateGroup>,
    val totalGroups: Int,
    val totalFiles: Int,
    val totalWastedSpace: Long,
    val wastedSpaceFormatted: String
)

@Serializable
data class DuplicateGroup(
    val id: String,
    val hash: String,
    val size: Long,
    val sizeFormatted: String,
    val files: List<DuplicateFile>,
    val wastedSpace: Long
)

@Serializable
data class DuplicateFile(
    val id: String,
    val path: String,
    val name: String,
    val modifiedAt: Long
)

@Serializable
data class DeleteDuplicatesResponse(
    val success: Boolean,
    val deletedCount: Int,
    val freedSpace: Long,
    val freedSpaceFormatted: String,
    val errors: List<String>? = null
)

// ==================== 配额响应 ====================

@Serializable
data class QuotaResponse(
    val success: Boolean,
    val quotas: List<UserQuota>
)

@Serializable
data class UserQuota(
    val username: String,
    val softLimit: Long,
    val hardLimit: Long,
    val used: Long,
    val usedPercent: Double,
    val inGracePeriod: Boolean
)

@Serializable
data class SetQuotaResponse(
    val success: Boolean,
    val username: String,
    val softLimit: Long,
    val hardLimit: Long,
    val message: String
)

// ==================== 加密响应 ====================

@Serializable
data class EncryptionStatusResponse(
    val success: Boolean,
    val driveName: String,
    val encrypted: Boolean,
    val locked: Boolean,
    val algorithm: String? = null,
    val type: String? = null  // "BitLocker", "LUKS", etc.
)

@Serializable
data class EncryptDriveResponse(
    val success: Boolean,
    val driveName: String,
    val status: String,
    val progress: Double? = null,
    val message: String
)

@Serializable
data class UnlockDriveResponse(
    val success: Boolean,
    val driveName: String,
    val mountPoint: String? = null,
    val message: String
)

@Serializable
data class LockDriveResponse(
    val success: Boolean,
    val driveName: String,
    val message: String
)

// ==================== 磁盘 I/O 响应 ====================

@Serializable
data class DiskIOResponse(
    val success: Boolean,
    val disks: List<DiskIOStats>,
    val totalReadBytes: Long,
    val totalWriteBytes: Long
)

@Serializable
data class DiskIOStats(
    val name: String,
    val readBytes: Long,
    val writeBytes: Long,
    val readOps: Long,
    val writeOps: Long,
    val readBytesPerSec: Long,
    val writeBytesPerSec: Long,
    val utilization: Double
)

@Serializable
data class DiskIOHistoryResponse(
    val success: Boolean,
    val history: List<DiskIODataPoint>,
    val duration: Int
)

@Serializable
data class DiskIODataPoint(
    val timestamp: Long,
    val readBytesPerSec: Long,
    val writeBytesPerSec: Long,
    val utilization: Double
)

// ==================== 文件索引响应 ====================

@Serializable
data class UpdateIndexResponse(
    val success: Boolean,
    val indexedFiles: Int,
    val duration: Long,
    val message: String
)

@Serializable
data class IndexStatusResponse(
    val success: Boolean,
    val indexed: Boolean,
    val lastUpdated: Long? = null,
    val totalFiles: Int,
    val indexSize: Long,
    val status: String  // "ready", "updating", "disabled"
)

@Serializable
data class IndexSearchResponse(
    val success: Boolean,
    val query: String,
    val results: List<IndexSearchResult>,
    val total: Int,
    val duration: Long
)

@Serializable
data class IndexSearchResult(
    val path: String,
    val name: String,
    val size: Long,
    val modifiedAt: Long,
    val type: String
)

// ==================== 可移动设备响应 ====================

@Serializable
data class RemovableDevicesResponse(
    val success: Boolean,
    val devices: List<RemovableDevice>,
    val total: Int
)

@Serializable
data class RemovableDevice(
    val name: String,
    val label: String? = null,
    val type: String,  // "usb", "sd", "cdrom"
    val size: Long,
    val mountPoint: String? = null,
    val mounted: Boolean,
    val ejectable: Boolean
)

@Serializable
data class SafelyRemoveResponse(
    val success: Boolean,
    val device: String,
    val message: String
)

// ==================== 清理建议响应 ====================

@Serializable
data class CleanupSuggestionsResponse(
    val success: Boolean,
    val suggestions: List<CleanupSuggestion>,
    val totalReclaimable: Long,
    val totalReclaimableFormatted: String
)

@Serializable
data class CleanupSuggestion(
    val category: String,
    val description: String,
    val size: Long,
    val sizeFormatted: String,
    val itemCount: Int,
    val risk: String,  // "low", "medium", "high"
    val actionId: String
)

@Serializable
data class ClearCacheResponse(
    val success: Boolean,
    val categories: List<String>,
    val clearedSize: Long,
    val clearedSizeFormatted: String,
    val errors: List<String>? = null
)

@Serializable
data class ReclaimableSpaceResponse(
    val success: Boolean,
    val categories: List<ReclaimableCategory>,
    val totalReclaimable: Long,
    val totalReclaimableFormatted: String
)

@Serializable
data class ReclaimableCategory(
    val name: String,
    val description: String,
    val size: Long,
    val sizeFormatted: String,
    val itemCount: Int
)
