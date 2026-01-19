package com.chainlesschain.android.core.p2p.transport

import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.flow.Flow

/**
 * 消息传输接口
 *
 * 定义消息发送、接收和确认的统一接口
 */
interface MessageTransport {

    /**
     * 发送消息
     *
     * @param message 消息内容
     * @return 是否发送成功
     */
    suspend fun send(message: P2PMessage): Boolean

    /**
     * 批量发送消息
     *
     * @param messages 消息列表
     * @return 成功发送的消息数量
     */
    suspend fun sendBatch(messages: List<P2PMessage>): Int

    /**
     * 接收消息流
     */
    fun receive(): Flow<P2PMessage>

    /**
     * 发送确认消息
     *
     * @param messageId 要确认的消息ID
     */
    suspend fun sendAck(messageId: String)

    /**
     * 获取传输统计信息
     */
    fun getStatistics(): TransportStatistics
}

/**
 * 传输统计信息
 */
data class TransportStatistics(
    /** 已发送消息数 */
    val sentMessages: Long = 0,

    /** 已接收消息数 */
    val receivedMessages: Long = 0,

    /** 发送失败消息数 */
    val failedMessages: Long = 0,

    /** 待确认消息数 */
    val pendingAcks: Int = 0,

    /** 平均延迟（毫秒） */
    val averageLatency: Long = 0,

    /** 总传输字节数 */
    val totalBytes: Long = 0
)

/**
 * 消息优先级
 */
enum class MessagePriority {
    /** 低优先级（批量同步） */
    LOW,

    /** 普通优先级（一般消息） */
    NORMAL,

    /** 高优先级（实时消息） */
    HIGH,

    /** 紧急（控制消息） */
    URGENT
}

/**
 * 传输选项
 */
data class TransportOptions(
    /** 是否需要确认 */
    val requiresAck: Boolean = true,

    /** 消息优先级 */
    val priority: MessagePriority = MessagePriority.NORMAL,

    /** 超时时间（毫秒） */
    val timeout: Long = 30000,

    /** 最大重试次数 */
    val maxRetries: Int = 3,

    /** 是否压缩 */
    val compress: Boolean = false
)
