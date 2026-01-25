package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * 传输断点实体
 *
 * 用于断点续传，记录哪些分块已经接收/发送
 * 支持传输中断后精确恢复
 */
@Entity(
    tableName = "transfer_checkpoints",
    indices = [
        Index(value = ["transferId"], unique = true),
        Index(value = ["updatedAt"])
    ]
)
data class TransferCheckpointEntity(
    @PrimaryKey
    val id: String,

    /** 关联的传输ID */
    val transferId: String,

    /** 文件ID (用于关联) */
    val fileId: String,

    /** 文件名 */
    val fileName: String,

    /** 文件总大小（字节） */
    val totalSize: Long,

    /** 已接收的分块索引列表（JSON数组: [0,1,2,5,7...]） */
    val receivedChunksJson: String,

    /** 最后一个分块索引 */
    val lastChunkIndex: Int,

    /** 总分块数 */
    val totalChunks: Int,

    /** 每个分块大小（字节） */
    val chunkSize: Int,

    /** 已传输字节数 */
    val bytesTransferred: Long,

    /** 是否为出站传输 */
    val isOutgoing: Boolean,

    /** 对等设备ID */
    val peerId: String,

    /** 文件校验和 (SHA-256) */
    val fileChecksum: String,

    /** 临时文件路径（接收方） */
    val tempFilePath: String? = null,

    /** 源文件URI（发送方） */
    val sourceFileUri: String? = null,

    /** 创建时间戳 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 最后更新时间戳 */
    val updatedAt: Long = System.currentTimeMillis()
) {
    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /**
         * 解析已接收分块列表
         */
        fun parseReceivedChunks(receivedChunksJson: String): Set<Int> {
            return try {
                json.decodeFromString<List<Int>>(receivedChunksJson).toSet()
            } catch (e: Exception) {
                emptySet()
            }
        }

        /**
         * 序列化已接收分块列表
         */
        fun serializeReceivedChunks(chunks: Set<Int>): String {
            return json.encodeToString(chunks.sorted())
        }

        /**
         * 创建新的检查点
         */
        fun create(
            transferId: String,
            fileId: String,
            fileName: String,
            totalSize: Long,
            totalChunks: Int,
            chunkSize: Int,
            isOutgoing: Boolean,
            peerId: String,
            fileChecksum: String,
            tempFilePath: String? = null,
            sourceFileUri: String? = null
        ): TransferCheckpointEntity {
            return TransferCheckpointEntity(
                id = transferId,
                transferId = transferId,
                fileId = fileId,
                fileName = fileName,
                totalSize = totalSize,
                receivedChunksJson = "[]",
                lastChunkIndex = -1,
                totalChunks = totalChunks,
                chunkSize = chunkSize,
                bytesTransferred = 0,
                isOutgoing = isOutgoing,
                peerId = peerId,
                fileChecksum = fileChecksum,
                tempFilePath = tempFilePath,
                sourceFileUri = sourceFileUri
            )
        }
    }

    /**
     * 获取已接收的分块集合
     */
    fun getReceivedChunks(): Set<Int> {
        return parseReceivedChunks(receivedChunksJson)
    }

    /**
     * 计算进度百分比
     */
    fun getProgressPercentage(): Float {
        return if (totalChunks > 0) {
            (getReceivedChunks().size.toFloat() / totalChunks) * 100f
        } else {
            0f
        }
    }

    /**
     * 判断是否可以恢复
     */
    fun canResume(): Boolean {
        val receivedChunks = getReceivedChunks()
        return receivedChunks.isNotEmpty() && receivedChunks.size < totalChunks
    }

    /**
     * 获取下一个需要传输的分块索引
     */
    fun getNextChunkIndex(): Int {
        val receivedChunks = getReceivedChunks()
        for (i in 0 until totalChunks) {
            if (i !in receivedChunks) {
                return i
            }
        }
        return totalChunks // All chunks received
    }

    /**
     * 获取缺失的分块列表（用于断点续传请求）
     */
    fun getMissingChunks(): List<Int> {
        val receivedChunks = getReceivedChunks()
        return (0 until totalChunks).filter { it !in receivedChunks }
    }

    /**
     * 更新已接收的分块
     */
    fun withReceivedChunk(chunkIndex: Int, chunkSize: Long): TransferCheckpointEntity {
        val receivedChunks = getReceivedChunks().toMutableSet()
        receivedChunks.add(chunkIndex)

        val newBytesTransferred = bytesTransferred + chunkSize

        return copy(
            receivedChunksJson = serializeReceivedChunks(receivedChunks),
            lastChunkIndex = chunkIndex.coerceAtLeast(lastChunkIndex),
            bytesTransferred = newBytesTransferred.coerceAtMost(totalSize),
            updatedAt = System.currentTimeMillis()
        )
    }

    /**
     * 批量更新已接收的分块
     */
    fun withReceivedChunks(chunkIndices: Collection<Int>): TransferCheckpointEntity {
        val receivedChunks = getReceivedChunks().toMutableSet()
        receivedChunks.addAll(chunkIndices)

        // Calculate bytes transferred based on chunk count
        val newBytesTransferred = receivedChunks.size.toLong() * chunkSize

        return copy(
            receivedChunksJson = serializeReceivedChunks(receivedChunks),
            lastChunkIndex = chunkIndices.maxOrNull() ?: lastChunkIndex,
            bytesTransferred = newBytesTransferred.coerceAtMost(totalSize),
            updatedAt = System.currentTimeMillis()
        )
    }
}

/**
 * 检查点摘要（用于UI显示）
 */
@Serializable
data class CheckpointSummary(
    val transferId: String,
    val fileName: String,
    val progressPercentage: Float,
    val receivedChunks: Int,
    val totalChunks: Int,
    val bytesTransferred: Long,
    val totalSize: Long,
    val canResume: Boolean,
    val updatedAt: Long
) {
    companion object {
        fun from(checkpoint: TransferCheckpointEntity): CheckpointSummary {
            return CheckpointSummary(
                transferId = checkpoint.transferId,
                fileName = checkpoint.fileName,
                progressPercentage = checkpoint.getProgressPercentage(),
                receivedChunks = checkpoint.getReceivedChunks().size,
                totalChunks = checkpoint.totalChunks,
                bytesTransferred = checkpoint.bytesTransferred,
                totalSize = checkpoint.totalSize,
                canResume = checkpoint.canResume(),
                updatedAt = checkpoint.updatedAt
            )
        }
    }
}
