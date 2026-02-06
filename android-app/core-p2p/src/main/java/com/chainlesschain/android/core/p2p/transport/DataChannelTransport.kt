package com.chainlesschain.android.core.p2p.transport

import android.util.Log
import com.chainlesschain.android.core.p2p.config.P2PFeatureFlags
import com.chainlesschain.android.core.p2p.connection.P2PConnection
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
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

        /** 高水位线（缓冲区阈值，超过此值暂停发送） */
        private const val HIGH_WATER_MARK = 1024 * 1024  // 1MB

        /** 低水位线（缓冲区恢复阈值，低于此值恢复发送） */
        private const val LOW_WATER_MARK = 256 * 1024    // 256KB

        /** 最大发送速率（字节/秒），0 表示不限制 */
        private const val MAX_SEND_RATE = 0L

        /** 发送队列最大容量 */
        private const val MAX_QUEUE_SIZE = 1000

        /** 背压等待超时（毫秒） */
        private const val BACKPRESSURE_TIMEOUT_MS = 30_000L

        /** 分片超时时间（毫秒） */
        private const val FRAGMENT_TIMEOUT_MS = 120_000L

        /** 分片清理间隔（毫秒） */
        private const val FRAGMENT_CLEANUP_INTERVAL_MS = 30_000L
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
    private val fragmentCache = ConcurrentHashMap<String, FragmentAssemblyContext>()

    // 协程作用域
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 流控制状态
    private val _flowControlState = MutableSharedFlow<FlowControlState>(
        extraBufferCapacity = 1,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST
    )
    val flowControlState: Flow<FlowControlState> = _flowControlState.asSharedFlow()

    @Volatile
    private var isPaused = false

    @Volatile
    private var currentBufferedAmount = 0L

    // 发送速率限制
    private var lastSendTime = 0L
    private var bytesSentInWindow = 0L
    private val rateLimitWindowMs = 1000L  // 1秒窗口

    // 发送队列
    private val sendQueue = java.util.concurrent.LinkedBlockingDeque<QueuedMessage>(MAX_QUEUE_SIZE)
    private var sendJob: Job? = null

    // 分片清理任务
    private var fragmentCleanupJob: Job? = null

    init {
        // 监听连接收到的消息
        scope.launch {
            connection.observeMessages().collect { message ->
                handleReceivedMessage(message)
            }
        }

        // 启动分片清理任务
        startFragmentCleanup()
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

    /**
     * 更新缓冲区状态（由 DataChannel Observer 调用）
     */
    fun updateBufferedAmount(amount: Long) {
        val previousAmount = currentBufferedAmount
        currentBufferedAmount = amount

        Log.v(TAG, "Buffered amount: $amount bytes")

        // 检查是否需要暂停/恢复发送
        when {
            amount > HIGH_WATER_MARK && !isPaused -> {
                isPaused = true
                Log.w(TAG, "High water mark reached ($amount > $HIGH_WATER_MARK), pausing sends")
                scope.launch {
                    _flowControlState.emit(FlowControlState.Paused(amount, HIGH_WATER_MARK))
                }
            }
            amount < LOW_WATER_MARK && isPaused -> {
                isPaused = false
                Log.i(TAG, "Low water mark reached ($amount < $LOW_WATER_MARK), resuming sends")
                scope.launch {
                    _flowControlState.emit(FlowControlState.Resumed(amount))
                    // 处理队列中的待发送消息
                    processSendQueue()
                }
            }
        }
    }

    /**
     * 带流控制的发送
     */
    suspend fun sendWithFlowControl(message: P2PMessage): SendResult {
        // 检查队列容量
        if (sendQueue.size >= MAX_QUEUE_SIZE) {
            Log.w(TAG, "Send queue full, dropping message ${message.id}")
            return SendResult.QueueFull
        }

        return if (isPaused) {
            // 暂停状态，加入队列
            val queued = QueuedMessage(message, System.currentTimeMillis())
            sendQueue.offer(queued)
            Log.d(TAG, "Message queued due to backpressure: ${message.id}")
            SendResult.Queued(sendQueue.size)
        } else {
            // 正常发送
            val success = sendWithRateLimit(message)
            if (success) {
                SendResult.Sent
            } else {
                SendResult.Failed("Send failed")
            }
        }
    }

    /**
     * 带速率限制的发送
     */
    private suspend fun sendWithRateLimit(message: P2PMessage): Boolean {
        if (MAX_SEND_RATE > 0) {
            val now = System.currentTimeMillis()

            // 检查是否在新窗口
            if (now - lastSendTime > rateLimitWindowMs) {
                lastSendTime = now
                bytesSentInWindow = 0
            }

            // 检查是否超过速率限制
            val messageSize = message.payload.length.toLong()
            if (bytesSentInWindow + messageSize > MAX_SEND_RATE) {
                // 等待到下一个窗口
                val waitTime = rateLimitWindowMs - (now - lastSendTime)
                if (waitTime > 0) {
                    Log.d(TAG, "Rate limiting, waiting ${waitTime}ms")
                    delay(waitTime)
                }
                lastSendTime = System.currentTimeMillis()
                bytesSentInWindow = 0
            }

            bytesSentInWindow += messageSize
        }

        return send(message)
    }

    /**
     * 处理发送队列
     */
    private suspend fun processSendQueue() {
        while (!isPaused && sendQueue.isNotEmpty()) {
            val queued = sendQueue.poll() ?: break

            // 检查消息是否过期
            val age = System.currentTimeMillis() - queued.enqueuedAt
            if (age > BACKPRESSURE_TIMEOUT_MS) {
                Log.w(TAG, "Queued message expired after ${age}ms: ${queued.message.id}")
                failedMessages.incrementAndGet()
                continue
            }

            val success = sendWithRateLimit(queued.message)
            if (!success) {
                Log.w(TAG, "Failed to send queued message: ${queued.message.id}")
                failedMessages.incrementAndGet()
            }
        }

        if (sendQueue.isNotEmpty()) {
            Log.d(TAG, "Queue processing paused, ${sendQueue.size} messages remaining")
        }
    }

    /**
     * 启动发送队列处理器
     */
    fun startQueueProcessor() {
        sendJob?.cancel()
        sendJob = scope.launch {
            while (isActive) {
                if (!isPaused && sendQueue.isNotEmpty()) {
                    processSendQueue()
                }
                delay(100) // 检查间隔
            }
        }
    }

    /**
     * 停止发送队列处理器
     */
    fun stopQueueProcessor() {
        sendJob?.cancel()
        sendJob = null
    }

    /**
     * 获取流控制统计
     */
    fun getFlowControlStats(): FlowControlStats {
        return FlowControlStats(
            isPaused = isPaused,
            bufferedAmount = currentBufferedAmount,
            queueSize = sendQueue.size,
            highWaterMark = HIGH_WATER_MARK.toLong(),
            lowWaterMark = LOW_WATER_MARK.toLong()
        )
    }

    /**
     * 清空发送队列
     */
    fun clearQueue() {
        val count = sendQueue.size
        sendQueue.clear()
        Log.i(TAG, "Cleared $count messages from send queue")
    }

    /**
     * 释放资源
     */
    fun release() {
        stopQueueProcessor()
        clearQueue()
        scope.cancel()
    }
}

/**
 * 流控制状态
 */
sealed class FlowControlState {
    /** 正常 */
    data object Normal : FlowControlState()

    /** 暂停发送（背压） */
    data class Paused(val bufferedAmount: Long, val threshold: Long) : FlowControlState()

    /** 恢复发送 */
    data class Resumed(val bufferedAmount: Long) : FlowControlState()
}

/**
 * 发送结果
 */
sealed class SendResult {
    /** 发送成功 */
    data object Sent : SendResult()

    /** 已加入队列 */
    data class Queued(val queuePosition: Int) : SendResult()

    /** 队列已满 */
    data object QueueFull : SendResult()

    /** 发送失败 */
    data class Failed(val reason: String) : SendResult()
}

/**
 * 队列消息
 */
data class QueuedMessage(
    val message: P2PMessage,
    val enqueuedAt: Long
)

/**
 * 流控制统计
 */
data class FlowControlStats(
    val isPaused: Boolean,
    val bufferedAmount: Long,
    val queueSize: Int,
    val highWaterMark: Long,
    val lowWaterMark: Long
)

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
