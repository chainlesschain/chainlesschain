package com.chainlesschain.android.core.e2ee.receipt

import timber.log.Timber
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

/**
 * 已读回执管理器
 *
 * 管理加密的已读回执，支持批量确认和状态追踪
 */
class ReadReceiptManager(
    private val encryptCallback: suspend (peerId: String, data: ByteArray) -> RatchetMessage,
    private val decryptCallback: suspend (peerId: String, message: RatchetMessage) -> ByteArray
) {

    companion object {
        private const val BATCH_SIZE = 10 // 批量确认的最大消息数
        private const val BATCH_DELAY = 2000L // 批量确认延迟（毫秒）
    }

    private val json = Json {
        ignoreUnknownKeys = true
    }

    // 消息回执状态
    private val receiptStatuses = mutableMapOf<String, MutableMap<String, MessageReceiptStatus>>()
    private val mutex = Mutex()

    // 待发送的已读回执（批量）
    private val pendingReceipts = mutableMapOf<String, MutableList<String>>()

    // 回执状态变化流
    private val _receiptUpdates = MutableStateFlow<ReceiptUpdate?>(null)
    val receiptUpdates: StateFlow<ReceiptUpdate?> = _receiptUpdates.asStateFlow()

    /**
     * 标记消息为已送达
     *
     * @param peerId 对等方ID
     * @param messageId 消息ID
     */
    suspend fun markAsDelivered(peerId: String, messageId: String) {
        Timber.d("Marking message as delivered: $messageId")

        updateStatus(peerId, messageId) { status ->
            status.delivered = true
            status.deliveredAt = System.currentTimeMillis()
        }

        // 发送已送达回执
        sendReceipt(peerId, ReadReceipt.forMessage(messageId, ReceiptType.DELIVERED))
    }

    /**
     * 标记消息为已读
     *
     * @param peerId 对等方ID
     * @param messageId 消息ID
     * @param sendReceipt 是否发送已读回执（默认true）
     */
    suspend fun markAsRead(peerId: String, messageId: String, sendReceipt: Boolean = true) {
        Timber.d("Marking message as read: $messageId")

        updateStatus(peerId, messageId) { status ->
            status.read = true
            status.readAt = System.currentTimeMillis()
            // 已读意味着已送达
            if (!status.delivered) {
                status.delivered = true
                status.deliveredAt = System.currentTimeMillis()
            }
        }

        if (sendReceipt) {
            // 添加到待发送批次
            addToPendingBatch(peerId, messageId, ReceiptType.READ)
        }
    }

    /**
     * 批量标记消息为已读
     *
     * @param peerId 对等方ID
     * @param messageIds 消息ID列表
     */
    suspend fun markMultipleAsRead(peerId: String, messageIds: List<String>) {
        Timber.d("Marking ${messageIds.size} messages as read")

        messageIds.forEach { messageId ->
            updateStatus(peerId, messageId) { status ->
                status.read = true
                status.readAt = System.currentTimeMillis()
                if (!status.delivered) {
                    status.delivered = true
                    status.deliveredAt = System.currentTimeMillis()
                }
            }
        }

        // 发送批量已读回执
        sendReceipt(peerId, ReadReceipt.forMessages(messageIds, ReceiptType.READ))
    }

    /**
     * 标记消息为已播放（语音/视频）
     *
     * @param peerId 对等方ID
     * @param messageId 消息ID
     */
    suspend fun markAsPlayed(peerId: String, messageId: String) {
        Timber.d("Marking message as played: $messageId")

        updateStatus(peerId, messageId) { status ->
            status.played = true
            status.playedAt = System.currentTimeMillis()
        }

        sendReceipt(peerId, ReadReceipt.forMessage(messageId, ReceiptType.PLAYED))
    }

    /**
     * 标记消息为已截屏
     *
     * @param peerId 对等方ID
     * @param messageId 消息ID
     */
    suspend fun markAsScreenshot(peerId: String, messageId: String) {
        Timber.d("Marking message as screenshot: $messageId")

        updateStatus(peerId, messageId) { status ->
            status.screenshot = true
            status.screenshotAt = System.currentTimeMillis()
        }

        sendReceipt(peerId, ReadReceipt.forMessage(messageId, ReceiptType.SCREENSHOT))
    }

    /**
     * 处理接收到的已读回执
     *
     * @param peerId 对等方ID
     * @param encryptedReceipt 加密的回执消息
     */
    suspend fun handleReceivedReceipt(peerId: String, encryptedReceipt: RatchetMessage) {
        try {
            // 解密回执
            val decryptedData = decryptCallback(peerId, encryptedReceipt)
            val receiptJson = String(decryptedData, Charsets.UTF_8)
            val receipt = json.decodeFromString<ReadReceipt>(receiptJson)

            Timber.d("Received ${receipt.type} receipt for ${receipt.messageIds.size} messages from $peerId")

            // 更新状态
            receipt.messageIds.forEach { messageId ->
                updateStatus(peerId, messageId) { status ->
                    status.update(receipt)
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle received receipt")
        }
    }

    /**
     * 获取消息的回执状态
     *
     * @param peerId 对等方ID
     * @param messageId 消息ID
     * @return 回执状态
     */
    suspend fun getReceiptStatus(peerId: String, messageId: String): MessageReceiptStatus? = mutex.withLock {
        receiptStatuses[peerId]?.get(messageId)
    }

    /**
     * 获取对等方的所有回执状态
     *
     * @param peerId 对等方ID
     * @return 回执状态映射
     */
    suspend fun getAllReceiptStatuses(peerId: String): Map<String, MessageReceiptStatus> = mutex.withLock {
        receiptStatuses[peerId]?.toMap() ?: emptyMap()
    }

    /**
     * 清除对等方的回执状态
     *
     * @param peerId 对等方ID
     */
    suspend fun clearReceiptStatuses(peerId: String) = mutex.withLock {
        receiptStatuses.remove(peerId)
        pendingReceipts.remove(peerId)
        Timber.i("Cleared receipt statuses for peer: $peerId")
    }

    /**
     * 清除所有回执状态
     */
    suspend fun clearAll() = mutex.withLock {
        receiptStatuses.clear()
        pendingReceipts.clear()
        Timber.i("Cleared all receipt statuses")
    }

    /**
     * 更新回执状态
     */
    private suspend fun updateStatus(
        peerId: String,
        messageId: String,
        update: (MessageReceiptStatus) -> Unit
    ) = mutex.withLock {
        val peerStatuses = receiptStatuses.getOrPut(peerId) { mutableMapOf() }
        val status = peerStatuses.getOrPut(messageId) { MessageReceiptStatus(messageId) }

        update(status)

        // 触发状态更新事件
        _receiptUpdates.value = ReceiptUpdate(peerId, messageId, status)
    }

    /**
     * 添加到待发送批次
     */
    private suspend fun addToPendingBatch(peerId: String, messageId: String, type: ReceiptType) = mutex.withLock {
        val batch = pendingReceipts.getOrPut(peerId) { mutableListOf() }
        batch.add(messageId)

        // 如果批次达到最大值，立即发送
        if (batch.size >= BATCH_SIZE) {
            flushPendingBatch(peerId, type)
        }
    }

    /**
     * 刷新待发送批次
     */
    private suspend fun flushPendingBatch(peerId: String, type: ReceiptType) {
        val batch = pendingReceipts.remove(peerId)
        if (batch != null && batch.isNotEmpty()) {
            sendReceipt(peerId, ReadReceipt.forMessages(batch, type))
        }
    }

    /**
     * 发送已读回执
     */
    private suspend fun sendReceipt(peerId: String, receipt: ReadReceipt) {
        try {
            // 序列化回执
            val receiptJson = json.encodeToString(receipt)
            val receiptData = receiptJson.toByteArray(Charsets.UTF_8)

            // 加密回执
            val encryptedReceipt = encryptCallback(peerId, receiptData)

            // 实际发送由调用方处理（通过回调或队列）
            Timber.d("Encrypted ${receipt.type} receipt for ${receipt.messageIds.size} messages")
        } catch (e: Exception) {
            Timber.e(e, "Failed to send receipt")
        }
    }

    /**
     * 获取统计信息
     */
    suspend fun getStatistics(peerId: String): ReceiptStatistics = mutex.withLock {
        val statuses = receiptStatuses[peerId]?.values ?: emptyList()

        ReceiptStatistics(
            totalMessages = statuses.size,
            deliveredCount = statuses.count { it.delivered },
            readCount = statuses.count { it.read },
            playedCount = statuses.count { it.played },
            screenshotCount = statuses.count { it.screenshot }
        )
    }
}

/**
 * 回执更新事件
 */
data class ReceiptUpdate(
    val peerId: String,
    val messageId: String,
    val status: MessageReceiptStatus
)

/**
 * 回执统计信息
 */
data class ReceiptStatistics(
    val totalMessages: Int,
    val deliveredCount: Int,
    val readCount: Int,
    val playedCount: Int,
    val screenshotCount: Int
) {
    val deliveryRate: Float
        get() = if (totalMessages > 0) deliveredCount.toFloat() / totalMessages else 0f

    val readRate: Float
        get() = if (totalMessages > 0) readCount.toFloat() / totalMessages else 0f
}
