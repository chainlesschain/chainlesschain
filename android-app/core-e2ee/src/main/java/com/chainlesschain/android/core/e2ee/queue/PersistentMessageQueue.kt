package com.chainlesschain.android.core.e2ee.queue

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*

/**
 * 持久化消息队列管理器
 *
 * 自动持久化消息队列，支持离线消息和应用重启恢复
 */
class PersistentMessageQueueManager(
    private val context: Context
) {

    companion object {
        private const val TAG = "PersistentMessageQueueManager"
        private const val AUTO_SAVE_INTERVAL = 10_000L // 10秒自动保存
    }

    private val messageQueue = MessageQueue()
    private val storage = MessageQueueStorage(context)

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    @Volatile
    private var autoSaveJob: Job? = null

    @Volatile
    private var isInitialized = false

    /**
     * 初始化消息队列
     *
     * @param autoRestore 是否自动恢复保存的消息
     * @param enableAutoSave 是否启用自动保存
     */
    suspend fun initialize(
        autoRestore: Boolean = true,
        enableAutoSave: Boolean = true
    ) = withContext(Dispatchers.IO) {
        if (isInitialized) {
            Log.w(TAG, "Message queue already initialized")
            return@withContext
        }

        Log.i(TAG, "Initializing persistent message queue")

        try {
            // 恢复保存的消息
            if (autoRestore) {
                restoreMessages()
            }

            // 启动自动保存
            if (enableAutoSave) {
                startAutoSave()
            }

            isInitialized = true

            Log.i(TAG, "Persistent message queue initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize message queue", e)
            throw e
        }
    }

    /**
     * 关闭消息队列
     */
    suspend fun shutdown() {
        Log.i(TAG, "Shutting down persistent message queue")

        // 停止自动保存
        autoSaveJob?.cancel()
        autoSaveJob = null

        // 最后一次保存
        saveMessages()

        scope.cancel()

        isInitialized = false

        Log.i(TAG, "Persistent message queue shut down")
    }

    /**
     * 恢复保存的消息
     */
    private suspend fun restoreMessages() {
        Log.i(TAG, "Restoring saved messages")

        try {
            val outgoingMessages = storage.loadOutgoingMessages()
            val incomingMessages = storage.loadIncomingMessages()

            Log.i(TAG, "Restored ${outgoingMessages.size} outgoing and ${incomingMessages.size} incoming messages")

            // 重新入队（仅恢复 PENDING 状态的消息）
            outgoingMessages
                .filter { it.status == MessageStatus.PENDING }
                .forEach { message ->
                    messageQueue.enqueueOutgoing(
                        message.peerId,
                        message.message,
                        message.priority
                    )
                }

            incomingMessages
                .filter { it.status == MessageStatus.PENDING }
                .forEach { message ->
                    messageQueue.enqueueIncoming(
                        message.peerId,
                        message.message
                    )
                }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to restore messages", e)
        }
    }

    /**
     * 保存消息到存储
     */
    private suspend fun saveMessages() {
        try {
            val outgoingMessages = messageQueue.getAllOutgoingMessages()
            val incomingMessages = messageQueue.getAllIncomingMessages()

            storage.saveOutgoingMessages(outgoingMessages)
            storage.saveIncomingMessages(incomingMessages)

            Log.d(TAG, "Messages saved (outgoing: ${outgoingMessages.size}, incoming: ${incomingMessages.size})")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save messages", e)
        }
    }

    /**
     * 启动自动保存
     */
    private fun startAutoSave() {
        autoSaveJob = scope.launch {
            while (isActive) {
                try {
                    delay(AUTO_SAVE_INTERVAL)
                    saveMessages()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Error in auto-save", e)
                }
            }
        }

        Log.d(TAG, "Auto-save started")
    }

    /**
     * 立即保存消息
     */
    suspend fun saveNow() {
        saveMessages()
    }

    // ========== 转发到 MessageQueue 的方法 ==========

    /**
     * 添加待发送消息
     */
    suspend fun enqueueOutgoing(
        peerId: String,
        message: com.chainlesschain.android.core.e2ee.protocol.RatchetMessage,
        priority: Int = MessagePriority.NORMAL
    ): String {
        val messageId = messageQueue.enqueueOutgoing(peerId, message, priority)
        // 触发保存
        scope.launch { saveMessages() }
        return messageId
    }

    /**
     * 获取下一条待发送消息
     */
    suspend fun dequeueOutgoing(peerId: String? = null): QueuedMessage? {
        return messageQueue.dequeueOutgoing(peerId)
    }

    /**
     * 标记消息发送成功
     */
    suspend fun markOutgoingSent(messageId: String) {
        messageQueue.markOutgoingSent(messageId)
        // 触发保存
        scope.launch { saveMessages() }
    }

    /**
     * 标记消息发送失败
     */
    suspend fun markOutgoingFailed(messageId: String, retry: Boolean = true) {
        messageQueue.markOutgoingFailed(messageId, retry)
        // 触发保存
        scope.launch { saveMessages() }
    }

    /**
     * 添加已接收消息
     */
    suspend fun enqueueIncoming(
        peerId: String,
        message: com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
    ): String {
        val messageId = messageQueue.enqueueIncoming(peerId, message)
        // 触发保存
        scope.launch { saveMessages() }
        return messageId
    }

    /**
     * 获取下一条待处理的已接收消息
     */
    suspend fun dequeueIncoming(peerId: String? = null): QueuedMessage? {
        return messageQueue.dequeueIncoming(peerId)
    }

    /**
     * 标记已接收消息处理完成
     */
    suspend fun markIncomingProcessed(messageId: String) {
        messageQueue.markIncomingProcessed(messageId)
        // 触发保存
        scope.launch { saveMessages() }
    }

    /**
     * 标记已接收消息处理失败
     */
    suspend fun markIncomingFailed(messageId: String) {
        messageQueue.markIncomingFailed(messageId)
        // 触发保存
        scope.launch { saveMessages() }
    }

    /**
     * 获取对等方的待发送消息数量
     */
    suspend fun getOutgoingCount(peerId: String): Int {
        return messageQueue.getOutgoingCount(peerId)
    }

    /**
     * 获取对等方的待处理消息数量
     */
    suspend fun getIncomingCount(peerId: String): Int {
        return messageQueue.getIncomingCount(peerId)
    }

    /**
     * 获取所有待发送消息
     */
    suspend fun getAllOutgoingMessages(): List<QueuedMessage> {
        return messageQueue.getAllOutgoingMessages()
    }

    /**
     * 获取所有待处理消息
     */
    suspend fun getAllIncomingMessages(): List<QueuedMessage> {
        return messageQueue.getAllIncomingMessages()
    }

    /**
     * 清除对等方的所有消息
     */
    suspend fun clearPeerMessages(peerId: String) {
        messageQueue.clearPeerMessages(peerId)
        // 触发保存
        scope.launch { saveMessages() }
    }

    /**
     * 清除所有消息
     */
    suspend fun clearAll() {
        messageQueue.clearAll()
        storage.clearAll()
    }

    /**
     * 获取队列统计信息
     */
    suspend fun getStatistics(): QueueStatistics {
        return messageQueue.getStatistics()
    }
}
