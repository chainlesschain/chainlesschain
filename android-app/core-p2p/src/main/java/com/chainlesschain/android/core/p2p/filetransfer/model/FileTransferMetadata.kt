package com.chainlesschain.android.core.p2p.filetransfer.model

import kotlinx.serialization.Serializable

/**
 * 文件传输元数据
 *
 * Contains all metadata about a file transfer including file info, checksum, and chunking details.
 * Sent with FILE_TRANSFER_REQUEST message to initiate transfer.
 */
@Serializable
data class FileTransferMetadata(
    /** 传输唯一标识符 */
    val transferId: String,

    /** 文件名（包含扩展名） */
    val fileName: String,

    /** 文件大小（字节） */
    val fileSize: Long,

    /** MIME类型 */
    val mimeType: String,

    /** 文件SHA256校验和 */
    val checksum: String,

    /** 缩略图数据（Base64，用于图片/视频预览，最大50KB） */
    val thumbnail: String? = null,

    /** 每个分块大小（字节） */
    val chunkSize: Int = DEFAULT_CHUNK_SIZE,

    /** 总分块数 */
    val totalChunks: Int,

    /** 发送方设备ID */
    val senderDeviceId: String,

    /** 接收方设备ID */
    val receiverDeviceId: String,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 文件扩展名 */
    val fileExtension: String = fileName.substringAfterLast('.', ""),

    /** 是否为媒体文件（图片、视频、音频） */
    val isMedia: Boolean = isMediaType(mimeType)
) {
    companion object {
        /** 默认分块大小: 256KB */
        const val DEFAULT_CHUNK_SIZE = 256 * 1024

        /** 大文件分块大小: 512KB (文件 > 100MB) */
        const val LARGE_FILE_CHUNK_SIZE = 512 * 1024

        /** 大文件阈值: 100MB */
        const val LARGE_FILE_THRESHOLD = 100L * 1024 * 1024

        /** 缩略图最大大小: 50KB */
        const val MAX_THUMBNAIL_SIZE = 50 * 1024

        /**
         * 根据文件大小计算最优分块大小
         */
        fun calculateOptimalChunkSize(fileSize: Long): Int {
            return if (fileSize > LARGE_FILE_THRESHOLD) {
                LARGE_FILE_CHUNK_SIZE
            } else {
                DEFAULT_CHUNK_SIZE
            }
        }

        /**
         * 根据文件大小和分块大小计算总分块数
         */
        fun calculateTotalChunks(fileSize: Long, chunkSize: Int): Int {
            return ((fileSize + chunkSize - 1) / chunkSize).toInt()
        }

        /**
         * 检查是否为媒体类型
         */
        fun isMediaType(mimeType: String): Boolean {
            return mimeType.startsWith("image/") ||
                    mimeType.startsWith("video/") ||
                    mimeType.startsWith("audio/")
        }

        /**
         * 创建传输元数据
         */
        fun create(
            transferId: String,
            fileName: String,
            fileSize: Long,
            mimeType: String,
            checksum: String,
            senderDeviceId: String,
            receiverDeviceId: String,
            thumbnail: String? = null
        ): FileTransferMetadata {
            val chunkSize = calculateOptimalChunkSize(fileSize)
            val totalChunks = calculateTotalChunks(fileSize, chunkSize)

            return FileTransferMetadata(
                transferId = transferId,
                fileName = fileName,
                fileSize = fileSize,
                mimeType = mimeType,
                checksum = checksum,
                thumbnail = thumbnail,
                chunkSize = chunkSize,
                totalChunks = totalChunks,
                senderDeviceId = senderDeviceId,
                receiverDeviceId = receiverDeviceId
            )
        }
    }

    /**
     * 获取人类可读的文件大小
     */
    fun getReadableFileSize(): String {
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        var size = fileSize.toDouble()
        var unitIndex = 0

        while (size >= 1024 && unitIndex < units.size - 1) {
            size /= 1024
            unitIndex++
        }

        return String.format("%.2f %s", size, units[unitIndex])
    }
}
