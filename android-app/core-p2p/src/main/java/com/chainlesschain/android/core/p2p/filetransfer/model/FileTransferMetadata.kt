package com.chainlesschain.android.core.p2p.filetransfer.model

import kotlinx.serialization.Serializable

/**
 * 网络类型枚举
 */
enum class NetworkType {
    /** 未知网络 */
    UNKNOWN,
    /** WiFi网络 */
    WIFI,
    /** 移动数据 - 2G */
    CELLULAR_2G,
    /** 移动数据 - 3G */
    CELLULAR_3G,
    /** 移动数据 - 4G/LTE */
    CELLULAR_4G,
    /** 移动数据 - 5G */
    CELLULAR_5G,
    /** 以太网 */
    ETHERNET,
    /** 无网络 */
    NONE
}

/**
 * 文件传输元数据
 *
 * Contains all metadata about a file transfer including file info, checksum, and chunking details.
 * Sent with FILE_TRANSFER_REQUEST message to initiate transfer.
 *
 * Features:
 * - Adaptive chunk sizing based on network type and file size
 * - Support for compression negotiation
 * - Thumbnail preview for media files
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

    /** 是否启用压缩 */
    val compressionEnabled: Boolean = true,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 文件扩展名 */
    val fileExtension: String = fileName.substringAfterLast('.', ""),

    /** 是否为媒体文件（图片、视频、音频） */
    val isMedia: Boolean = isMediaType(mimeType)
) {
    companion object {
        /** 最小分块大小: 64KB (用于慢速网络) */
        const val MIN_CHUNK_SIZE = 64 * 1024

        /** 默认分块大小: 256KB */
        const val DEFAULT_CHUNK_SIZE = 256 * 1024

        /** 大文件分块大小: 512KB (文件 > 100MB) */
        const val LARGE_FILE_CHUNK_SIZE = 512 * 1024

        /** 高速网络分块大小: 1MB (WiFi/5G/以太网) */
        const val HIGH_SPEED_CHUNK_SIZE = 1024 * 1024

        /** 大文件阈值: 100MB */
        const val LARGE_FILE_THRESHOLD = 100L * 1024 * 1024

        /** 缩略图最大大小: 50KB */
        const val MAX_THUMBNAIL_SIZE = 50 * 1024

        /**
         * 根据文件大小计算最优分块大小（不考虑网络类型）
         */
        fun calculateOptimalChunkSize(fileSize: Long): Int {
            return calculateOptimalChunkSize(fileSize, NetworkType.UNKNOWN, false)
        }

        /**
         * 根据文件大小和网络类型计算最优分块大小
         *
         * @param fileSize 文件大小
         * @param networkType 当前网络类型
         * @param isMetered 是否为计费网络
         * @return 最优分块大小
         */
        fun calculateOptimalChunkSize(
            fileSize: Long,
            networkType: NetworkType,
            isMetered: Boolean
        ): Int {
            // 计费网络使用较小分块以减少重传成本
            if (isMetered) {
                return MIN_CHUNK_SIZE
            }

            // 根据网络类型确定基础分块大小
            val baseChunkSize = when (networkType) {
                NetworkType.WIFI, NetworkType.ETHERNET, NetworkType.CELLULAR_5G -> {
                    if (fileSize > LARGE_FILE_THRESHOLD) HIGH_SPEED_CHUNK_SIZE else LARGE_FILE_CHUNK_SIZE
                }
                NetworkType.CELLULAR_4G -> {
                    if (fileSize > LARGE_FILE_THRESHOLD) LARGE_FILE_CHUNK_SIZE else DEFAULT_CHUNK_SIZE
                }
                NetworkType.CELLULAR_3G -> DEFAULT_CHUNK_SIZE
                NetworkType.CELLULAR_2G -> MIN_CHUNK_SIZE
                NetworkType.NONE -> DEFAULT_CHUNK_SIZE // 离线队列
                NetworkType.UNKNOWN -> {
                    // 未知网络时根据文件大小决定
                    if (fileSize > LARGE_FILE_THRESHOLD) LARGE_FILE_CHUNK_SIZE else DEFAULT_CHUNK_SIZE
                }
            }

            return baseChunkSize
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
         * 创建传输元数据（使用默认网络设置）
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
            return create(
                transferId = transferId,
                fileName = fileName,
                fileSize = fileSize,
                mimeType = mimeType,
                checksum = checksum,
                senderDeviceId = senderDeviceId,
                receiverDeviceId = receiverDeviceId,
                thumbnail = thumbnail,
                networkType = NetworkType.UNKNOWN,
                isMetered = false
            )
        }

        /**
         * 创建传输元数据（自适应网络类型）
         *
         * @param transferId 传输ID
         * @param fileName 文件名
         * @param fileSize 文件大小
         * @param mimeType MIME类型
         * @param checksum 文件校验和
         * @param senderDeviceId 发送方设备ID
         * @param receiverDeviceId 接收方设备ID
         * @param thumbnail 缩略图（可选）
         * @param networkType 当前网络类型
         * @param isMetered 是否为计费网络
         * @param compressionEnabled 是否启用压缩
         */
        fun create(
            transferId: String,
            fileName: String,
            fileSize: Long,
            mimeType: String,
            checksum: String,
            senderDeviceId: String,
            receiverDeviceId: String,
            thumbnail: String? = null,
            networkType: NetworkType = NetworkType.UNKNOWN,
            isMetered: Boolean = false,
            compressionEnabled: Boolean = true
        ): FileTransferMetadata {
            val chunkSize = calculateOptimalChunkSize(fileSize, networkType, isMetered)
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
                receiverDeviceId = receiverDeviceId,
                compressionEnabled = compressionEnabled
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
