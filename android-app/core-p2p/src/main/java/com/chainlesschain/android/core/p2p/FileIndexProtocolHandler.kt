package com.chainlesschain.android.core.p2p

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.filetransfer.FileTransferManager
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import java.util.UUID
import javax.inject.Inject

/**
 * 文件索引协议处理器
 *
 * 负责处理 PC 端的文件索引请求，实现以下功能：
 * 1. 响应文件索引请求（FILE_INDEX_REQUEST）
 * 2. 发送文件索引响应（FILE_INDEX_RESPONSE）
 * 3. 支持增量同步（基于时间戳）
 * 4. 支持分类过滤
 * 5. 支持分页查询
 *
 * 协议定义参考：desktop-app-vue/src/main/p2p/file-sync-protocols.js
 */
class FileIndexProtocolHandler @Inject constructor(
    private val context: Context,
    private val externalFileDao: ExternalFileDao,
    private val fileTransferManager: FileTransferManager,
    private val connectionManager: P2PConnectionManager,
    private val json: Json
) {
    companion object {
        private const val TAG = "FileIndexProtocolHandler"

        // 默认分页大小
        private const val DEFAULT_PAGE_SIZE = 500
        private const val MAX_PAGE_SIZE = 1000
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /**
     * 处理 P2P 消息
     */
    fun handleMessage(message: P2PMessage) {
        when (message.type) {
            MessageType.FILE_INDEX_REQUEST -> handleIndexRequest(message)
            MessageType.FILE_PULL_REQUEST -> handleFilePullRequest(message)
            else -> {
                Log.w(TAG, "Unknown message type: ${message.type}")
            }
        }
    }

    /**
     * 处理文件索引请求
     */
    private fun handleIndexRequest(message: P2PMessage) {
        scope.launch {
            try {
                val request = json.decodeFromString<IndexRequest>(message.payload)
                Log.i(TAG, "收到文件索引请求: categories=${request.categories}, since=${request.since}, offset=${request.offset}")

                // 验证参数
                val limit = request.limit.coerceAtMost(MAX_PAGE_SIZE)
                val offset = request.offset.coerceAtLeast(0)

                // 查询文件列表
                val files = externalFileDao.getFiles(
                    categories = request.categories,
                    since = request.since,
                    limit = limit,
                    offset = offset
                )

                // 查询总数
                val total = externalFileDao.getCount(
                    categories = request.categories,
                    since = request.since
                )

                // 转换为响应格式
                val fileList = files.map { entity ->
                    FileInfo(
                        id = entity.id,
                        displayName = entity.displayName,
                        displayPath = entity.displayPath,
                        size = entity.size,
                        mimeType = entity.mimeType,
                        category = entity.category.name,
                        lastModified = entity.lastModified,
                        uri = entity.uri,
                        parentFolder = entity.parentFolder,
                        extension = entity.extension,
                        isFavorite = entity.isFavorite,
                        scannedAt = entity.scannedAt
                    )
                }

                // 构建响应
                val response = IndexResponse(
                    requestId = request.requestId,
                    files = fileList,
                    total = total,
                    offset = offset,
                    limit = limit,
                    hasMore = (offset + limit) < total,
                    timestamp = System.currentTimeMillis()
                )

                // 发送响应
                sendIndexResponse(message.fromDeviceId, response)

                Log.i(TAG, "文件索引响应已发送: ${files.size} 个文件, 总数 $total")

            } catch (e: Exception) {
                Log.e(TAG, "处理文件索引请求失败", e)
                sendError(message.fromDeviceId, message.payload, "处理请求失败: ${e.message}")
            }
        }
    }

    /**
     * 处理文件拉取请求
     */
    private fun handleFilePullRequest(message: P2PMessage) {
        scope.launch {
            try {
                val request = json.decodeFromString<FilePullRequest>(message.payload)
                Log.i(TAG, "收到文件拉取请求: fileId=${request.fileId}")

                // 查询文件信息
                val file = externalFileDao.getById(request.fileId)
                if (file == null) {
                    sendError(message.fromDeviceId, message.payload, "文件不存在: ${request.fileId}")
                    return@launch
                }

                // 检查文件是否存在
                val fileUri = android.net.Uri.parse(file.uri)
                val exists = try {
                    context.contentResolver.openInputStream(fileUri)?.use { true } ?: false
                } catch (e: Exception) {
                    false
                }

                if (!exists) {
                    sendError(message.fromDeviceId, message.payload, "文件无法访问: ${file.displayName}")
                    return@launch
                }

                // 使用 FileTransferManager 发送文件
                val transferMetadata = fileTransferManager.sendFile(
                    fileUri = fileUri,
                    toDeviceId = message.fromDeviceId
                )

                if (transferMetadata == null) {
                    sendError(message.fromDeviceId, message.payload, "文件传输初始化失败")
                    return@launch
                }

                // 发送拉取响应
                val response = FilePullResponse(
                    requestId = request.requestId,
                    fileId = request.fileId,
                    transferId = transferMetadata.transferId,
                    fileName = file.displayName,
                    size = file.size,
                    mimeType = file.mimeType,
                    checksum = transferMetadata.checksum,
                    success = true
                )

                sendFilePullResponse(message.fromDeviceId, response)

                Log.i(TAG, "文件拉取响应已发送: transferId=${transferMetadata.transferId}")

            } catch (e: Exception) {
                Log.e(TAG, "处理文件拉取请求失败", e)
                sendError(message.fromDeviceId, message.payload, "文件传输失败: ${e.message}")
            }
        }
    }

    /**
     * 发送文件索引响应
     */
    private fun sendIndexResponse(deviceId: String, response: IndexResponse) {
        scope.launch {
            try {
                val message = P2PMessage(
                    id = UUID.randomUUID().toString(),
                    fromDeviceId = getLocalDeviceId(),
                    toDeviceId = deviceId,
                    type = MessageType.FILE_INDEX_RESPONSE,
                    payload = json.encodeToString(response),
                    timestamp = System.currentTimeMillis(),
                    requiresAck = false,
                    isAcknowledged = false
                )

                connectionManager.sendMessage(deviceId, message)

            } catch (e: Exception) {
                Log.e(TAG, "发送文件索引响应失败", e)
            }
        }
    }

    /**
     * 发送文件拉取响应
     */
    private fun sendFilePullResponse(deviceId: String, response: FilePullResponse) {
        scope.launch {
            try {
                val message = P2PMessage(
                    id = UUID.randomUUID().toString(),
                    fromDeviceId = getLocalDeviceId(),
                    toDeviceId = deviceId,
                    type = MessageType.FILE_PULL_RESPONSE,
                    payload = json.encodeToString(response),
                    timestamp = System.currentTimeMillis(),
                    requiresAck = false,
                    isAcknowledged = false
                )

                connectionManager.sendMessage(deviceId, message)

            } catch (e: Exception) {
                Log.e(TAG, "发送文件拉取响应失败", e)
            }
        }
    }

    /**
     * 发送错误响应
     */
    private fun sendError(deviceId: String, requestData: String, errorMessage: String) {
        scope.launch {
            try {
                // 尝试解析请求ID
                val requestId = try {
                    val request = json.decodeFromString<BaseRequest>(requestData)
                    request.requestId
                } catch (e: Exception) {
                    "unknown"
                }

                val error = ErrorResponse(
                    requestId = requestId,
                    error = errorMessage,
                    timestamp = System.currentTimeMillis()
                )

                val message = P2PMessage(
                    id = UUID.randomUUID().toString(),
                    fromDeviceId = getLocalDeviceId(),
                    toDeviceId = deviceId,
                    type = MessageType.TEXT,  // Use TEXT for error messages
                    payload = json.encodeToString(error),
                    timestamp = System.currentTimeMillis(),
                    requiresAck = false,
                    isAcknowledged = false
                )

                connectionManager.sendMessage(deviceId, message)

            } catch (e: Exception) {
                Log.e(TAG, "发送错误响应失败", e)
            }
        }
    }

    /**
     * 通知文件索引变更
     */
    fun notifyIndexChanged(deviceId: String) {
        scope.launch {
            try {
                val notification = IndexChangedNotification(
                    timestamp = System.currentTimeMillis(),
                    message = "文件索引已更新"
                )

                val message = P2PMessage(
                    id = UUID.randomUUID().toString(),
                    fromDeviceId = getLocalDeviceId(),
                    toDeviceId = deviceId,
                    type = MessageType.TEXT,  // Use TEXT for notifications
                    payload = json.encodeToString(notification),
                    timestamp = System.currentTimeMillis(),
                    requiresAck = false,
                    isAcknowledged = false
                )

                connectionManager.sendMessage(deviceId, message)

                Log.i(TAG, "文件索引变更通知已发送")

            } catch (e: Exception) {
                Log.e(TAG, "发送索引变更通知失败", e)
            }
        }
    }

    /**
     * 获取本地设备 ID（优先使用 DID）
     */
    private fun getLocalDeviceId(): String {
        // 尝试从 DID 存储文件读取（与 core-did DIDManager 共享）
        try {
            val didFile = java.io.File(context.filesDir, "did_keypair.json")
            if (didFile.exists()) {
                val content = didFile.readText()
                val jsonObj = org.json.JSONObject(content)
                val did = jsonObj.optString("did", "")
                if (did.isNotEmpty()) {
                    return did
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read DID from storage, falling back to Android ID", e)
        }

        // 回退到 Android ID
        return android.provider.Settings.Secure.getString(
            context.contentResolver,
            android.provider.Settings.Secure.ANDROID_ID
        )
    }

    // ========== 数据类定义 ==========

    @Serializable
    data class BaseRequest(
        val requestId: String
    )

    @Serializable
    data class IndexRequest(
        val requestId: String,
        val categories: List<String>? = null,
        val since: Long? = null,
        val limit: Int = DEFAULT_PAGE_SIZE,
        val offset: Int = 0
    )

    @Serializable
    data class IndexResponse(
        val requestId: String,
        val files: List<FileInfo>,
        val total: Int,
        val offset: Int,
        val limit: Int,
        val hasMore: Boolean,
        val timestamp: Long
    )

    @Serializable
    data class FileInfo(
        val id: String,
        val displayName: String,
        val displayPath: String?,
        val size: Long,
        val mimeType: String,
        val category: String,
        val lastModified: Long,
        val uri: String,
        val parentFolder: String?,
        val extension: String?,
        val isFavorite: Boolean,
        val scannedAt: Long
    )

    @Serializable
    data class FilePullRequest(
        val requestId: String,
        val fileId: String,
        val path: String
    )

    @Serializable
    data class FilePullResponse(
        val requestId: String,
        val fileId: String,
        val transferId: String,
        val fileName: String,
        val size: Long,
        val mimeType: String,
        val checksum: String,
        val success: Boolean
    )

    @Serializable
    data class IndexChangedNotification(
        val timestamp: Long,
        val message: String
    )

    @Serializable
    data class ErrorResponse(
        val requestId: String,
        val error: String,
        val timestamp: Long
    )
}
