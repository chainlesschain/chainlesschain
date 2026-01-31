package com.chainlesschain.android.remote.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter

/**
 * 文件传输实体
 */
@Entity(tableName = "file_transfers")
data class FileTransferEntity(
    @PrimaryKey
    val id: String, // transferId from PC

    // 基本信息
    val deviceDid: String,           // PC 设备 DID
    val direction: TransferDirection, // upload or download
    val fileName: String,
    val fileSize: Long,

    // 传输状态
    val status: TransferStatus,
    val progress: Double = 0.0,      // 0-100
    val error: String? = null,

    // 分块信息
    val chunkSize: Int,
    val totalChunks: Int,
    val uploadedChunks: Set<Int> = emptySet(), // 已上传/下载的分块索引

    // 文件路径
    val localPath: String? = null,   // 本地文件路径
    val remotePath: String? = null,  // PC 端文件路径

    // 校验和
    val checksum: String? = null,

    // 元数据
    val metadata: String? = null,    // JSON

    // 时间戳
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val completedAt: Long? = null,

    // 性能指标
    val duration: Long = 0,          // 总耗时（ms）
    val bytesTransferred: Long = 0,  // 已传输字节数
    val speed: Double = 0.0          // 传输速度（bytes/sec）
)

/**
 * 传输方向
 */
enum class TransferDirection {
    UPLOAD,   // Android → PC
    DOWNLOAD  // PC → Android
}

/**
 * 传输状态
 */
enum class TransferStatus {
    PENDING,      // 等待开始
    IN_PROGRESS,  // 传输中
    PAUSED,       // 暂停
    COMPLETED,    // 完成
    FAILED,       // 失败
    CANCELLED     // 取消
}

/**
 * 文件传输类型转换器
 */
class FileTransferConverters {

    @TypeConverter
    fun fromTransferDirection(value: TransferDirection): String {
        return value.name
    }

    @TypeConverter
    fun toTransferDirection(value: String): TransferDirection {
        return TransferDirection.valueOf(value)
    }

    @TypeConverter
    fun fromTransferStatus(value: TransferStatus): String {
        return value.name
    }

    @TypeConverter
    fun toTransferStatus(value: String): TransferStatus {
        return TransferStatus.valueOf(value)
    }

    @TypeConverter
    fun fromChunkSet(value: Set<Int>): String {
        return value.joinToString(",")
    }

    @TypeConverter
    fun toChunkSet(value: String): Set<Int> {
        if (value.isBlank()) return emptySet()
        return value.split(",").map { it.toInt() }.toSet()
    }
}
