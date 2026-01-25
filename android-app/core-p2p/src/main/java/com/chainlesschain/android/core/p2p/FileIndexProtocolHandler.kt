package com.chainlesschain.android.core.p2p

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.p2p.filetransfer.FileTransferManager
import com.chainlesschain.android.core.p2p.model.*
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件索引协议处理器
 *
 * 职责：
 * - 处理PC端的文件索引请求
 * - 处理PC端的文件拉取请求
 * - 启动文件上传任务
 * - 验证文件访问权限
 */
@Singleton
class FileIndexProtocolHandler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val externalFileDao: ExternalFileDao,
    private val fileTransferManager: FileTransferManager,
    private val json: Json
) {
    companion object {
        private const val TAG = "FileIndexProtocolHandler"
        private const val CHUNK_SIZE = 65536 // 64KB
    }

    /**
     * 处理文件索引请求
     *
     * @param request 索引请求
     * @return 索引响应
     */
    suspend fun handleIndexRequest(request: FileIndexRequest): FileIndexResponse = withContext(Dispatchers.IO) {
        try {
            val filters = request.filters
            val categories = filters?.category
            val since = filters?.since
            val limit = filters?.limit ?: 500
            val offset = filters?.offset ?: 0

            // 从数据库查询文件
            val files = externalFileDao.getFiles(
                categories = categories,
                since = since,
                limit = limit,
                offset = offset
            )

            // 获取总数
            val totalCount = externalFileDao.getCount(
                categories = categories,
                since = since
            )

            // 转换为传输模型
            val transferModels = files.map { it.toTransferModel() }

            FileIndexResponse(
                requestId = request.requestId,
                files = transferModels,
                totalCount = totalCount,
                hasMore = offset + files.size < totalCount,
                syncTimestamp = System.currentTimeMillis()
            )
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Error handling index request", e)
            FileIndexResponse(
                requestId = request.requestId,
                files = emptyList(),
                totalCount = 0,
                hasMore = false,
                syncTimestamp = System.currentTimeMillis()
            )
        }
    }

    /**
     * 处理文件拉取请求
     *
     * @param request 拉取请求
     * @return 拉取响应
     */
    suspend fun handleFilePullRequest(request: FilePullRequest): FilePullResponse = withContext(Dispatchers.IO) {
        try {
            // 从数据库获取文件信息
            val file = externalFileDao.getById(request.fileId)

            if (file == null) {
                return@withContext FilePullResponse(
                    requestId = request.requestId,
                    transferId = request.transferId,
                    accepted = false,
                    error = "File not found"
                )
            }

            // 验证文件访问权限
            val hasPermission = checkFileAccess(file.uri)
            if (!hasPermission) {
                return@withContext FilePullResponse(
                    requestId = request.requestId,
                    transferId = request.transferId,
                    accepted = false,
                    error = "Permission denied"
                )
            }

            // 获取实际文件路径
            val filePath = getFilePathFromUri(file.uri)
            if (filePath == null) {
                return@withContext FilePullResponse(
                    requestId = request.requestId,
                    transferId = request.transferId,
                    accepted = false,
                    error = "Cannot access file"
                )
            }

            // 计算文件校验和
            val checksum = calculateChecksum(File(filePath))

            // 计算分块数量
            val totalChunks = calculateTotalChunks(file.size)

            // 创建文件元数据
            val metadata = FileMetadata(
                id = file.id,
                size = file.size,
                checksum = checksum,
                totalChunks = totalChunks,
                chunkSize = CHUNK_SIZE
            )

            // 启动文件上传（由FileTransferManager处理实际传输）
            fileTransferManager.startUpload(
                transferId = request.transferId,
                fileUri = Uri.parse(file.uri),
                metadata = com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata(
                    fileId = file.id,
                    fileName = file.displayName,
                    fileSize = file.size,
                    mimeType = file.mimeType ?: "application/octet-stream",
                    checksum = checksum
                )
            )

            FilePullResponse(
                requestId = request.requestId,
                transferId = request.transferId,
                accepted = true,
                fileMetadata = metadata
            )
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Error handling file pull request", e)
            FilePullResponse(
                requestId = request.requestId,
                transferId = request.transferId,
                accepted = false,
                error = e.message ?: "Unknown error"
            )
        }
    }

    /**
     * 验证文件访问权限
     */
    private fun checkFileAccess(uriString: String): Boolean {
        return try {
            val uri = Uri.parse(uriString)
            val contentResolver = context.contentResolver

            // 检查URI权限
            contentResolver.openInputStream(uri)?.use {
                true
            } ?: false
        } catch (e: Exception) {
            android.util.Log.e(TAG, "File access check failed", e)
            false
        }
    }

    /**
     * 从URI获取文件路径
     */
    private fun getFilePathFromUri(uriString: String): String? {
        return try {
            val uri = Uri.parse(uriString)
            val contentResolver = context.contentResolver

            // 如果是file://协议，直接返回路径
            if (uri.scheme == "file") {
                return uri.path
            }

            // 如果是content://协议，尝试获取真实路径
            if (uri.scheme == "content") {
                // 对于DocumentsProvider URIs
                if (DocumentsContract.isDocumentUri(context, uri)) {
                    val docId = DocumentsContract.getDocumentId(uri)

                    // 尝试直接访问文件描述符
                    return contentResolver.openFileDescriptor(uri, "r")?.use {
                        // 返回文件描述符路径（用于临时访问）
                        "/proc/self/fd/${it.fd}"
                    }
                }

                // 对于其他content URIs，使用输入流访问
                // 这种情况下我们需要复制到临时文件
                val tempFile = createTempFile(context)
                contentResolver.openInputStream(uri)?.use { input ->
                    tempFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
                return tempFile.absolutePath
            }

            null
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Failed to get file path from URI", e)
            null
        }
    }

    /**
     * 创建临时文件
     */
    private fun createTempFile(context: Context): File {
        val tempDir = context.cacheDir
        return File.createTempFile("p2p_transfer_", ".tmp", tempDir)
    }

    /**
     * 计算文件SHA256校验和
     */
    private fun calculateChecksum(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { fis ->
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (fis.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * 计算分块总数
     */
    private fun calculateTotalChunks(fileSize: Long): Int {
        return ((fileSize + CHUNK_SIZE - 1) / CHUNK_SIZE).toInt()
    }

    /**
     * 处理接收到的协议消息
     */
    suspend fun handleProtocolMessage(type: String, payload: String): String? = withContext(Dispatchers.IO) {
        try {
            when (type) {
                FileProtocolTypes.INDEX_REQUEST -> {
                    val request = json.decodeFromString<FileIndexRequest>(payload)
                    val response = handleIndexRequest(request)
                    json.encodeToString(FileIndexResponse.serializer(), response)
                }

                FileProtocolTypes.FILE_PULL_REQUEST -> {
                    val request = json.decodeFromString<FilePullRequest>(payload)
                    val response = handleFilePullRequest(request)
                    json.encodeToString(FilePullResponse.serializer(), response)
                }

                else -> {
                    android.util.Log.w(TAG, "Unknown protocol type: $type")
                    null
                }
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Error handling protocol message: $type", e)
            null
        }
    }
}

/**
 * 扩展函数：将ExternalFileEntity转换为FileTransferModel
 */
private fun ExternalFileEntity.toTransferModel(): FileTransferModel {
    return FileTransferModel(
        id = this.id,
        displayName = this.displayName,
        mimeType = this.mimeType,
        size = this.size,
        category = this.category.name,
        lastModified = this.lastModified,
        checksum = null,  // 校验和在实际拉取时计算
        displayPath = this.displayPath,
        metadata = null
    )
}
