package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * 文件传输实体
 *
 * 存储文件传输记录，用于历史记录、断点续传等
 */
@Entity(
    tableName = "file_transfers",
    indices = [
        Index(value = ["peerId"]),
        Index(value = ["status"]),
        Index(value = ["createdAt"]),
        Index(value = ["peerId", "status"]),
        Index(value = ["peerId", "createdAt"])
    ]
)
data class FileTransferEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /** 对等设备ID (DID) */
    val peerId: String,

    /** 文件名 */
    val fileName: String,

    /** 文件大小（字节） */
    val fileSize: Long,

    /** MIME类型 */
    val mimeType: String,

    /** 文件SHA256校验和 */
    val fileChecksum: String,

    /** 缩略图（Base64，用于图片/视频预览） */
    val thumbnailBase64: String? = null,

    /** 本地文件路径（发送时为源文件，接收完成后为目标文件） */
    val localFilePath: String? = null,

    /** 临时文件路径（接收过程中） */
    val tempFilePath: String? = null,

    /** 是否为出站传输（本机发送） */
    val isOutgoing: Boolean,

    /** 传输状态: PENDING, REQUESTING, TRANSFERRING, PAUSED, COMPLETED, FAILED, CANCELLED, REJECTED */
    val status: String = FileTransferStatusEnum.PENDING,

    /** 每个分块大小（字节） */
    val chunkSize: Int,

    /** 总分块数 */
    val totalChunks: Int,

    /** 已完成的分块数 */
    val completedChunks: Int = 0,

    /** 已传输字节数 */
    val bytesTransferred: Long = 0,

    /** 重试次数 */
    val retryCount: Int = 0,

    /** 错误消息 */
    val errorMessage: String? = null,

    /** 创建时间戳 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 最后更新时间戳 */
    val updatedAt: Long = System.currentTimeMillis(),

    /** 完成时间戳 */
    val completedAt: Long? = null
)

/**
 * 文件传输状态枚举（字符串常量）
 */
object FileTransferStatusEnum {
    const val PENDING = "PENDING"
    const val REQUESTING = "REQUESTING"
    const val TRANSFERRING = "TRANSFERRING"
    const val PAUSED = "PAUSED"
    const val COMPLETED = "COMPLETED"
    const val FAILED = "FAILED"
    const val CANCELLED = "CANCELLED"
    const val REJECTED = "REJECTED"

    fun isTerminal(status: String): Boolean {
        return status in listOf(COMPLETED, FAILED, CANCELLED, REJECTED)
    }

    fun canResume(status: String): Boolean {
        return status == PAUSED
    }

    fun canPause(status: String): Boolean {
        return status == TRANSFERRING
    }

    fun canCancel(status: String): Boolean {
        return status in listOf(PENDING, REQUESTING, TRANSFERRING, PAUSED)
    }

    fun canRetry(status: String): Boolean {
        return status in listOf(FAILED, CANCELLED)
    }
}
