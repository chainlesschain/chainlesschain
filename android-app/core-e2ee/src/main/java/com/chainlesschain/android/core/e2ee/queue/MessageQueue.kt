package com.chainlesschain.android.core.e2ee.queue

import android.util.Log
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.util.UUID

/**
 * 消息队列
 *
 * 管理待发送和已接收但未处理的消息
 */
class MessageQueue {

    companion object {
        private const val TAG = "MessageQueue"
    }

    // 待发送消息队列
    private val pendingOutgoingMessages = mutableListOf<QueuedMessage>()
    private val outgoingMutex = Mutex()

    // 已接收但未处理的消息队列
    private val pendingIncomingMessages = mutableListOf<QueuedMessage>()
    private val incomingMutex = Mutex()

    /**
     * 添加待发送消息
     *
     * @param peerId 对等方ID
     * @param message 加密消息
     * @param priority 优先级（0=最高）
     * @return 消息ID
     */
    suspend fun enqueueOutgoing(
        peerId: String,
        message: RatchetMessage,
        priority: Int = MessagePriority.NORMAL
    ): String = outgoingMutex.withLock {
        val messageId = UUID.randomUUID().toString()

        val queuedMessage = QueuedMessage(
            id = messageId,
            peerId = peerId,
            message = message,
            timestamp = System.currentTimeMillis(),
            priority = priority,
            retryCount = 0,
            maxRetries = 3,
            status = MessageStatus.PENDING
        )

        // 按优先级插入
        val insertIndex = pendingOutgoingMessages.indexOfFirst { it.priority > priority }
        if (insertIndex == -1) {
            pendingOutgoingMessages.add(queuedMessage)
        } else {
            pendingOutgoingMessages.add(insertIndex, queuedMessage)
        }

        Log.d(TAG, "Enqueued outgoing message: $messageId for peer: $peerId")

        messageId
    }

    /**
     * 获取下一条待发送消息
     *
     * @param peerId 对等方ID（可选，为null则返回任意对等方的消息）
     * @return 待发送消息或null
     */
    suspend fun dequeueOutgoing(peerId: String? = null): QueuedMessage? = outgoingMutex.withLock {
        val message = if (peerId != null) {
            pendingOutgoingMessages.firstOrNull { it.peerId == peerId && it.status == MessageStatus.PENDING }
        } else {
            pendingOutgoingMessages.firstOrNull { it.status == MessageStatus.PENDING }
        }

        if (message != null) {
            // 标记为发送中
            val index = pendingOutgoingMessages.indexOf(message)
            val updatedMessage = message.copy(status = MessageStatus.SENDING)
            pendingOutgoingMessages[index] = updatedMessage
            return@withLock updatedMessage
        }

        null
    }

    /**
     * 标记消息发送成功
     *
     * @param messageId 消息ID
     */
    suspend fun markOutgoingSent(messageId: String) = outgoingMutex.withLock {
        val index = pendingOutgoingMessages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            pendingOutgoingMessages.removeAt(index)
            Log.d(TAG, "Marked outgoing message as sent: $messageId")
        }
    }

    /**
     * 标记消息发送失败
     *
     * @param messageId 消息ID
     * @param retry 是否重试
     */
    suspend fun markOutgoingFailed(messageId: String, retry: Boolean = true) = outgoingMutex.withLock {
        val index = pendingOutgoingMessages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            val message = pendingOutgoingMessages[index]

            if (retry && message.retryCount < message.maxRetries) {
                // 增加重试计数并重新排队
                pendingOutgoingMessages[index] = message.copy(
                    status = MessageStatus.PENDING,
                    retryCount = message.retryCount + 1
                )
                Log.d(TAG, "Retry outgoing message: $messageId (${message.retryCount + 1}/${message.maxRetries})")
            } else {
                // 达到最大重试次数或不重试
                pendingOutgoingMessages[index] = message.copy(status = MessageStatus.FAILED)
                Log.w(TAG, "Outgoing message failed: $messageId")
            }
        }
    }

    /**
     * 添加已接收消息
     *
     * @param peerId 对等方ID
     * @param message 加密消息
     * @return 消息ID
     */
    suspend fun enqueueIncoming(
        peerId: String,
        message: RatchetMessage
    ): String = incomingMutex.withLock {
        val messageId = UUID.randomUUID().toString()

        val queuedMessage = QueuedMessage(
            id = messageId,
            peerId = peerId,
            message = message,
            timestamp = System.currentTimeMillis(),
            priority = MessagePriority.NORMAL,
            retryCount = 0,
            maxRetries = 3,
            status = MessageStatus.PENDING
        )

        pendingIncomingMessages.add(queuedMessage)

        Log.d(TAG, "Enqueued incoming message: $messageId from peer: $peerId")

        messageId
    }

    /**
     * 获取下一条待处理的已接收消息
     *
     * @param peerId 对等方ID（可选）
     * @return 待处理消息或null
     */
    suspend fun dequeueIncoming(peerId: String? = null): QueuedMessage? = incomingMutex.withLock {
        val message = if (peerId != null) {
            pendingIncomingMessages.firstOrNull { it.peerId == peerId && it.status == MessageStatus.PENDING }
        } else {
            pendingIncomingMessages.firstOrNull { it.status == MessageStatus.PENDING }
        }

        if (message != null) {
            // 标记为处理中
            val index = pendingIncomingMessages.indexOf(message)
            val updatedMessage = message.copy(status = MessageStatus.PROCESSING)
            pendingIncomingMessages[index] = updatedMessage
            return@withLock updatedMessage
        }

        null
    }

    /**
     * 标记已接收消息处理完成
     *
     * @param messageId 消息ID
     */
    suspend fun markIncomingProcessed(messageId: String) = incomingMutex.withLock {
        val index = pendingIncomingMessages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            pendingIncomingMessages.removeAt(index)
            Log.d(TAG, "Marked incoming message as processed: $messageId")
        }
    }

    /**
     * 标记已接收消息处理失败
     *
     * @param messageId 消息ID
     */
    suspend fun markIncomingFailed(messageId: String) = incomingMutex.withLock {
        val index = pendingIncomingMessages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            val message = pendingIncomingMessages[index]
            pendingIncomingMessages[index] = message.copy(status = MessageStatus.FAILED)
            Log.w(TAG, "Incoming message processing failed: $messageId")
        }
    }

    /**
     * 获取对等方的待发送消息数量
     */
    suspend fun getOutgoingCount(peerId: String): Int = outgoingMutex.withLock {
        pendingOutgoingMessages.count { it.peerId == peerId && it.status == MessageStatus.PENDING }
    }

    /**
     * 获取对等方的待处理消息数量
     */
    suspend fun getIncomingCount(peerId: String): Int = incomingMutex.withLock {
        pendingIncomingMessages.count { it.peerId == peerId && it.status == MessageStatus.PENDING }
    }

    /**
     * 获取所有待发送消息
     */
    suspend fun getAllOutgoingMessages(): List<QueuedMessage> = outgoingMutex.withLock {
        pendingOutgoingMessages.toList()
    }

    /**
     * 获取所有待处理消息
     */
    suspend fun getAllIncomingMessages(): List<QueuedMessage> = incomingMutex.withLock {
        pendingIncomingMessages.toList()
    }

    /**
     * 清除对等方的所有消息
     *
     * @param peerId 对等方ID
     */
    suspend fun clearPeerMessages(peerId: String) {
        outgoingMutex.withLock {
            pendingOutgoingMessages.removeAll { it.peerId == peerId }
        }

        incomingMutex.withLock {
            pendingIncomingMessages.removeAll { it.peerId == peerId }
        }

        Log.i(TAG, "Cleared all messages for peer: $peerId")
    }

    /**
     * 清除所有消息
     */
    suspend fun clearAll() {
        outgoingMutex.withLock {
            pendingOutgoingMessages.clear()
        }

        incomingMutex.withLock {
            pendingIncomingMessages.clear()
        }

        Log.i(TAG, "Cleared all messages")
    }

    /**
     * 获取队列统计信息
     */
    suspend fun getStatistics(): QueueStatistics {
        val outgoingCount = outgoingMutex.withLock { pendingOutgoingMessages.size }
        val incomingCount = incomingMutex.withLock { pendingIncomingMessages.size }

        return QueueStatistics(
            totalOutgoing = outgoingCount,
            totalIncoming = incomingCount,
            totalMessages = outgoingCount + incomingCount
        )
    }
}

/**
 * 队列中的消息
 */
@Serializable
data class QueuedMessage(
    /** 消息ID */
    val id: String,

    /** 对等方ID */
    val peerId: String,

    /** 加密消息 */
    val message: RatchetMessage,

    /** 时间戳 */
    val timestamp: Long,

    /** 优先级 */
    val priority: Int,

    /** 重试次数 */
    val retryCount: Int,

    /** 最大重试次数 */
    val maxRetries: Int,

    /** 消息状态 */
    val status: MessageStatus
)

/**
 * 消息状态
 */
enum class MessageStatus {
    /** 待处理 */
    PENDING,

    /** 发送中 */
    SENDING,

    /** 处理中 */
    PROCESSING,

    /** 已完成 */
    COMPLETED,

    /** 失败 */
    FAILED
}

/**
 * 消息优先级
 */
object MessagePriority {
    const val HIGH = 0
    const val NORMAL = 50
    const val LOW = 100
}

/**
 * 队列统计信息
 */
data class QueueStatistics(
    /** 待发送消息总数 */
    val totalOutgoing: Int,

    /** 待处理消息总数 */
    val totalIncoming: Int,

    /** 总消息数 */
    val totalMessages: Int
)
