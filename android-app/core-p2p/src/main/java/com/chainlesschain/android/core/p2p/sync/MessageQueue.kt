package com.chainlesschain.android.core.p2p.sync

import android.util.Log
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.transport.MessagePriority
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.PriorityBlockingQueue
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 消息队列管理器
 *
 * 管理待发送、已发送、待接收消息的队列
 * 支持优先级、持久化、离线消息缓存
 */
@Singleton
class MessageQueue @Inject constructor() {

    companion object {
        private const val TAG = "MessageQueue"

        /** 最大队列大小 */
        private const val MAX_QUEUE_SIZE = 10000
    }

    // 待发送队列（优先级队列）
    private val outgoingQueue = PriorityBlockingQueue<QueuedMessage>(
        100,
        compareByDescending<QueuedMessage> { it.priority.ordinal }
            .thenBy { it.timestamp }
    )

    // 已发送但未确认的消息
    private val sentPendingAck = ConcurrentHashMap<String, QueuedMessage>()

    // 离线消息缓存（设备离线时收到的消息）
    private val offlineMessages = ConcurrentHashMap<String, MutableList<P2PMessage>>()

    // 入站消息流（其他组件可以监听接收到的消息）
    private val _incomingMessages = MutableSharedFlow<P2PMessage>(
        replay = 0,
        extraBufferCapacity = 100
    )
    val incomingMessages: Flow<P2PMessage> = _incomingMessages

    // 队列状态
    private val _queueState = MutableStateFlow(QueueState())
    val queueState: Flow<QueueState> = _queueState.asStateFlow()

    /**
     * 入队消息（待发送）
     *
     * @param message 消息
     * @param priority 优先级
     * @return 是否成功入队
     */
    fun enqueue(message: P2PMessage, priority: MessagePriority = MessagePriority.NORMAL): Boolean {
        if (outgoingQueue.size >= MAX_QUEUE_SIZE) {
            Log.w(TAG, "Queue is full, dropping message: ${message.id}")
            return false
        }

        val queuedMessage = QueuedMessage(
            message = message,
            priority = priority,
            timestamp = System.currentTimeMillis()
        )

        val success = outgoingQueue.offer(queuedMessage)
        if (success) {
            updateQueueState()
            Log.d(TAG, "Message enqueued: ${message.id} (priority: $priority)")
        }

        return success
    }

    /**
     * 出队消息（取出待发送的消息）
     *
     * @return 下一个待发送的消息，如果队列为空则返回null
     */
    fun dequeue(): QueuedMessage? {
        val queuedMessage = outgoingQueue.poll()
        if (queuedMessage != null) {
            // 添加到待确认列表
            sentPendingAck[queuedMessage.message.id] = queuedMessage
            updateQueueState()
            Log.d(TAG, "Message dequeued: ${queuedMessage.message.id}")
        }
        return queuedMessage
    }

    /**
     * 批量出队
     *
     * @param count 出队数量
     * @return 消息列表
     */
    fun dequeueBatch(count: Int): List<QueuedMessage> {
        val messages = mutableListOf<QueuedMessage>()

        repeat(count) {
            val message = dequeue()
            if (message != null) {
                messages.add(message)
            } else {
                return@repeat
            }
        }

        return messages
    }

    /**
     * 确认消息已发送
     *
     * @param messageId 消息ID
     */
    fun acknowledge(messageId: String) {
        sentPendingAck.remove(messageId)
        updateQueueState()
        Log.d(TAG, "Message acknowledged: $messageId")
    }

    /**
     * 重新入队（发送失败时）
     *
     * @param messageId 消息ID
     */
    fun requeue(messageId: String) {
        sentPendingAck.remove(messageId)?.let { queuedMessage ->
            val updatedMessage = queuedMessage.copy(
                retryCount = queuedMessage.retryCount + 1,
                timestamp = System.currentTimeMillis()
            )

            if (updatedMessage.retryCount <= 3) {
                outgoingQueue.offer(updatedMessage)
                Log.d(TAG, "Message requeued: $messageId (retry: ${updatedMessage.retryCount})")
            } else {
                Log.w(TAG, "Message dropped after max retries: $messageId")
            }

            updateQueueState()
        }
    }

    /**
     * 存储离线消息
     *
     * @param deviceId 设备ID
     * @param message 消息
     */
    fun storeOfflineMessage(deviceId: String, message: P2PMessage) {
        val messages = offlineMessages.getOrPut(deviceId) { mutableListOf() }
        messages.add(message)

        Log.d(TAG, "Offline message stored for device: $deviceId")
        updateQueueState()
    }

    /**
     * 获取离线消息
     *
     * @param deviceId 设备ID
     * @return 离线消息列表
     */
    fun getOfflineMessages(deviceId: String): List<P2PMessage> {
        return offlineMessages[deviceId]?.toList() ?: emptyList()
    }

    /**
     * 清除离线消息
     *
     * @param deviceId 设备ID
     */
    fun clearOfflineMessages(deviceId: String) {
        offlineMessages.remove(deviceId)
        Log.d(TAG, "Offline messages cleared for device: $deviceId")
        updateQueueState()
    }

    /**
     * 获取队列大小
     */
    fun getQueueSize(): Int {
        return outgoingQueue.size
    }

    /**
     * 获取待确认消息数
     */
    fun getPendingAckCount(): Int {
        return sentPendingAck.size
    }

    /**
     * 获取离线消息总数
     */
    fun getOfflineMessageCount(): Int {
        return offlineMessages.values.sumOf { it.size }
    }

    /**
     * 清空队列
     */
    fun clear() {
        outgoingQueue.clear()
        sentPendingAck.clear()
        offlineMessages.clear()
        updateQueueState()
        Log.d(TAG, "All queues cleared")
    }

    /**
     * 分发收到的消息到入站消息流
     *
     * 由上层组件（如P2PConnectionManager）调用，将收到的消息分发给监听者
     *
     * @param message 收到的消息
     * @return 是否成功分发
     */
    suspend fun dispatchIncoming(message: P2PMessage): Boolean {
        return _incomingMessages.tryEmit(message).also { success ->
            if (success) {
                Log.d(TAG, "Incoming message dispatched: ${message.id} (type: ${message.type})")
            } else {
                Log.w(TAG, "Failed to dispatch incoming message (buffer full): ${message.id}")
            }
        }
    }

    /**
     * 更新队列状态
     */
    private fun updateQueueState() {
        _queueState.value = QueueState(
            outgoingCount = outgoingQueue.size,
            pendingAckCount = sentPendingAck.size,
            offlineMessageCount = getOfflineMessageCount()
        )
    }

    /**
     * 清理超时的待确认消息
     */
    fun cleanupStaleMessages(timeoutMs: Long = 60000) {
        val now = System.currentTimeMillis()

        sentPendingAck.values.removeIf { queuedMessage ->
            val isStale = (now - queuedMessage.timestamp) > timeoutMs

            if (isStale) {
                Log.w(TAG, "Removing stale message: ${queuedMessage.message.id}")
            }

            isStale
        }

        updateQueueState()
    }
}

/**
 * 队列中的消息
 */
data class QueuedMessage(
    /** 消息内容 */
    val message: P2PMessage,

    /** 优先级 */
    val priority: MessagePriority,

    /** 入队时间戳 */
    val timestamp: Long,

    /** 重试次数 */
    val retryCount: Int = 0
)

/**
 * 队列状态
 */
data class QueueState(
    /** 待发送消息数 */
    val outgoingCount: Int = 0,

    /** 待确认消息数 */
    val pendingAckCount: Int = 0,

    /** 离线消息总数 */
    val offlineMessageCount: Int = 0
) {
    /** 总消息数 */
    val totalCount: Int
        get() = outgoingCount + pendingAckCount + offlineMessageCount
}
