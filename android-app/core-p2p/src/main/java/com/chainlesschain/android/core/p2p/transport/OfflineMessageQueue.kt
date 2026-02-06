package com.chainlesschain.android.core.p2p.transport

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.p2p.model.P2PMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 离线消息队列
 *
 * 实现消息持久化存储，支持：
 * - 离线消息存储
 * - 连接恢复后自动重发
 * - 消息过期清理
 * - 按设备 ID 分组管理
 * - 消息优先级处理
 * - 指数退避重试
 * - 批量操作
 */
@Singleton
class OfflineMessageQueue @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val TAG = "OfflineMessageQueue"
        private const val QUEUE_DIR = "offline_messages"
        private const val MAX_MESSAGES_PER_DEVICE = 1000
        private const val DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000L  // 7天
        private const val MAX_RETRY_COUNT = 5

        // 指数退避重试延迟（毫秒）
        private val RETRY_DELAYS = listOf(1000L, 2000L, 5000L, 10000L, 30000L)
    }

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = false
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val mutex = Mutex()

    // 内存缓存
    private val messageCache = ConcurrentHashMap<String, MutableList<OfflineMessage>>()

    // 事件流
    private val _events = MutableSharedFlow<OfflineQueueEvent>(extraBufferCapacity = 64)
    val events: Flow<OfflineQueueEvent> = _events.asSharedFlow()

    // 队列目录
    private val queueDir: File by lazy {
        File(context.filesDir, QUEUE_DIR).apply {
            if (!exists()) mkdirs()
        }
    }

    init {
        // 启动时加载持久化的消息
        scope.launch {
            loadAllMessages()
            cleanupExpiredMessages()
        }
    }

    /**
     * 添加消息到离线队列
     *
     * @param deviceId 目标设备 ID
     * @param message 消息
     * @param expiryMs 过期时间（毫秒），默认 7 天
     * @param priority 消息优先级，默认 NORMAL
     */
    suspend fun enqueue(
        deviceId: String,
        message: P2PMessage,
        expiryMs: Long = DEFAULT_EXPIRY_MS,
        priority: MessagePriority = MessagePriority.NORMAL
    ): Result<Unit> = mutex.withLock {
        try {
            val offlineMessage = OfflineMessage(
                id = message.id,
                deviceId = deviceId,
                message = message,
                enqueuedAt = System.currentTimeMillis(),
                expiresAt = System.currentTimeMillis() + expiryMs,
                retryCount = 0,
                priority = priority,
                nextRetryAt = 0L
            )

            // 检查队列容量
            val deviceQueue = messageCache.getOrPut(deviceId) { mutableListOf() }
            if (deviceQueue.size >= MAX_MESSAGES_PER_DEVICE) {
                Log.w(TAG, "Queue full for device $deviceId, removing oldest message")
                val removed = deviceQueue.removeAt(0)
                deleteMessageFile(deviceId, removed.id)
            }

            // 添加到缓存
            deviceQueue.add(offlineMessage)

            // 持久化
            saveMessage(deviceId, offlineMessage)

            Log.d(TAG, "Message enqueued for $deviceId: ${message.id}")
            _events.emit(OfflineQueueEvent.MessageEnqueued(deviceId, message.id))

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to enqueue message", e)
            Result.failure(e)
        }
    }

    /**
     * 获取设备的所有待发送消息（按优先级和入队时间排序）
     *
     * @param deviceId 设备 ID
     * @return 消息列表
     */
    suspend fun getMessages(deviceId: String): List<OfflineMessage> = mutex.withLock {
        val now = System.currentTimeMillis()
        messageCache[deviceId]?.filter { it.expiresAt > now }
            ?.sortedWith(
                compareBy<OfflineMessage> { it.priority.ordinal }
                    .thenBy { it.enqueuedAt }
            ) ?: emptyList()
    }

    /**
     * 获取设备的待发送消息数量
     */
    fun getMessageCount(deviceId: String): Int {
        return messageCache[deviceId]?.size ?: 0
    }

    /**
     * 标记消息发送成功
     */
    suspend fun markSent(deviceId: String, messageId: String): Result<Unit> = mutex.withLock {
        try {
            val queue = messageCache[deviceId] ?: return Result.success(Unit)
            queue.removeIf { it.id == messageId }
            deleteMessageFile(deviceId, messageId)

            Log.d(TAG, "Message marked as sent: $messageId")
            _events.emit(OfflineQueueEvent.MessageSent(deviceId, messageId))

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to mark message as sent", e)
            Result.failure(e)
        }
    }

    /**
     * 标记消息发送失败（增加重试计数，使用指数退避）
     *
     * @return Result<Long?> 返回下次重试的延迟时间（毫秒），null 表示已达最大重试次数
     */
    suspend fun markFailed(deviceId: String, messageId: String): Result<Long?> = mutex.withLock {
        try {
            val queue = messageCache[deviceId] ?: return Result.success(null)
            val message = queue.find { it.id == messageId } ?: return Result.success(null)

            val newRetryCount = message.retryCount + 1
            if (newRetryCount >= MAX_RETRY_COUNT) {
                // 超过最大重试次数，移除消息
                queue.removeIf { it.id == messageId }
                deleteMessageFile(deviceId, messageId)
                Log.w(TAG, "Message exceeded max retries, removed: $messageId")
                _events.emit(OfflineQueueEvent.MessageDropped(deviceId, messageId, "Max retries exceeded"))
                return Result.success(null)
            }

            // 计算指数退避延迟
            val delayIndex = minOf(newRetryCount - 1, RETRY_DELAYS.size - 1)
            val retryDelay = RETRY_DELAYS[delayIndex]
            val nextRetryAt = System.currentTimeMillis() + retryDelay

            // 更新重试计数和下次重试时间
            val index = queue.indexOfFirst { it.id == messageId }
            if (index >= 0) {
                queue[index] = message.copy(
                    retryCount = newRetryCount,
                    nextRetryAt = nextRetryAt
                )
                saveMessage(deviceId, queue[index])
            }

            Log.d(TAG, "Message retry scheduled: $messageId ($newRetryCount/$MAX_RETRY_COUNT) delay=${retryDelay}ms")
            _events.emit(OfflineQueueEvent.MessageRetrying(deviceId, messageId, newRetryCount))

            Result.success(retryDelay)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to mark message as failed", e)
            Result.failure(e)
        }
    }

    /**
     * 获取可重试的消息（已到达重试时间）
     */
    suspend fun getRetryableMessages(deviceId: String): List<OfflineMessage> = mutex.withLock {
        val now = System.currentTimeMillis()
        messageCache[deviceId]?.filter {
            it.expiresAt > now && (it.nextRetryAt == 0L || it.nextRetryAt <= now)
        }?.sortedWith(
            compareBy<OfflineMessage> { it.priority.ordinal }
                .thenBy { it.enqueuedAt }
        ) ?: emptyList()
    }

    /**
     * 批量入队消息
     */
    suspend fun enqueueBatch(
        deviceId: String,
        messages: List<P2PMessage>,
        expiryMs: Long = DEFAULT_EXPIRY_MS,
        priority: MessagePriority = MessagePriority.NORMAL
    ): Result<Int> {
        var successCount = 0
        messages.forEach { message ->
            val result = enqueue(deviceId, message, expiryMs, priority)
            if (result.isSuccess) successCount++
        }
        Log.d(TAG, "Batch enqueued $successCount/${messages.size} messages for $deviceId")
        return Result.success(successCount)
    }

    /**
     * 批量标记发送成功
     */
    suspend fun markSentBatch(deviceId: String, messageIds: List<String>): Result<Int> = mutex.withLock {
        try {
            val queue = messageCache[deviceId] ?: return Result.success(0)
            var removedCount = 0

            messageIds.forEach { messageId ->
                if (queue.removeIf { it.id == messageId }) {
                    deleteMessageFile(deviceId, messageId)
                    removedCount++
                }
            }

            if (removedCount > 0) {
                Log.d(TAG, "Batch marked $removedCount messages as sent for $deviceId")
                _events.emit(OfflineQueueEvent.BatchSent(deviceId, removedCount))
            }

            Result.success(removedCount)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to batch mark messages as sent", e)
            Result.failure(e)
        }
    }

    /**
     * 处理连接恢复，返回需要重发的消息
     */
    suspend fun onConnectionRestored(deviceId: String): List<P2PMessage> {
        val messages = getMessages(deviceId)
        if (messages.isNotEmpty()) {
            Log.i(TAG, "Connection restored for $deviceId, ${messages.size} messages to resend")
            _events.emit(OfflineQueueEvent.ConnectionRestored(deviceId, messages.size))
        }
        return messages.map { it.message }
    }

    /**
     * 清理设备的所有消息
     */
    suspend fun clearDevice(deviceId: String): Result<Int> = mutex.withLock {
        try {
            val count = messageCache[deviceId]?.size ?: 0
            messageCache.remove(deviceId)

            // 删除持久化文件
            val deviceDir = File(queueDir, deviceId)
            if (deviceDir.exists()) {
                deviceDir.deleteRecursively()
            }

            Log.i(TAG, "Cleared $count messages for device $deviceId")
            _events.emit(OfflineQueueEvent.DeviceCleared(deviceId, count))

            Result.success(count)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to clear device messages", e)
            Result.failure(e)
        }
    }

    /**
     * 清理所有过期消息
     */
    suspend fun cleanupExpiredMessages(): Int = mutex.withLock {
        val now = System.currentTimeMillis()
        var cleanedCount = 0

        messageCache.forEach { (deviceId, queue) ->
            val expired = queue.filter { it.expiresAt <= now }
            expired.forEach { msg ->
                queue.remove(msg)
                deleteMessageFile(deviceId, msg.id)
                cleanedCount++
            }
        }

        if (cleanedCount > 0) {
            Log.i(TAG, "Cleaned up $cleanedCount expired messages")
            _events.emit(OfflineQueueEvent.ExpiredMessagesCleared(cleanedCount))
        }

        cleanedCount
    }

    /**
     * 获取队列统计信息
     */
    fun getStats(): OfflineQueueStats {
        var totalMessages = 0
        var totalDevices = 0
        var oldestMessageAge = 0L
        var highPriorityCount = 0
        var normalPriorityCount = 0
        var lowPriorityCount = 0
        var pendingRetryCount = 0

        val now = System.currentTimeMillis()

        messageCache.forEach { (_, queue) ->
            if (queue.isNotEmpty()) {
                totalDevices++
                totalMessages += queue.size
                val oldest = queue.minOfOrNull { it.enqueuedAt } ?: now
                val age = now - oldest
                if (age > oldestMessageAge) {
                    oldestMessageAge = age
                }

                queue.forEach { msg ->
                    when (msg.priority) {
                        MessagePriority.HIGH -> highPriorityCount++
                        MessagePriority.NORMAL -> normalPriorityCount++
                        MessagePriority.LOW -> lowPriorityCount++
                    }
                    if (msg.nextRetryAt > 0 && msg.nextRetryAt > now) {
                        pendingRetryCount++
                    }
                }
            }
        }

        return OfflineQueueStats(
            totalMessages = totalMessages,
            totalDevices = totalDevices,
            oldestMessageAgeMs = oldestMessageAge,
            highPriorityCount = highPriorityCount,
            normalPriorityCount = normalPriorityCount,
            lowPriorityCount = lowPriorityCount,
            pendingRetryCount = pendingRetryCount
        )
    }

    /**
     * 加载所有持久化消息
     */
    private suspend fun loadAllMessages() = withContext(Dispatchers.IO) {
        try {
            queueDir.listFiles()?.forEach { deviceDir ->
                if (deviceDir.isDirectory) {
                    val deviceId = deviceDir.name
                    val messages = mutableListOf<OfflineMessage>()

                    deviceDir.listFiles()?.forEach { file ->
                        try {
                            val content = file.readText()
                            val message = json.decodeFromString<OfflineMessage>(content)
                            messages.add(message)
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to load message file: ${file.name}", e)
                            file.delete()
                        }
                    }

                    if (messages.isNotEmpty()) {
                        messageCache[deviceId] = messages.sortedBy { it.enqueuedAt }.toMutableList()
                        Log.d(TAG, "Loaded ${messages.size} messages for device $deviceId")
                    }
                }
            }

            Log.i(TAG, "Loaded offline messages for ${messageCache.size} devices")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load offline messages", e)
        }
    }

    /**
     * 保存消息到文件
     */
    private suspend fun saveMessage(deviceId: String, message: OfflineMessage) = withContext(Dispatchers.IO) {
        try {
            val deviceDir = File(queueDir, deviceId).apply { mkdirs() }
            val file = File(deviceDir, "${message.id}.json")
            file.writeText(json.encodeToString(message))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save message: ${message.id}", e)
        }
    }

    /**
     * 删除消息文件
     */
    private suspend fun deleteMessageFile(deviceId: String, messageId: String) = withContext(Dispatchers.IO) {
        try {
            val file = File(File(queueDir, deviceId), "$messageId.json")
            if (file.exists()) file.delete() else Unit
        } catch (e: Exception) {
            Log.w(TAG, "Failed to delete message file: $messageId", e)
        }
    }

    /**
     * 释放资源
     */
    fun release() {
        // 保存所有消息
        scope.launch {
            messageCache.forEach { (deviceId, queue) ->
                queue.forEach { saveMessage(deviceId, it) }
            }
        }
    }
}

/**
 * 消息优先级
 */
enum class MessagePriority {
    HIGH,    // 高优先级：立即发送
    NORMAL,  // 普通优先级：按顺序发送
    LOW      // 低优先级：延迟发送
}

/**
 * 离线消息
 */
@Serializable
data class OfflineMessage(
    val id: String,
    val deviceId: String,
    val message: P2PMessage,
    val enqueuedAt: Long,
    val expiresAt: Long,
    val retryCount: Int,
    val priority: MessagePriority = MessagePriority.NORMAL,
    val nextRetryAt: Long = 0L
)

/**
 * 离线队列事件
 */
sealed class OfflineQueueEvent {
    data class MessageEnqueued(val deviceId: String, val messageId: String) : OfflineQueueEvent()
    data class MessageSent(val deviceId: String, val messageId: String) : OfflineQueueEvent()
    data class BatchSent(val deviceId: String, val count: Int) : OfflineQueueEvent()
    data class MessageRetrying(val deviceId: String, val messageId: String, val retryCount: Int) : OfflineQueueEvent()
    data class MessageDropped(val deviceId: String, val messageId: String, val reason: String) : OfflineQueueEvent()
    data class ConnectionRestored(val deviceId: String, val pendingCount: Int) : OfflineQueueEvent()
    data class DeviceCleared(val deviceId: String, val messageCount: Int) : OfflineQueueEvent()
    data class ExpiredMessagesCleared(val count: Int) : OfflineQueueEvent()
}

/**
 * 离线队列统计
 */
data class OfflineQueueStats(
    val totalMessages: Int,
    val totalDevices: Int,
    val oldestMessageAgeMs: Long,
    val highPriorityCount: Int = 0,
    val normalPriorityCount: Int = 0,
    val lowPriorityCount: Int = 0,
    val pendingRetryCount: Int = 0
)
