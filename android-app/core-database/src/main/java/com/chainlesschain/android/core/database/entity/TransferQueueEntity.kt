package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * 传输队列实体
 *
 * 管理文件传输队列，支持优先级调度和并发控制
 */
@Entity(
    tableName = "transfer_queue",
    indices = [
        Index(value = ["status"]),
        Index(value = ["priority"]),
        Index(value = ["createdAt"]),
        Index(value = ["status", "priority"]),
        Index(value = ["transferId"], unique = true)
    ]
)
data class TransferQueueEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /** 关联的传输ID */
    val transferId: String,

    /** 文件名 */
    val fileName: String,

    /** 文件大小（字节） */
    val fileSize: Long,

    /** MIME类型 */
    val mimeType: String,

    /** 是否为出站传输 */
    val isOutgoing: Boolean,

    /** 对等设备ID */
    val peerId: String,

    /** 队列状态: QUEUED, TRANSFERRING, COMPLETED, FAILED, CANCELLED */
    val status: String = TransferQueueStatus.QUEUED,

    /** 优先级: 1(最高) - 10(最低)，默认5 */
    val priority: Int = 5,

    /** 重试次数 */
    val retryCount: Int = 0,

    /** 错误消息 */
    val errorMessage: String? = null,

    /** 创建时间戳 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 最后更新时间戳 */
    val updatedAt: Long = System.currentTimeMillis(),

    /** 开始传输时间戳 */
    val startedAt: Long? = null,

    /** 完成时间戳 */
    val completedAt: Long? = null,

    /** 原始文件 URI（出站传输时使用） */
    val fileUri: String? = null
) {
    companion object {
        /**
         * 创建新的队列项
         */
        fun create(
            transferId: String,
            fileName: String,
            fileSize: Long,
            mimeType: String,
            isOutgoing: Boolean,
            peerId: String,
            priority: Int = 5,
            fileUri: String? = null
        ): TransferQueueEntity {
            return TransferQueueEntity(
                transferId = transferId,
                fileName = fileName,
                fileSize = fileSize,
                mimeType = mimeType,
                isOutgoing = isOutgoing,
                peerId = peerId,
                priority = priority.coerceIn(1, 10),
                fileUri = fileUri
            )
        }
    }

    /**
     * 获取可读的文件大小
     */
    fun getReadableFileSize(): String {
        val kb = fileSize / 1024.0
        val mb = kb / 1024.0
        val gb = mb / 1024.0

        return when {
            gb >= 1.0 -> "%.2f GB".format(gb)
            mb >= 1.0 -> "%.2f MB".format(mb)
            kb >= 1.0 -> "%.2f KB".format(kb)
            else -> "$fileSize B"
        }
    }

    /**
     * 判断是否可以重试
     */
    fun canRetry(): Boolean {
        return status == TransferQueueStatus.FAILED && retryCount < 3
    }

    /**
     * 判断是否为活动状态
     */
    fun isActive(): Boolean {
        return status == TransferQueueStatus.TRANSFERRING
    }

    /**
     * 判断是否为终止状态
     */
    fun isTerminal(): Boolean {
        return status in listOf(
            TransferQueueStatus.COMPLETED,
            TransferQueueStatus.FAILED,
            TransferQueueStatus.CANCELLED
        )
    }

    /**
     * 更新状态
     */
    fun withStatus(newStatus: String): TransferQueueEntity {
        val now = System.currentTimeMillis()
        return copy(
            status = newStatus,
            updatedAt = now,
            startedAt = if (newStatus == TransferQueueStatus.TRANSFERRING && startedAt == null) now else startedAt,
            completedAt = if (newStatus in listOf(TransferQueueStatus.COMPLETED, TransferQueueStatus.FAILED, TransferQueueStatus.CANCELLED)) now else completedAt
        )
    }

    /**
     * 增加重试次数
     */
    fun withRetry(error: String? = null): TransferQueueEntity {
        return copy(
            retryCount = retryCount + 1,
            errorMessage = error,
            status = TransferQueueStatus.QUEUED,
            updatedAt = System.currentTimeMillis()
        )
    }

    /**
     * 计算在队列中的等待时间（毫秒）
     */
    fun getQueuedDuration(): Long {
        val endTime = startedAt ?: System.currentTimeMillis()
        return endTime - createdAt
    }

    /**
     * 计算传输时长（毫秒）
     */
    fun getTransferDuration(): Long? {
        if (startedAt == null) return null
        val endTime = completedAt ?: System.currentTimeMillis()
        return endTime - startedAt
    }
}

/**
 * 队列状态常量
 */
object TransferQueueStatus {
    const val QUEUED = "QUEUED"           // 队列中等待
    const val TRANSFERRING = "TRANSFERRING" // 传输中
    const val COMPLETED = "COMPLETED"     // 已完成
    const val FAILED = "FAILED"           // 失败
    const val CANCELLED = "CANCELLED"     // 已取消

    fun isTerminal(status: String): Boolean {
        return status in listOf(COMPLETED, FAILED, CANCELLED)
    }

    fun canStart(status: String): Boolean {
        return status == QUEUED
    }
}

/**
 * 队列优先级常量
 */
object QueuePriority {
    const val HIGHEST = 1
    const val HIGH = 3
    const val NORMAL = 5
    const val LOW = 7
    const val LOWEST = 10

    fun validate(priority: Int): Int {
        return priority.coerceIn(HIGHEST, LOWEST)
    }

    fun getLabel(priority: Int): String {
        return when (priority) {
            in HIGHEST..2 -> "最高"
            in 3..4 -> "高"
            5 -> "普通"
            in 6..7 -> "低"
            else -> "最低"
        }
    }
}
