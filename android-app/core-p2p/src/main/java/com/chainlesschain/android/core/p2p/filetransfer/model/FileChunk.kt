package com.chainlesschain.android.core.p2p.filetransfer.model

import kotlinx.serialization.Serializable
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/**
 * 文件分块
 *
 * Represents a single chunk of file data being transferred.
 * Sent with FILE_TRANSFER_CHUNK message.
 *
 * Features:
 * - Optional GZIP compression for chunks >100KB (reduces bandwidth by 30-60%)
 * - SHA256 checksum for integrity verification
 * - Base64 encoding for P2P transport
 */
@Serializable
data class FileChunk(
    /** 传输ID（关联FileTransferMetadata） */
    val transferId: String,

    /** 分块索引（0-based） */
    val chunkIndex: Int,

    /** 总分块数 */
    val totalChunks: Int,

    /** 分块数据（Base64编码，可能已压缩） */
    val data: String,

    /** 分块大小（字节，原始未压缩大小） */
    val chunkSize: Int,

    /** 分块SHA256校验和（原始数据的校验和） */
    val chunkChecksum: String,

    /** 是否已压缩 */
    val isCompressed: Boolean = false,

    /** 压缩后大小（字节），未压缩时等于chunkSize */
    val compressedSize: Int = chunkSize,

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

    /**
     * 获取压缩比（1.0 = 无压缩，< 1.0 = 有压缩效果）
     */
    fun getCompressionRatio(): Float {
        return if (isCompressed && chunkSize > 0) {
            compressedSize.toFloat() / chunkSize
        } else {
            1.0f
        }
    }

    companion object {
        /** 压缩阈值：仅压缩大于此大小的分块 */
        const val COMPRESSION_THRESHOLD = 100 * 1024 // 100KB

        /** 压缩最小节省比例：仅当压缩能节省超过此比例时才使用压缩 */
        const val MIN_COMPRESSION_RATIO = 0.85f // 压缩后应小于原始的85%

        /** 可压缩的MIME类型前缀 */
        private val COMPRESSIBLE_TYPES = listOf(
            "text/",
            "application/json",
            "application/xml",
            "application/javascript",
            "application/x-javascript",
            "application/ecmascript",
            "application/xhtml+xml",
            "image/svg+xml"
        )

        /**
         * 检查MIME类型是否适合压缩
         */
        fun isCompressibleMimeType(mimeType: String?): Boolean {
            if (mimeType == null) return false
            return COMPRESSIBLE_TYPES.any { mimeType.startsWith(it) }
        }

        /**
         * 创建文件分块（自动决定是否压缩）
         */
        fun create(
            transferId: String,
            chunkIndex: Int,
            totalChunks: Int,
            data: ByteArray,
            chunkChecksum: String,
            mimeType: String? = null,
            enableCompression: Boolean = true
        ): FileChunk {
            val originalSize = data.size
            val shouldCompress = enableCompression &&
                    originalSize > COMPRESSION_THRESHOLD &&
                    isCompressibleMimeType(mimeType)

            return if (shouldCompress) {
                val compressed = compress(data)
                val compressionRatio = compressed.size.toFloat() / originalSize

                // 仅当压缩有效时使用压缩数据
                if (compressionRatio < MIN_COMPRESSION_RATIO) {
                    FileChunk(
                        transferId = transferId,
                        chunkIndex = chunkIndex,
                        totalChunks = totalChunks,
                        data = android.util.Base64.encodeToString(compressed, android.util.Base64.NO_WRAP),
                        chunkSize = originalSize,
                        chunkChecksum = chunkChecksum,
                        isCompressed = true,
                        compressedSize = compressed.size
                    )
                } else {
                    // 压缩效果不佳，使用原始数据
                    createUncompressed(transferId, chunkIndex, totalChunks, data, chunkChecksum)
                }
            } else {
                createUncompressed(transferId, chunkIndex, totalChunks, data, chunkChecksum)
            }
        }

        /**
         * 创建未压缩的分块
         */
        private fun createUncompressed(
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
                chunkChecksum = chunkChecksum,
                isCompressed = false,
                compressedSize = data.size
            )
        }

        /**
         * 解码分块数据（自动处理压缩）
         */
        fun decodeData(chunk: FileChunk): ByteArray {
            val decoded = android.util.Base64.decode(chunk.data, android.util.Base64.NO_WRAP)
            return if (chunk.isCompressed) {
                decompress(decoded)
            } else {
                decoded
            }
        }

        /**
         * GZIP压缩
         */
        fun compress(data: ByteArray): ByteArray {
            ByteArrayOutputStream().use { baos ->
                GZIPOutputStream(baos).use { gzip ->
                    gzip.write(data)
                }
                return baos.toByteArray()
            }
        }

        /**
         * GZIP解压
         */
        fun decompress(data: ByteArray): ByteArray {
            ByteArrayInputStream(data).use { bais ->
                GZIPInputStream(bais).use { gzip ->
                    return gzip.readBytes()
                }
            }
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
