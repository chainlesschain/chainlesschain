package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * 离线消息队列实体
 *
 * 用于在断线时持久化待发送消息，并在重连后自动发送
 */
@Entity(
    tableName = "offline_message_queue",
    indices = [
        Index(value = ["peerId", "status"]),
        Index(value = ["status", "createdAt"]),
        Index(value = ["priority", "createdAt"])
    ]
)
data class OfflineQueueEntity(
    @PrimaryKey
    val id: String = "offline-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}",

    /** 对等设备ID */
    val peerId: String,

    /** 消息类型: TEXT, KNOWLEDGE_SYNC, FILE, etc. */
    val messageType: String,

    /** 消息payload (JSON格式) */
    val payload: String,

    /** 消息优先级: HIGH, NORMAL, LOW */
    val priority: String = MessagePriority.NORMAL,

    /** 是否需要ACK确认 */
    val requireAck: Boolean = true,

    /** 重试次数 */
    val retryCount: Int = 0,

    /** 最大重试次数 */
    val maxRetries: Int = 5,

    /** 上次重试时间 */
    val lastRetryAt: Long? = null,

    /** 过期时间 (null表示不过期) */
    val expiresAt: Long? = null,

    /** 消息状态: PENDING, RETRYING, SENT, FAILED, EXPIRED */
    val status: String = QueueStatus.PENDING,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 更新时间 */
    val updatedAt: Long = System.currentTimeMillis()
) {
    /**
     * 检查消息是否已过期
     */
    fun isExpired(): Boolean {
        return expiresAt != null && System.currentTimeMillis() > expiresAt
    }

    /**
     * 检查是否可以重试
     */
    fun canRetry(): Boolean {
        return retryCount < maxRetries && !isExpired()
    }

    /**
     * 获取下次重试延迟 (指数退避)
     */
    fun getRetryDelay(): Long {
        val delays = listOf(1000L, 2000L, 5000L, 10000L, 30000L) // ms
        val index = minOf(retryCount, delays.size - 1)
        return delays[index]
    }
}

/**
 * 消息优先级
 */
object MessagePriority {
    const val HIGH = "HIGH"
    const val NORMAL = "NORMAL"
    const val LOW = "LOW"

    fun toOrder(priority: String): Int = when (priority) {
        HIGH -> 0
        NORMAL -> 1
        LOW -> 2
        else -> 1
    }
}

/**
 * 队列状态
 */
object QueueStatus {
    const val PENDING = "PENDING"
    const val RETRYING = "RETRYING"
    const val SENT = "SENT"
    const val FAILED = "FAILED"
    const val EXPIRED = "EXPIRED"
}
