package com.chainlesschain.android.core.p2p.filetransfer.model

import kotlinx.serialization.Serializable

/**
 * 文件分块
 *
 * Represents a single chunk of file data being transferred.
 * Sent with FILE_TRANSFER_CHUNK message.
 */
@Serializable
data class FileChunk(
    /** 传输ID（关联FileTransferMetadata） */
    val transferId: String,

    /** 分块索引（0-based） */
    val chunkIndex: Int,

    /** 总分块数 */
    val totalChunks: Int,

    /** 分块数据（Base64编码） */
    val data: String,

    /** 分块大小（字节） */
    val chunkSize: Int,

    /** 分块SHA256校验和 */
    val chunkChecksum: String,

    /** 是否为最后一块 */
    val isLastChunk: Boolean = chunkIndex == totalChunks - 1,

    /** 分块在文件中的偏移量 */
    val offset: Long = chunkIndex.toLong() * chunkSize,

    /** 创建时间 */
    val timestamp: Long = System.currentTimeMillis()
) {
    /**
     * 获取实际数据大小（解码后的字节数）
     */
    fun getDataSize(): Int {
        // Base64 encoded data is approximately 4/3 the size of original
        return (data.length * 3) / 4
    }

    /**
     * 获取进度百分比
     */
    fun getProgressPercent(): Float {
        return ((chunkIndex + 1).toFloat() / totalChunks) * 100
    }

    companion object {
        /**
         * 创建文件分块
         */
        fun create(
            transferId: String,
            chunkIndex: Int,
            totalChunks: Int,
            data: ByteArray,
            chunkChecksum: String
        ): FileChunk {
            return FileChunk(
                transferId = transferId,
                chunkIndex = chunkIndex,
                totalChunks = totalChunks,
                data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP),
                chunkSize = data.size,
                chunkChecksum = chunkChecksum
            )
        }

        /**
         * 解码分块数据
         */
        fun decodeData(chunk: FileChunk): ByteArray {
            return android.util.Base64.decode(chunk.data, android.util.Base64.NO_WRAP)
        }
    }
}

/**
 * 分块确认
 *
 * Sent with FILE_TRANSFER_ACK message to acknowledge receipt of a chunk.
 */
@Serializable
data class FileChunkAck(
    /** 传输ID */
    val transferId: String,

    /** 已确认的分块索引 */
    val chunkIndex: Int,

    /** 是否成功接收 */
    val success: Boolean,

    /** 错误消息（如果失败） */
    val errorMessage: String? = null,

    /** 下一个期望的分块索引（用于流控） */
    val nextExpectedChunk: Int = chunkIndex + 1,

    /** 时间戳 */
    val timestamp: Long = System.currentTimeMillis()
)
