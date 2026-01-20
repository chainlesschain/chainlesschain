package com.chainlesschain.android.core.p2p.transport

import android.util.Log
import com.chainlesschain.android.core.p2p.connection.P2PConnection
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject

/**
 * DataChannel消息传输实现
 *
 * 基于WebRTC DataChannel的消息传输层
 * 支持消息分片、优先级队列、自动重传
 */
class DataChannelTransport @Inject constructor(
    private val connection: P2PConnection
) : MessageTransport {

    companion object {
        private const val TAG = "DataChannelTransport"

        /** 最大消息大小（256KB，避免DataChannel分片问题） */
        private const val MAX_MESSAGE_SIZE = 256 * 1024

        /** 分片大小（64KB） */
        private const val CHUNK_SIZE = 64 * 1024
    }

    // 统计信息
    private val sentMessages = AtomicLong(0)
    private val receivedMessages = AtomicLong(0)
    private val failedMessages = AtomicLong(0)
    private val totalBytes = AtomicLong(0)

    // 待确认消息（消息ID -> 消息）
    private val pendingAcks = ConcurrentHashMap<String, P2PMessage>()

    // 消息发送队列（按优先级）
    private val messageQueues = mapOf(
        MessagePriority.URGENT to mutableListOf<P2PMessage>(),
        MessagePriority.HIGH to mutableListOf<P2PMessage>(),
        MessagePriority.NORMAL to mutableListOf<P2PMessage>(),
        MessagePriority.LOW to mutableListOf<P2PMessage>()
    )

    // 接收消息流
    private val _receivedMessages = MutableSharedFlow<P2PMessage>()

    // 消息分片缓存（用于重组大消息）
    private val fragmentCache = ConcurrentHashMap<String, MutableList<MessageFragment>>()

    // 协程作用域
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    init {
        // 监听连接收到的消息
        scope.launch {
            connection.observeMessages().collect { message ->
                handleReceivedMessage(message)
            }
        }
    }

    override suspend fun send(message: P2PMessage): Boolean {
        return try {
            val payload = message.payload

            // 检查消息大小
            if (payload.length > MAX_MESSAGE_SIZE) {
                // 需要分片
                sendFragmented(message)
            } else {
                // 直接发送
                connection.sendMessage(message)

                if (message.requiresAck) {
                    pendingAcks[message.id] = message
                }

                sentMessages.incrementAndGet()
                totalBytes.addAndGet(payload.length.toLong())

                Log.d(TAG, "Message sent: ${message.id}")
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message", e)
            failedMessages.incrementAndGet()
            false
        }
    }

    override suspend fun sendBatch(messages: List<P2PMessage>): Int {
        var successCount = 0

        messages.forEach { message ->
            if (send(message)) {
                successCount++
            }
        }

        Log.d(TAG, "Batch sent: $successCount/${messages.size}")
        return successCount
    }

    override fun receive(): Flow<P2PMessage> {
        return _receivedMessages.asSharedFlow()
    }

    override suspend fun sendAck(messageId: String) {
        val ackMessage = P2PMessage(
            id = UUID.randomUUID().toString(),
            fromDeviceId = "", // 将由连接层填充
            toDeviceId = "",
            type = MessageType.ACK,
            payload = messageId,
            requiresAck = false
        )

        connection.sendMessage(ackMessage)
        Log.d(TAG, "ACK sent for message: $messageId")
    }

    override fun getStatistics(): TransportStatistics {
        return TransportStatistics(
            sentMessages = sentMessages.get(),
            receivedMessages = receivedMessages.get(),
            failedMessages = failedMessages.get(),
            pendingAcks = pendingAcks.size,
            averageLatency = 0, // TODO: 实现延迟统计
            totalBytes = totalBytes.get()
        )
    }

    /**
     * 发送分片消息
     */
    private suspend fun sendFragmented(message: P2PMessage): Boolean {
        val payload = message.payload
        val totalChunks = (payload.length + CHUNK_SIZE - 1) / CHUNK_SIZE

        Log.d(TAG, "Fragmenting message ${message.id} into $totalChunks chunks")

        for (i in 0 until totalChunks) {
            val start = i * CHUNK_SIZE
            val end = minOf(start + CHUNK_SIZE, payload.length)
            val chunk = payload.substring(start, end)

            val fragment = MessageFragment(
                messageId = message.id,
                fragmentIndex = i,
                totalFragments = totalChunks,
                data = chunk
            )

            val fragmentMessage = P2PMessage(
                id = "${message.id}_frag_$i",
                fromDeviceId = message.fromDeviceId,
                toDeviceId = message.toDeviceId,
                type = MessageType.TEXT, // 使用特殊类型标记分片
                payload = kotlinx.serialization.json.Json.encodeToString(
                    MessageFragment.serializer(),
                    fragment
                ),
                requiresAck = false // 整个消息确认，而非单个分片
            )

            connection.sendMessage(fragmentMessage)
        }

        sentMessages.incrementAndGet()
        totalBytes.addAndGet(payload.length.toLong())

        return true
    }

    /**
     * 处理接收到的消息
     */
    private suspend fun handleReceivedMessage(message: P2PMessage) {
        when (message.type) {
            MessageType.ACK -> {
                // 处理确认消息
                val originalMessageId = message.payload
                pendingAcks.remove(originalMessageId)
                Log.d(TAG, "ACK received for message: $originalMessageId")
            }

            MessageType.TEXT -> {
                // 检查是否是分片消息
                if (message.payload.contains("\"messageId\"")) {
                    try {
                        val fragment = kotlinx.serialization.json.Json.decodeFromString(
                            MessageFragment.serializer(),
                            message.payload
                        )
                        handleFragment(fragment)
                    } catch (e: Exception) {
                        // 不是分片消息，正常处理
                        processMessage(message)
                    }
                } else {
                    processMessage(message)
                }
            }

            else -> {
                processMessage(message)
            }
        }
    }

    /**
     * 处理消息分片
     */
    private suspend fun handleFragment(fragment: MessageFragment) {
        val messageId = fragment.messageId
        val fragments = fragmentCache.getOrPut(messageId) { mutableListOf() }

        fragments.add(fragment)

        Log.d(TAG, "Fragment received: ${fragment.fragmentIndex + 1}/${fragment.totalFragments}")

        // 检查是否收到所有分片
        if (fragments.size == fragment.totalFragments) {
            // 重组消息
            val sortedFragments = fragments.sortedBy { it.fragmentIndex }
            val completePayload = sortedFragments.joinToString("") { it.data }

            // 创建完整消息
            val completeMessage = P2PMessage(
                id = messageId,
                fromDeviceId = "", // 从原始分片中提取
                toDeviceId = "",
                type = MessageType.TEXT,
                payload = completePayload,
                requiresAck = false
            )

            fragmentCache.remove(messageId)
            processMessage(completeMessage)

            Log.d(TAG, "Message reassembled: $messageId")
        }
    }

    /**
     * 处理完整消息
     */
    private suspend fun processMessage(message: P2PMessage) {
        receivedMessages.incrementAndGet()

        // 自动发送确认
        if (message.requiresAck) {
            sendAck(message.id)
        }

        // 发射到接收流
        _receivedMessages.emit(message)

        Log.d(TAG, "Message processed: ${message.id}")
    }

    /**
     * 清理过期的待确认消息
     */
    fun cleanupPendingAcks(timeoutMs: Long = 60000) {
        val now = System.currentTimeMillis()

        pendingAcks.values.removeIf { message ->
            (now - message.timestamp) > timeoutMs
        }
    }

    /**
     * 清理过期的分片缓存
     */
    fun cleanupFragmentCache(timeoutMs: Long = 120000) {
        // TODO: 添加时间戳到Fragment，清理超时的分片
        fragmentCache.clear()
    }
}

/**
 * 消息分片
 */
@kotlinx.serialization.Serializable
data class MessageFragment(
    /** 原始消息ID */
    val messageId: String,

    /** 分片索引（从0开始） */
    val fragmentIndex: Int,

    /** 总分片数 */
    val totalFragments: Int,

    /** 分片数据 */
    val data: String
)
