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
    val status: String, // "in_progress", "completed", "failed", "cancelled"
    val progress: Double,
    val createdAt: Long,
    val updatedAt: Long,
    val completedAt: Long? = null,
    val error: String? = null
)
