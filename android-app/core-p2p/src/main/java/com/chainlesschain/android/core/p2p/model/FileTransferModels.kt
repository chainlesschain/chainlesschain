package com.chainlesschain.android.core.p2p.model

import kotlinx.serialization.Serializable

/**
 * 文件索引请求
 * PC端发送给Android端，请求文件索引列表
 */
@Serializable
data class FileIndexRequest(
    val requestId: String,
    val deviceId: String,
    val filters: IndexFilters? = null
)

/**
 * 文件索引过滤器
 */
@Serializable
data class IndexFilters(
    val category: List<String>? = null,  // DOCUMENT, IMAGE, VIDEO, AUDIO, CODE, OTHER
    val since: Long? = null,              // 时间戳，仅同步此时间之后的文件
    val limit: Int = 500,
    val offset: Int = 0
)

/**
 * 文件索引响应
 * Android端返回给PC端的文件列表
 */
@Serializable
data class FileIndexResponse(
    val requestId: String,
    val files: List<FileTransferModel>,
    val totalCount: Int,
    val hasMore: Boolean,
    val syncTimestamp: Long
)

/**
 * 文件传输模型
 * 用于在设备间传输的文件信息
 */
@Serializable
data class FileTransferModel(
    val id: String,
    val displayName: String,
    val mimeType: String?,
    val size: Long,
    val category: String,
    val lastModified: Long,
    val checksum: String?,
    val displayPath: String?,
    val metadata: Map<String, String>? = null
)

/**
 * 文件拉取请求
 * PC端请求拉取特定文件
 */
@Serializable
data class FilePullRequest(
    val requestId: String,
    val fileId: String,
    val transferId: String,
    val options: PullOptions? = null
)

/**
 * 文件拉取选项
 */
@Serializable
data class PullOptions(
    val cache: Boolean = true,
    val priority: String = "normal"  // low, normal, high
)

/**
 * 文件拉取响应
 * Android端确认是否接受拉取请求
 */
@Serializable
data class FilePullResponse(
    val requestId: String,
    val transferId: String,
    val accepted: Boolean,
    val fileMetadata: FileMetadata? = null,
    val error: String? = null
)

/**
 * 文件元数据
 * 用于文件传输的详细信息
 */
@Serializable
data class FileMetadata(
    val id: String,
    val size: Long,
    val checksum: String,
    val totalChunks: Int,
    val chunkSize: Int = 65536  // 64KB
)

/**
 * 文件分块消息
 * 文件传输过程中的分块数据
 */
@Serializable
data class FileChunkMessage(
    val transferId: String,
    val chunkIndex: Int,
    val totalChunks: Int,
    val data: ByteArray,
    val checksum: String
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as FileChunkMessage

        if (transferId != other.transferId) return false
        if (chunkIndex != other.chunkIndex) return false
        if (totalChunks != other.totalChunks) return false
        if (!data.contentEquals(other.data)) return false
        if (checksum != other.checksum) return false

        return true
    }

    override fun hashCode(): Int {
        var result = transferId.hashCode()
        result = 31 * result + chunkIndex
        result = 31 * result + totalChunks
        result = 31 * result + data.contentHashCode()
        result = 31 * result + checksum.hashCode()
        return result
    }
}

/**
 * 文件传输完成消息
 */
@Serializable
data class FileTransferCompleteMessage(
    val transferId: String,
    val fileId: String,
    val success: Boolean,
    val totalBytes: Long,
    val checksum: String?,
    val error: String? = null
)

/**
 * 协议类型常量
 */
object FileProtocolTypes {
    const val INDEX_REQUEST = "file:index-request"
    const val INDEX_RESPONSE = "file:index-response"
    const val FILE_PULL_REQUEST = "file:pull-request"
    const val FILE_PULL_RESPONSE = "file:pull-response"
    const val FILE_CHUNK = "file:chunk"
    const val FILE_TRANSFER_COMPLETE = "file:transfer-complete"
}
