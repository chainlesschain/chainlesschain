package com.chainlesschain.android.feature.p2p.queue

import android.util.Log
import com.chainlesschain.android.core.database.dao.OfflineQueueDao
import com.chainlesschain.android.core.database.entity.MessagePriority
import com.chainlesschain.android.core.database.entity.OfflineQueueEntity
import com.chainlesschain.android.core.database.entity.QueueStatus
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 离线消息队列管理器
 *
 * 负责在断线时持久化待发送消息，并在重连后自动发送
 *
 * 功能：
 * - 消息入队（支持优先级）
 * - 指数退避重试
 * - 过期消息清理
 * - 重连自动发送
 */
@Singleton
class OfflineMessageQueue @Inject constructor(
    private val offlineQueueDao: OfflineQueueDao
) {
    companion object {
        private const val TAG = "OfflineMessageQueue"
        private const val DEFAULT_MAX_RETRIES = 5
        private const val CLEANUP_INTERVAL = 60_000L // 1分钟
        private const val RETENTION_DAYS = 7L
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 消息准备重试的事件流
    private val _retryReadyMessages = MutableSharedFlow<OfflineQueueEntity>()
    val retryReadyMessages: SharedFlow<OfflineQueueEntity> = _retryReadyMessages.asSharedFlow()

    // 消息状态变化的事件流
    private val _messageStatusChanged = MutableSharedFlow<MessageStatusEvent>()
    val messageStatusChanged: SharedFlow<MessageStatusEvent> = _messageStatusChanged.asSharedFlow()

    // 定期清理和重试检查
    private var cleanupJob: Job? = null

    init {
        startPeriodicTasks()
    }

    // ===== 队列操作 =====

    /**
     * 将消息加入离线队列
     *
     * @param peerId 对等设备ID
     * @param messageType 消息类型
     * @param payload 消息内容 (JSON)
     * @param priority 优先级
     * @param requireAck 是否需要ACK
     * @param expiresInMs 过期时间（毫秒），null表示不过期
     * @return 消息ID
     */
    suspend fun enqueue(
        peerId: String,
        messageType: String,
        payload: String,
        priority: String = MessagePriority.NORMAL,
        requireAck: Boolean = true,
        expiresInMs: Long? = null
    ): String {
        val message = OfflineQueueEntity(
            peerId = peerId,
            messageType = messageType,
            payload = payload,
            priority = priority,
            requireAck = requireAck,
            maxRetries = DEFAULT_MAX_RETRIES,
            expiresAt = expiresInMs?.let { System.currentTimeMillis() + it }
        )

        offlineQueueDao.insert(message)
        Log.d(TAG, "Enqueued message: ${message.id} for peer: $peerId")

        _messageStatusChanged.emit(
            MessageStatusEvent(message.id, peerId, QueueStatus.PENDING)
        )

        return message.id
    }

    /**
     * 获取指定设备的待发送消息
     */
    fun getPendingMessages(peerId: String): Flow<List<OfflineQueueEntity>> {
        return offlineQueueDao.getPendingMessages(peerId)
    }

    /**
     * 获取指定设备的待发送消息（同步）
     */
    suspend fun getPendingMessagesSync(peerId: String): List<OfflineQueueEntity> {
        return offlineQueueDao.getPendingMessagesSync(peerId)
            .filter { !it.isExpired() }
    }

    /**
     * 获取所有待发送消息
     */
    fun getAllPendingMessages(): Flow<List<OfflineQueueEntity>> {
        return offlineQueueDao.getAllPendingMessages()
    }

    /**
     * 获取所有待发送消息（同步）
     */
    suspend fun getAllPendingMessagesSync(): List<OfflineQueueEntity> {
        return offlineQueueDao.getAllPendingMessagesSync()
            .filter { !it.isExpired() }
    }

    /**
     * 标记消息为已发送
     */
    suspend fun markAsSent(messageId: String) {
        offlineQueueDao.markAsSent(messageId)
        Log.d(TAG, "Message marked as sent: $messageId")

        val message = offlineQueueDao.getMessageById(messageId)
        message?.let {
            _messageStatusChanged.emit(
                MessageStatusEvent(messageId, it.peerId, QueueStatus.SENT)
            )
        }
    }

    /**
     * 标记消息发送失败并安排重试
     *
     * @param messageId 消息ID
     * @param shouldRetry 是否应该重试
     */
    suspend fun markAsFailed(messageId: String, shouldRetry: Boolean = true) {
        val message = offlineQueueDao.getMessageById(messageId) ?: return

        if (shouldRetry && message.canRetry()) {
            // 安排重试
            offlineQueueDao.updateRetry(messageId)
            Log.d(TAG, "Message scheduled for retry: $messageId (attempt ${message.retryCount + 1}/${message.maxRetries})")

            _messageStatusChanged.emit(
                MessageStatusEvent(messageId, message.peerId, QueueStatus.RETRYING)
            )
        } else {
            // 永久失败
            offlineQueueDao.markAsFailed(messageId)
            Log.e(TAG, "Message permanently failed: $messageId")

            _messageStatusChanged.emit(
                MessageStatusEvent(messageId, message.peerId, QueueStatus.FAILED)
            )
        }
    }

    /**
     * 处理重试队列
     *
     * 检查哪些消息已经等待足够时间，可以重试
     */
    suspend fun processRetryQueue() {
        val now = System.currentTimeMillis()

        try {
            val retryMessages = offlineQueueDao.getRetryReadyMessages(now)

            for (message in retryMessages) {
                // 检查是否满足重试延迟
                val lastRetry = message.lastRetryAt ?: 0
                val requiredDelay = message.getRetryDelay()

                if (now - lastRetry >= requiredDelay) {
                    Log.d(TAG, "Message ready for retry: ${message.id}")
                    _retryReadyMessages.emit(message)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to process retry queue", e)
        }
    }

    /**
     * 清理过期消息
     */
    suspend fun cleanupExpiredMessages() {
        try {
            val expiredMessages = offlineQueueDao.getExpiredMessages()

            for (message in expiredMessages) {
                offlineQueueDao.markAsExpired(message.id)
                Log.d(TAG, "Message expired: ${message.id}")

                _messageStatusChanged.emit(
                    MessageStatusEvent(message.id, message.peerId, QueueStatus.EXPIRED)
                )
            }

            if (expiredMessages.isNotEmpty()) {
                Log.i(TAG, "Cleaned up ${expiredMessages.size} expired messages")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to cleanup expired messages", e)
        }
    }

    /**
     * 清空指定设备的队列
     */
    suspend fun clearQueue(peerId: String) {
        offlineQueueDao.clearQueue(peerId)
        Log.i(TAG, "Cleared queue for peer: $peerId")
    }

    /**
     * 清空所有队列
     */
    suspend fun clearAllQueues() {
        offlineQueueDao.clearAll()
        Log.i(TAG, "Cleared all queues")
    }

    /**
     * 清理旧的已完成消息
     */
    suspend fun cleanupOldMessages() {
        try {
            val cutoffTime = System.currentTimeMillis() - (RETENTION_DAYS * 24 * 60 * 60 * 1000)
            offlineQueueDao.deleteOldCompletedMessages(cutoffTime)

            // 同时清理已发送、已过期、已失败的消息
            offlineQueueDao.clearSentMessages()
            offlineQueueDao.clearExpiredMessages()

            Log.d(TAG, "Cleaned up old completed messages")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to cleanup old messages", e)
        }
    }

    // ===== 统计 =====

    /**
     * 获取队列统计
     */
    suspend fun getStatistics(): QueueStatistics {
        val stats = offlineQueueDao.getQueueStats()
        val pendingMessages = offlineQueueDao.getAllPendingMessagesSync()

        val totalPending = pendingMessages.count { it.status == QueueStatus.PENDING }
        val totalRetrying = pendingMessages.count { it.status == QueueStatus.RETRYING }
        val byPeer = stats.associate { it.peerId to it.count }

        return QueueStatistics(
            totalPending = totalPending,
            totalRetrying = totalRetrying,
            byPeer = byPeer
        )
    }

    /**
     * 获取总待发送数量Flow
     */
    fun getTotalPendingCount(): Flow<Int> {
        return offlineQueueDao.getTotalPendingCount()
    }

    // ===== 内部方法 =====

    /**
     * 启动定期任务
     */
    private fun startPeriodicTasks() {
        cleanupJob = scope.launch {
            while (isActive) {
                delay(CLEANUP_INTERVAL)
                try {
                    cleanupExpiredMessages()
                    processRetryQueue()
                    cleanupOldMessages()
                } catch (e: Exception) {
                    Log.e(TAG, "Periodic task error", e)
                }
            }
        }
    }

    /**
     * 停止定期任务
     */
    fun stop() {
        cleanupJob?.cancel()
        scope.cancel()
    }
}

/**
 * 消息状态变化事件
 */
data class MessageStatusEvent(
    val messageId: String,
    val peerId: String,
    val status: String
)

/**
 * 队列统计
 */
data class QueueStatistics(
    val totalPending: Int,
    val totalRetrying: Int,
    val byPeer: Map<String, Int>
) {
    val total: Int get() = totalPending + totalRetrying
}
