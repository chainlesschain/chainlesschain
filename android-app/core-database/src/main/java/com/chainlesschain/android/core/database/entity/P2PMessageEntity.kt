package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * P2P聊天消息实体
 *
 * 存储端到端加密的P2P消息
 */
@Entity(
    tableName = "p2p_messages",
    indices = [
        Index(value = ["peerId"]),
        Index(value = ["timestamp"]),
        Index(value = ["peerId", "timestamp"])
    ]
)
data class P2PMessageEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /** 对等设备ID (DID) */
    val peerId: String,

    /** 发送方设备ID */
    val fromDeviceId: String,

    /** 接收方设备ID */
    val toDeviceId: String,

    /** 消息类型: TEXT, KNOWLEDGE_SYNC, CONVERSATION_SYNC, etc. */
    val type: String,

    /** 消息内容（已解密的明文） */
    val content: String,

    /** 加密后的payload（用于重传） */
    val encryptedPayload: String? = null,

    /** 创建时间戳 */
    val timestamp: Long = System.currentTimeMillis(),

    /** 是否由本机发送 */
    val isOutgoing: Boolean,

    /** 是否需要确认 */
    val requiresAck: Boolean = true,

    /** 是否已确认/已读 */
    val isAcknowledged: Boolean = false,

    /** 发送状态: PENDING, SENT, DELIVERED, FAILED */
    val sendStatus: String = "PENDING"
)

/**
 * 消息发送状态
 */
object MessageSendStatus {
    const val PENDING = "PENDING"
    const val SENT = "SENT"
    const val DELIVERED = "DELIVERED"
    const val FAILED = "FAILED"
}
