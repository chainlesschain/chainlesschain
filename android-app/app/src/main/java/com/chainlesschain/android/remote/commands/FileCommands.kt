package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件传输命令 API
 *
 * 提供类型安全的文件传输相关命令
 */
@Singleton
class FileCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 请求上传文件（Android → PC）
     */
    suspend fun requestUpload(
        fileName: String,
        fileSize: Long,
        checksum: String? = null,
        metadata: Map<String, Any>? = null
    ): Result<UploadRequestResponse> {
        val params = mutableMapOf<String, Any>(
            "fileName" to fileName,
            "fileSize" to fileSize
        )

        checksum?.let { params["checksum"] = it }
        metadata?.let { params["metadata"] = it }

        return client.invoke("file.requestUpload", params)
    }

    /**
     * 上传文件分块
     */
    suspend fun uploadChunk(
        transferId: String,
        chunkIndex: Int,
        chunkData: String // Base64 编码的数据
    ): Result<UploadChunkResponse> {
        val params = mapOf(
            "transferId" to transferId,
            "chunkIndex" to chunkIndex,
            "chunkData" to chunkData
        )

        return client.invoke("file.uploadChunk", params)
    }

    /**
     * 完成上传
     */
    suspend fun completeUpload(
        transferId: String
    ): Result<CompleteUploadResponse> {
        val params = mapOf(
            "transferId" to transferId
        )

        return client.invoke("file.completeUpload", params)
    }

    /**
     * 请求下载文件（PC → Android）
     */
    suspend fun requestDownload(
        filePath: String,
        fileName: String? = null
    ): Result<DownloadRequestResponse> {
        val params = mutableMapOf<String, Any>(
            "filePath" to filePath
        )

        fileName?.let { params["fileName"] = it }

        return client.invoke("file.requestDownload", params)
    }

    /**
     * 下载文件分块
     */
    suspend fun downloadChunk(
        transferId: String,
        chunkIndex: Int
    ): Result<DownloadChunkResponse> {
        val params = mapOf(
            "transferId" to transferId,
            "chunkIndex" to chunkIndex
        )

        return client.invoke("file.downloadChunk", params)
    }

    /**
     * 取消传输
     */
    suspend fun cancelTransfer(
        transferId: String
    ): Result<CancelTransferResponse> {
        val params = mapOf(
            "transferId" to transferId
        )

        return client.invoke("file.cancelTransfer", params)
    }

    /**
     * 列出传输任务
     */
    suspend fun listTransfers(
        status: String? = null,
        limit: Int = 50,
        offset: Int = 0
    ): Result<ListTransfersResponse> {
        val params = mutableMapOf<String, Any>(
            "limit" to limit,
            "offset" to offset
        )

        status?.let { params["status"] = it }

        return client.invoke("file.listTransfers", params)
    }

    // ==================== 暂停/恢复传输 ====================

    /**
     * 暂停传输
     *
     * @param transferId 传输 ID
     */
    suspend fun pauseTransfer(transferId: String): Result<TransferControlResponse> {
        return client.invoke("file.pauseTransfer", mapOf("transferId" to transferId))
    }

    /**
     * 恢复传输
     *
     * @param transferId 传输 ID
     */
    suspend fun resumeTransfer(transferId: String): Result<TransferControlResponse> {
        return client.invoke("file.resumeTransfer", mapOf("transferId" to transferId))
    }

    /**
     * 获取传输状态
     *
     * @param transferId 传输 ID
     */
    suspend fun getTransferStatus(transferId: String): Result<TransferStatusResponse> {
        return client.invoke("file.getTransferStatus", mapOf("transferId" to transferId))
    }

    /**
     * 重试失败的传输
     *
     * @param transferId 传输 ID
     */
    suspend fun retryTransfer(transferId: String): Result<TransferControlResponse> {
        return client.invoke("file.retryTransfer", mapOf("transferId" to transferId))
    }

    // ==================== 文件系统操作 ====================

    /**
     * 列出目录内容
     *
     * @param path 目录路径
     * @param showHidden 是否显示隐藏文件
     * @param recursive 是否递归列出
     * @param maxDepth 最大递归深度
     */
    suspend fun listDirectory(
        path: String,
        showHidden: Boolean = false,
        recursive: Boolean = false,
        maxDepth: Int = 1
    ): Result<DirectoryListResponse> {
        val params = mutableMapOf<String, Any>(
            "path" to path,
            "showHidden" to showHidden,
            "recursive" to recursive,
            "maxDepth" to maxDepth
        )
        return client.invoke("file.listDirectory", params)
    }

    /**
     * 获取文件/目录信息
     *
     * @param path 文件路径
     */
    suspend fun getFileInfo(path: String): Result<FileInfoResponse> {
        return client.invoke("file.getFileInfo", mapOf("path" to path))
    }

    /**
     * 检查文件是否存在
     *
     * @param path 文件路径
     */
    suspend fun exists(path: String): Result<FileExistsResponse> {
        return client.invoke("file.exists", mapOf("path" to path))
    }

    /**
     * 创建目录
     *
     * @param path 目录路径
     * @param recursive 是否递归创建父目录
     */
    suspend fun createDirectory(
        path: String,
        recursive: Boolean = true
    ): Result<FileOperationResponse> {
        return client.invoke("file.createDirectory", mapOf(
            "path" to path,
            "recursive" to recursive
        ))
    }

    /**
     * 删除文件或目录
     *
     * @param path 路径
     * @param recursive 是否递归删除（目录）
     * @param force 是否强制删除
     */
    suspend fun delete(
        path: String,
        recursive: Boolean = false,
        force: Boolean = false
    ): Result<FileOperationResponse> {
        return client.invoke("file.delete", mapOf(
            "path" to path,
            "recursive" to recursive,
            "force" to force
        ))
    }

    /**
     * 复制文件或目录
     *
     * @param source 源路径
     * @param destination 目标路径
     * @param overwrite 是否覆盖已存在的文件
     */
    suspend fun copy(
        source: String,
        destination: String,
        overwrite: Boolean = false
    ): Result<FileOperationResponse> {
        return client.invoke("file.copy", mapOf(
            "source" to source,
            "destination" to destination,
            "overwrite" to overwrite
        ))
    }

    /**
     * 移动/重命名文件或目录
     *
     * @param source 源路径
     * @param destination 目标路径
     * @param overwrite 是否覆盖已存在的文件
     */
    suspend fun move(
        source: String,
        destination: String,
        overwrite: Boolean = false
    ): Result<FileOperationResponse> {
        return client.invoke("file.move", mapOf(
            "source" to source,
            "destination" to destination,
            "overwrite" to overwrite
        ))
    }

    /**
     * 重命名文件或目录
     *
     * @param path 当前路径
     * @param newName 新名称（不含路径）
     */
    suspend fun rename(
        path: String,
        newName: String
    ): Result<FileOperationResponse> {
        return client.invoke("file.rename", mapOf(
            "path" to path,
            "newName" to newName
        ))
    }

    // ==================== 文件内容操作 ====================

    /**
     * 读取文件内容
     *
     * @param path 文件路径
     * @param encoding 编码（utf-8, base64, hex）
     * @param offset 读取起始位置
     * @param length 读取长度（-1 表示全部）
     */
    suspend fun readFile(
        path: String,
        encoding: String = "utf-8",
        offset: Long = 0,
        length: Long = -1
    ): Result<ReadFileResponse> {
        val params = mutableMapOf<String, Any>(
            "path" to path,
            "encoding" to encoding,
            "offset" to offset
        )
        if (length >= 0) params["length"] = length
        return client.invoke("file.readFile", params)
    }

    /**
     * 写入文件内容
     *
     * @param path 文件路径
     * @param content 内容
     * @param encoding 编码（utf-8, base64, hex）
     * @param append 是否追加模式
     * @param createParents 是否创建父目录
     */
    suspend fun writeFile(
        path: String,
        content: String,
        encoding: String = "utf-8",
        append: Boolean = false,
        createParents: Boolean = true
    ): Result<WriteFileResponse> {
        return client.invoke("file.writeFile", mapOf(
            "path" to path,
            "content" to content,
            "encoding" to encoding,
            "append" to append,
            "createParents" to createParents
        ))
    }

    /**
     * 追加内容到文件
     *
     * @param path 文件路径
     * @param content 内容
     * @param encoding 编码
     */
    suspend fun appendFile(
        path: String,
        content: String,
        encoding: String = "utf-8"
    ): Result<WriteFileResponse> {
        return writeFile(path, content, encoding, append = true)
    }

    /**
     * 截断文件
     *
     * @param path 文件路径
     * @param size 新大小（字节）
     */
    suspend fun truncate(
        path: String,
        size: Long = 0
    ): Result<FileOperationResponse> {
        return client.invoke("file.truncate", mapOf(
            "path" to path,
            "size" to size
        ))
    }

    // ==================== 文件搜索 ====================

    /**
     * 搜索文件
     *
     * @param directory 搜索目录
     * @param pattern 搜索模式（glob 或正则表达式）
     * @param recursive 是否递归搜索
     * @param maxResults 最大结果数
     * @param includeHidden 是否包含隐藏文件
     */
    suspend fun search(
        directory: String,
        pattern: String,
        recursive: Boolean = true,
        maxResults: Int = 100,
        includeHidden: Boolean = false
    ): Result<FileSearchResponse> {
        return client.invoke("file.search", mapOf(
            "directory" to directory,
            "pattern" to pattern,
            "recursive" to recursive,
            "maxResults" to maxResults,
            "includeHidden" to includeHidden
        ))
    }

    /**
     * 在文件内容中搜索
     *
     * @param directory 搜索目录
     * @param query 搜索关键词
     * @param filePattern 文件名过滤模式
     * @param caseSensitive 是否区分大小写
     * @param maxResults 最大结果数
     */
    suspend fun grep(
        directory: String,
        query: String,
        filePattern: String = "*",
        caseSensitive: Boolean = false,
        maxResults: Int = 100
    ): Result<GrepResponse> {
        return client.invoke("file.grep", mapOf(
            "directory" to directory,
            "query" to query,
            "filePattern" to filePattern,
            "caseSensitive" to caseSensitive,
            "maxResults" to maxResults
        ))
    }

    // ==================== 文件监控 ====================

    /**
     * 开始监控文件变化
     *
     * @param path 监控路径
     * @param recursive 是否递归监控子目录
     * @param events 监控的事件类型（create, modify, delete, rename）
     */
    suspend fun watch(
        path: String,
        recursive: Boolean = true,
        events: List<String> = listOf("create", "modify", "delete", "rename")
    ): Result<WatchResponse> {
        return client.invoke("file.watch", mapOf(
            "path" to path,
            "recursive" to recursive,
            "events" to events
        ))
    }

    /**
     * 停止监控
     *
     * @param watchId 监控 ID
     */
    suspend fun unwatch(watchId: String): Result<UnwatchResponse> {
        return client.invoke("file.unwatch", mapOf("watchId" to watchId))
    }

    /**
     * 列出所有文件监控
     */
    suspend fun listWatchers(): Result<WatchersListResponse> {
        return client.invoke("file.listWatchers", emptyMap())
    }

    // ==================== 压缩/解压 ====================

    /**
     * 压缩文件或目录
     *
     * @param sources 要压缩的文件/目录路径列表
     * @param destination 目标压缩文件路径
     * @param format 压缩格式（zip, tar, tar.gz, 7z）
     * @param level 压缩级别（1-9）
     */
    suspend fun compress(
        sources: List<String>,
        destination: String,
        format: String = "zip",
        level: Int = 6
    ): Result<CompressResponse> {
        return client.invoke("file.compress", mapOf(
            "sources" to sources,
            "destination" to destination,
            "format" to format,
            "level" to level
        ))
    }

    /**
     * 解压文件
     *
     * @param source 压缩文件路径
     * @param destination 目标目录
     * @param overwrite 是否覆盖已存在的文件
     */
    suspend fun decompress(
        source: String,
        destination: String,
        overwrite: Boolean = false
    ): Result<DecompressResponse> {
        return client.invoke("file.decompress", mapOf(
            "source" to source,
            "destination" to destination,
            "overwrite" to overwrite
        ))
    }

    /**
     * 列出压缩文件内容
     *
     * @param path 压缩文件路径
     */
    suspend fun listArchive(path: String): Result<ArchiveListResponse> {
        return client.invoke("file.listArchive", mapOf("path" to path))
    }

    // ==================== 权限和属性 ====================

    /**
     * 获取文件权限
     *
     * @param path 文件路径
     */
    suspend fun getPermissions(path: String): Result<PermissionsResponse> {
        return client.invoke("file.getPermissions", mapOf("path" to path))
    }

    /**
     * 设置文件权限（Unix 系统）
     *
     * @param path 文件路径
     * @param mode 权限模式（如 "755", "644"）
     * @param recursive 是否递归设置
     */
    suspend fun setPermissions(
        path: String,
        mode: String,
        recursive: Boolean = false
    ): Result<FileOperationResponse> {
        return client.invoke("file.setPermissions", mapOf(
            "path" to path,
            "mode" to mode,
            "recursive" to recursive
        ))
    }

    /**
     * 修改文件时间戳
     *
     * @param path 文件路径
     * @param accessTime 访问时间（毫秒时间戳）
     * @param modifyTime 修改时间（毫秒时间戳）
     */
    suspend fun touch(
        path: String,
        accessTime: Long? = null,
        modifyTime: Long? = null
    ): Result<FileOperationResponse> {
        val params = mutableMapOf<String, Any>("path" to path)
        accessTime?.let { params["accessTime"] = it }
        modifyTime?.let { params["modifyTime"] = it }
        return client.invoke("file.touch", params)
    }

    // ==================== 符号链接 ====================

    /**
     * 创建符号链接
     *
     * @param target 目标路径
     * @param linkPath 链接路径
     */
    suspend fun createSymlink(
        target: String,
        linkPath: String
    ): Result<FileOperationResponse> {
        return client.invoke("file.createSymlink", mapOf(
            "target" to target,
            "linkPath" to linkPath
        ))
    }

    /**
     * 读取符号链接目标
     *
     * @param path 链接路径
     */
    suspend fun readSymlink(path: String): Result<SymlinkResponse> {
        return client.invoke("file.readSymlink", mapOf("path" to path))
    }

    // ==================== 磁盘信息 ====================

    /**
     * 获取磁盘使用情况
     *
     * @param path 路径（用于确定磁盘）
     */
    suspend fun getDiskUsage(path: String = "/"): Result<DiskUsageResponse> {
        return client.invoke("file.getDiskUsage", mapOf("path" to path))
    }

    /**
     * 获取目录大小
     *
     * @param path 目录路径
     */
    suspend fun getDirectorySize(path: String): Result<DirectorySizeResponse> {
        return client.invoke("file.getDirectorySize", mapOf("path" to path))
    }

    // ==================== 文件哈希 ====================

    /**
     * 计算文件哈希值
     *
     * @param path 文件路径
     * @param algorithm 哈希算法（md5, sha1, sha256, sha512）
     */
    suspend fun getHash(
        path: String,
        algorithm: String = "sha256"
    ): Result<FileHashResponse> {
        return client.invoke("file.getHash", mapOf(
            "path" to path,
            "algorithm" to algorithm
        ))
    }

    /**
     * 比较两个文件
     *
     * @param path1 第一个文件路径
     * @param path2 第二个文件路径
     * @param method 比较方法（hash, byte, quick）
     */
    suspend fun compare(
        path1: String,
        path2: String,
        method: String = "hash"
    ): Result<FileCompareResponse> {
        return client.invoke("file.compare", mapOf(
            "path1" to path1,
            "path2" to path2,
            "method" to method
        ))
    }

    // ==================== 临时文件 ====================

    /**
     * 创建临时文件
     *
     * @param prefix 文件名前缀
     * @param suffix 文件名后缀
     * @param directory 临时目录（可选）
     */
    suspend fun createTempFile(
        prefix: String = "tmp",
        suffix: String = "",
        directory: String? = null
    ): Result<TempFileResponse> {
        val params = mutableMapOf<String, Any>(
            "prefix" to prefix,
            "suffix" to suffix
        )
        directory?.let { params["directory"] = it }
        return client.invoke("file.createTempFile", params)
    }

    /**
     * 创建临时目录
     *
     * @param prefix 目录名前缀
     * @param directory 父目录（可选）
     */
    suspend fun createTempDirectory(
        prefix: String = "tmp",
        directory: String? = null
    ): Result<TempFileResponse> {
        val params = mutableMapOf<String, Any>("prefix" to prefix)
        directory?.let { params["directory"] = it }
        return client.invoke("file.createTempDirectory", params)
    }

    // ==================== 剪贴板文件操作 ====================

    /**
     * 复制文件到剪贴板
     *
     * @param paths 文件路径列表
     */
    suspend fun copyToClipboard(paths: List<String>): Result<ClipboardResponse> {
        return client.invoke("file.copyToClipboard", mapOf("paths" to paths))
    }

    /**
     * 从剪贴板粘贴文件
     *
     * @param destination 目标目录
     */
    suspend fun pasteFromClipboard(destination: String): Result<ClipboardPasteResponse> {
        return client.invoke("file.pasteFromClipboard", mapOf("destination" to destination))
    }

    /**
     * 获取剪贴板中的文件列表
     */
    suspend fun getClipboardFiles(): Result<ClipboardFilesResponse> {
        return client.invoke("file.getClipboardFiles", emptyMap())
    }
}

/**
 * 上传请求响应
 */
@Serializable
data class UploadRequestResponse(
    val transferId: String,
    val chunkSize: Int,
    val totalChunks: Int,
    val resumeSupported: Boolean
)

/**
 * 上传分块响应
 */
@Serializable
data class UploadChunkResponse(
    val transferId: String,
    val chunkIndex: Int,
    val received: Boolean,
    val progress: Double,
    val remainingChunks: Int? = null
)

/**
 * 完成上传响应
 */
@Serializable
data class CompleteUploadResponse(
    val transferId: String,
    val status: String,
    val fileName: String,
    val filePath: String,
    val fileSize: Long,
    val duration: Long
)

/**
 * 下载请求响应
 */
@Serializable
data class DownloadRequestResponse(
    val transferId: String,
    val fileName: String,
    val fileSize: Long,
    val chunkSize: Int,
    val totalChunks: Int,
    val checksum: String?
)

/**
 * 下载分块响应
 */
@Serializable
data class DownloadChunkResponse(
    val transferId: String,
    val chunkIndex: Int,
    val chunkData: String, // Base64 编码的数据
    val chunkSize: Int,
    val isLastChunk: Boolean,
    val progress: Double
)

/**
 * 取消传输响应
 */
@Serializable
data class CancelTransferResponse(
    val transferId: String,
    val status: String
)

/**
 * 列出传输任务响应
 */
@Serializable
data class ListTransfersResponse(
    val transfers: List<TransferInfo>,
    val total: Int,
    val limit: Int,
    val offset: Int
)

/**
 * 传输信息
 */
@Serializable
data class TransferInfo(
    val id: String,
    val deviceDid: String,
    val direction: String, // "upload" or "download"
    val fileName: String,
    val fileSize: Long,
    val totalChunks: Int,
    val status: String, // "in_progress", "completed", "failed", "cancelled", "paused"
    val progress: Double,
    val createdAt: Long,
    val updatedAt: Long,
    val completedAt: Long? = null,
    val error: String? = null
)

// ==================== 传输控制响应 ====================

@Serializable
data class TransferControlResponse(
    val success: Boolean,
    val transferId: String,
    val status: String,
    val message: String? = null
)

@Serializable
data class TransferStatusResponse(
    val success: Boolean,
    val transferId: String,
    val status: String,
    val progress: Double,
    val bytesTransferred: Long,
    val totalBytes: Long,
    val chunksCompleted: Int,
    val totalChunks: Int,
    val speed: Long? = null,  // bytes per second
    val estimatedTimeRemaining: Long? = null,  // seconds
    val error: String? = null
)

// ==================== 文件系统操作响应 ====================

@Serializable
data class DirectoryListResponse(
    val success: Boolean,
    val path: String,
    val entries: List<FileEntry>,
    val total: Int
)

@Serializable
data class FileEntry(
    val name: String,
    val path: String,
    val type: String,  // "file", "directory", "symlink"
    val size: Long,
    val modifiedTime: Long,
    val createdTime: Long? = null,
    val accessedTime: Long? = null,
    val isHidden: Boolean = false,
    val isReadOnly: Boolean = false,
    val permissions: String? = null,  // Unix permissions like "rwxr-xr-x"
    val mimeType: String? = null
)

@Serializable
data class FileInfoResponse(
    val success: Boolean,
    val file: FileEntry? = null,
    val exists: Boolean = true,
    val message: String? = null
)

@Serializable
data class FileExistsResponse(
    val success: Boolean,
    val path: String,
    val exists: Boolean,
    val isFile: Boolean? = null,
    val isDirectory: Boolean? = null,
    val isSymlink: Boolean? = null
)

@Serializable
data class FileOperationResponse(
    val success: Boolean,
    val path: String? = null,
    val message: String? = null,
    val error: String? = null
)

// ==================== 文件内容操作响应 ====================

@Serializable
data class ReadFileResponse(
    val success: Boolean,
    val path: String,
    val content: String,
    val encoding: String,
    val size: Long,
    val bytesRead: Long,
    val truncated: Boolean = false
)

@Serializable
data class WriteFileResponse(
    val success: Boolean,
    val path: String,
    val bytesWritten: Long,
    val message: String? = null
)

// ==================== 文件搜索响应 ====================

@Serializable
data class FileSearchResponse(
    val success: Boolean,
    val directory: String,
    val pattern: String,
    val results: List<FileEntry>,
    val total: Int,
    val truncated: Boolean = false
)

@Serializable
data class GrepResponse(
    val success: Boolean,
    val directory: String,
    val query: String,
    val matches: List<GrepMatch>,
    val totalMatches: Int,
    val filesSearched: Int,
    val truncated: Boolean = false
)

@Serializable
data class GrepMatch(
    val file: String,
    val line: Int,
    val column: Int,
    val content: String,
    val context: GrepContext? = null
)

@Serializable
data class GrepContext(
    val before: List<String>? = null,
    val after: List<String>? = null
)

// ==================== 文件监控响应 ====================

@Serializable
data class WatchResponse(
    val success: Boolean,
    val watchId: String,
    val path: String,
    val recursive: Boolean,
    val events: List<String>
)

@Serializable
data class UnwatchResponse(
    val success: Boolean,
    val watchId: String,
    val message: String? = null
)

@Serializable
data class WatchersListResponse(
    val success: Boolean,
    val watchers: List<WatcherInfo>,
    val total: Int
)

@Serializable
data class WatcherInfo(
    val watchId: String,
    val path: String,
    val recursive: Boolean,
    val events: List<String>,
    val createdAt: Long,
    val eventCount: Int
)

// ==================== 压缩/解压响应 ====================

@Serializable
data class CompressResponse(
    val success: Boolean,
    val destination: String,
    val format: String,
    val size: Long,
    val filesCompressed: Int,
    val compressionRatio: Double? = null
)

@Serializable
data class DecompressResponse(
    val success: Boolean,
    val destination: String,
    val filesExtracted: Int,
    val totalSize: Long
)

@Serializable
data class ArchiveListResponse(
    val success: Boolean,
    val path: String,
    val format: String,
    val entries: List<ArchiveEntry>,
    val total: Int,
    val compressedSize: Long,
    val uncompressedSize: Long
)

@Serializable
data class ArchiveEntry(
    val name: String,
    val path: String,
    val type: String,  // "file" or "directory"
    val size: Long,
    val compressedSize: Long,
    val modifiedTime: Long? = null
)

// ==================== 权限响应 ====================

@Serializable
data class PermissionsResponse(
    val success: Boolean,
    val path: String,
    val mode: String,
    val owner: String? = null,
    val group: String? = null,
    val readable: Boolean,
    val writable: Boolean,
    val executable: Boolean
)

// ==================== 符号链接响应 ====================

@Serializable
data class SymlinkResponse(
    val success: Boolean,
    val linkPath: String,
    val targetPath: String,
    val targetExists: Boolean
)

// ==================== 磁盘信息响应 ====================

@Serializable
data class DiskUsageResponse(
    val success: Boolean,
    val path: String,
    val total: Long,
    val used: Long,
    val available: Long,
    val usedPercent: Double,
    val mountPoint: String? = null,
    val fileSystem: String? = null
)

@Serializable
data class DirectorySizeResponse(
    val success: Boolean,
    val path: String,
    val size: Long,
    val fileCount: Int,
    val directoryCount: Int
)

// ==================== 文件哈希响应 ====================

@Serializable
data class FileHashResponse(
    val success: Boolean,
    val path: String,
    val algorithm: String,
    val hash: String
)

@Serializable
data class FileCompareResponse(
    val success: Boolean,
    val path1: String,
    val path2: String,
    val method: String,
    val identical: Boolean,
    val difference: String? = null  // Description of difference if not identical
)

// ==================== 临时文件响应 ====================

@Serializable
data class TempFileResponse(
    val success: Boolean,
    val path: String,
    val isDirectory: Boolean = false
)

// ==================== 剪贴板响应 ====================

@Serializable
data class ClipboardResponse(
    val success: Boolean,
    val fileCount: Int,
    val message: String? = null
)

@Serializable
data class ClipboardPasteResponse(
    val success: Boolean,
    val destination: String,
    val filesPasted: Int,
    val files: List<String>
)

@Serializable
data class ClipboardFilesResponse(
    val success: Boolean,
    val files: List<String>,
    val total: Int
)
