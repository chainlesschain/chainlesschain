package com.chainlesschain.android.core.p2p.filetransfer.model

import kotlinx.serialization.Serializable

/**
 * 传输进度
 *
 * Real-time progress tracking for file transfers including speed and ETA calculation.
 */
@Serializable
data class TransferProgress(
    /** 传输ID */
    val transferId: String,

    /** 已传输字节数 */
    val bytesTransferred: Long,

    /** 总字节数 */
    val totalBytes: Long,

    /** 已完成的分块数 */
    val completedChunks: Int,

    /** 总分块数 */
    val totalChunks: Int,

    /** 传输速度（字节/秒） */
    val speedBytesPerSecond: Long,

    /** 预计剩余时间（秒） */
    val etaSeconds: Long,

    /** 传输状态 */
    val status: FileTransferStatus,

    /** 最后更新时间 */
    val lastUpdateTime: Long = System.currentTimeMillis(),

    /** 传输方向 */
    val isOutgoing: Boolean,

    /** 对端设备ID */
    val peerId: String,

    /** 文件名 */
    val fileName: String
) {
    /**
     * 获取进度百分比 (0-100)
     */
    fun getProgressPercent(): Float {
        if (totalBytes == 0L) return 0f
        return (bytesTransferred.toFloat() / totalBytes) * 100
    }

    /**
     * 获取人类可读的速度
     */
    fun getReadableSpeed(): String {
        return formatBytes(speedBytesPerSecond) + "/s"
    }

    /**
     * 获取人类可读的已传输大小
     */
    fun getReadableBytesTransferred(): String {
        return formatBytes(bytesTransferred)
    }

    /**
     * 获取人类可读的总大小
     */
    fun getReadableTotalBytes(): String {
        return formatBytes(totalBytes)
    }

    /**
     * 获取人类可读的剩余时间
     */
    fun getReadableEta(): String {
        if (etaSeconds <= 0 || status != FileTransferStatus.TRANSFERRING) {
            return "--"
        }

        return when {
            etaSeconds < 60 -> "${etaSeconds}s"
            etaSeconds < 3600 -> "${etaSeconds / 60}m ${etaSeconds % 60}s"
            else -> "${etaSeconds / 3600}h ${(etaSeconds % 3600) / 60}m"
        }
    }

    /**
     * 是否正在传输中
     */
    fun isActive(): Boolean = status == FileTransferStatus.TRANSFERRING

    companion object {
        /**
         * 创建初始进度
         */
        fun initial(
            transferId: String,
            totalBytes: Long,
            totalChunks: Int,
            isOutgoing: Boolean,
            peerId: String,
            fileName: String
        ): TransferProgress {
            return TransferProgress(
                transferId = transferId,
                bytesTransferred = 0,
                totalBytes = totalBytes,
                completedChunks = 0,
                totalChunks = totalChunks,
                speedBytesPerSecond = 0,
                etaSeconds = -1,
                status = FileTransferStatus.PENDING,
                isOutgoing = isOutgoing,
                peerId = peerId,
                fileName = fileName
            )
        }

        /**
         * 格式化字节大小
         */
        private fun formatBytes(bytes: Long): String {
            val units = arrayOf("B", "KB", "MB", "GB", "TB")
            var size = bytes.toDouble()
            var unitIndex = 0

            while (size >= 1024 && unitIndex < units.size - 1) {
                size /= 1024
                unitIndex++
            }

            return String.format("%.2f %s", size, units[unitIndex])
        }
    }
}

/**
 * 传输速度样本
 *
 * Used internally for rolling window speed calculation.
 */
data class SpeedSample(
    val bytesTransferred: Long,
    val timestamp: Long
)
