package com.chainlesschain.android.core.p2p.transport

import android.util.Log
import com.chainlesschain.android.core.p2p.config.P2PFeatureFlags
import com.chainlesschain.android.core.p2p.connection.P2PConnection
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.monitor.ConnectionQualityMonitor
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
    private val connection: P2PConnection,
    private val qualityMonitor: ConnectionQualityMonitor
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

        /** 分片 NACK 超时（毫秒）- 等待分片到达的时间 */
        private const val FRAGMENT_NACK_TIMEOUT_MS = 5_000L

        /** NACK 检查间隔（毫秒） */
        private const val NACK_CHECK_INTERVAL_MS = 2_000L

        /** 重传基础延迟（毫秒） */
        private const val RETRANSMIT_BASE_DELAY_MS = 1_000L

        /** 重传最大延迟（毫秒） */
        private const val RETRANSMIT_MAX_DELAY_MS = 15_000L

        /** 最大重传次数 */
        private const val MAX_RETRANSMIT_ATTEMPTS = 3

        /** ACK 批量聚合间隔（毫秒） */
        private const val ACK_BATCH_INTERVAL_MS = 100L
    }

    // 统计信息
    private val sentMessages = AtomicLong(0)
    private val receivedMessages = AtomicLong(0)
    private val failedMessages = AtomicLong(0)
    private val totalBytes = AtomicLong(0)

    // 待确认消息（消息ID -> 消息）
    private val pendingAcks = ConcurrentHashMap<String, P2PMessage>()

    // 消息发送时间跟踪（用于计算RTT）
    private val messageSendTimes = ConcurrentHashMap<String, Long>()

    // 消息发送队列（按优先级）
    private val messageQueues = mapOf(
        MessagePriority.URGENT to mutableListOf<P2PMessage>(),
        MessagePriority.HIGH to mutableListOf<P2PMessage>(),
        MessagePriority.NORMAL to mutableListOf<P2PMessage>(),
        MessagePriority.LOW to mutableListOf<P2PMessage>()
    )

    // 接收消息流
    private val _receivedMessages = MutableSharedFlow<P2PMessage>()

    // 消息分片缓存（用于重组大消息）- 使用 FragmentAssemblyContext 支持超时和重复检测
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

    // 已发送的分片（用于重传）
    private val sentFragments = ConcurrentHashMap<String, SentFragmentContext>()

    // NACK 检查任务
    private var nackCheckJob: Job? = null

    // 批量 ACK 聚合
    private val pendingBatchAcks = mutableListOf<String>()
    private var batchAckJob: Job? = null

    // 重传管理器
    private val retransmissionManager = RetransmissionManager()

    init {
        // 监听连接收到的消息
        scope.launch {
            connection.observeMessages().collect { message ->
                handleReceivedMessage(message)
            }
        }

        // 启动分片清理任务
        startFragmentCleanup()

        // 启动 NACK 检查（如果启用）
        if (P2PFeatureFlags.enableFragmentRecovery) {
            startNackCheck()
        }

        // 启动批量 ACK（如果启用）
        if (P2PFeatureFlags.enableBatchAck) {
            startBatchAckProcessor()
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
                    // 记录发送时间用于计算RTT
                    messageSendTimes[message.id] = System.currentTimeMillis()
                }

                sentMessages.incrementAndGet()
                totalBytes.addAndGet(payload.length.toLong())
                qualityMonitor.recordMessageSent()

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
        if (P2PFeatureFlags.enableBatchAck) {
            // 添加到批量 ACK 队列
            synchronized(pendingBatchAcks) {
                pendingBatchAcks.add(messageId)
            }
            Log.d(TAG, "ACK queued for batch: $messageId")
        } else {
            // 立即发送 ACK
            sendAckImmediate(messageId)
        }
    }

    /**
     * 立即发送 ACK
     */
    private suspend fun sendAckImmediate(messageId: String) {
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

    /**
     * 发送批量 ACK
     */
    private suspend fun sendBatchAck() {
        val ackList: List<String>
        synchronized(pendingBatchAcks) {
            if (pendingBatchAcks.isEmpty()) return
            ackList = pendingBatchAcks.toList()
            pendingBatchAcks.clear()
        }

        val batchAckMessage = P2PMessage(
            id = UUID.randomUUID().toString(),
            fromDeviceId = "",
            toDeviceId = "",
            type = MessageType.BATCH_ACK,
            payload = kotlinx.serialization.json.Json.encodeToString(ackList),
            requiresAck = false
        )

        connection.sendMessage(batchAckMessage)
        Log.d(TAG, "Batch ACK sent for ${ackList.size} messages")
    }

    /**
     * 启动批量 ACK 处理器
     */
    private fun startBatchAckProcessor() {
        batchAckJob?.cancel()
        batchAckJob = scope.launch {
            while (isActive) {
                delay(ACK_BATCH_INTERVAL_MS)
                sendBatchAck()
            }
        }
        Log.d(TAG, "Batch ACK processor started (interval: ${ACK_BATCH_INTERVAL_MS}ms)")
    }

    /**
     * 停止批量 ACK 处理器
     */
    private fun stopBatchAckProcessor() {
        batchAckJob?.cancel()
        batchAckJob = null
    }

    override fun getStatistics(): TransportStatistics {
        // 从质量监控器获取平均RTT
        val avgLatency = qualityMonitor.connectionQuality.value.averageRttMs

        return TransportStatistics(
            sentMessages = sentMessages.get(),
            receivedMessages = receivedMessages.get(),
            failedMessages = failedMessages.get(),
            pendingAcks = pendingAcks.size,
            averageLatency = avgLatency,
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

        // 如果启用分片恢复，创建发送上下文
        val sentContext = if (P2PFeatureFlags.enableFragmentRecovery) {
            SentFragmentContext(
                messageId = message.id,
                totalFragments = totalChunks,
                sentAt = System.currentTimeMillis()
            ).also { sentFragments[message.id] = it }
        } else {
            null
        }

        for (i in 0 until totalChunks) {
            val start = i * CHUNK_SIZE
            val end = minOf(start + CHUNK_SIZE, payload.length)
            val chunk = payload.substring(start, end)

            val fragment = MessageFragment(
                messageId = message.id,
                fragmentIndex = i,
                totalFragments = totalChunks,
                data = chunk,
                fromDeviceId = message.fromDeviceId,
                toDeviceId = message.toDeviceId
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

            // 保存分片用于可能的重传
            sentContext?.fragments?.set(i, fragment)

            connection.sendMessage(fragmentMessage)
        }

        sentMessages.incrementAndGet()
        totalBytes.addAndGet(payload.length.toLong())
        qualityMonitor.recordMessageSent()

        // 记录发送时间（用于分片消息的整体RTT计算）
        if (message.requiresAck) {
            pendingAcks[message.id] = message
            messageSendTimes[message.id] = System.currentTimeMillis()
        }

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
                handleAckReceived(originalMessageId)
            }

            MessageType.BATCH_ACK -> {
                // 处理批量确认
                try {
                    val ackIds = kotlinx.serialization.json.Json.decodeFromString<List<String>>(message.payload)
                    ackIds.forEach { handleAckReceived(it) }
                    Log.d(TAG, "Batch ACK received for ${ackIds.size} messages")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse batch ACK", e)
                }
            }

            MessageType.FRAGMENT_NACK -> {
                // 处理分片重传请求
                try {
                    val nackPayload = kotlinx.serialization.json.Json.decodeFromString(
                        FragmentNackPayload.serializer(),
                        message.payload
                    )
                    handleFragmentNack(nackPayload)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse fragment NACK", e)
                }
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
     * 处理收到的 ACK
     */
    private fun handleAckReceived(messageId: String) {
        val removed = pendingAcks.remove(messageId)
        if (removed != null) {
            retransmissionManager.cancelRetransmission(messageId)

            // 计算RTT并报告给质量监控器
            val sendTime = messageSendTimes.remove(messageId)
            if (sendTime != null) {
                val rttMs = System.currentTimeMillis() - sendTime
                qualityMonitor.recordMessageAcked(rttMs)
                Log.d(TAG, "ACK received for message: $messageId (RTT: ${rttMs}ms)")
            } else {
                qualityMonitor.recordMessageAcked()
                Log.d(TAG, "ACK received for message: $messageId")
            }
        }

        // 清理已完成的发送分片上下文
        sentFragments.remove(messageId)
    }

    /**
     * 处理消息分片
     */
    private suspend fun handleFragment(fragment: MessageFragment) {
        val messageId = fragment.messageId

        // 获取或创建分片组装上下文
        val context = fragmentCache.getOrPut(messageId) {
            FragmentAssemblyContext(
                messageId = messageId,
                totalFragments = fragment.totalFragments,
                createdAt = System.currentTimeMillis()
            )
        }

        // 检测重复分片
        if (P2PFeatureFlags.enableDuplicateDetection) {
            if (context.receivedIndices.contains(fragment.fragmentIndex)) {
                Log.w(TAG, "Duplicate fragment detected: $messageId[${fragment.fragmentIndex}], ignoring")
                return
            }
        }

        // 添加分片
        context.fragments.add(fragment)
        context.receivedIndices.add(fragment.fragmentIndex)
        context.lastUpdatedAt = System.currentTimeMillis()

        Log.d(TAG, "Fragment received: ${context.fragments.size}/${fragment.totalFragments} for message $messageId")

        // 检查是否收到所有分片
        if (context.fragments.size == fragment.totalFragments) {
            // 重组消息
            val sortedFragments = context.fragments.sortedBy { it.fragmentIndex }
            val completePayload = sortedFragments.joinToString("") { it.data }

            // 从第一个分片提取设备ID
            val firstFragment = sortedFragments.first()

            // 创建完整消息
            val completeMessage = P2PMessage(
                id = messageId,
                fromDeviceId = firstFragment.fromDeviceId,
                toDeviceId = firstFragment.toDeviceId,
                type = MessageType.TEXT,
                payload = completePayload,
                requiresAck = false
            )

            fragmentCache.remove(messageId)
            processMessage(completeMessage)

            Log.i(TAG, "Message reassembled: $messageId (${sortedFragments.size} fragments, from: ${firstFragment.fromDeviceId})")
        }
    }

    /**
     * 检查分片间隙并发送 NACK
     */
    private suspend fun checkFragmentGapsAndSendNack() {
        if (!P2PFeatureFlags.enableFragmentRecovery) return

        val now = System.currentTimeMillis()

        fragmentCache.forEach { (messageId, context) ->
            // 跳过刚创建的上下文
            val age = now - context.createdAt
            if (age < FRAGMENT_NACK_TIMEOUT_MS) return@forEach

            // 检查分片间隙
            val missingIndices = mutableListOf<Int>()
            for (i in 0 until context.totalFragments) {
                if (!context.receivedIndices.contains(i)) {
                    missingIndices.add(i)
                }
            }

            if (missingIndices.isNotEmpty() && !context.nackSent) {
                Log.w(TAG, "Missing fragments for $messageId: $missingIndices, sending NACK")
                sendFragmentNack(messageId, missingIndices)
                context.nackSent = true
                context.nackSentAt = now
            }
        }
    }

    /**
     * 发送分片 NACK 请求缺失的分片
     */
    private suspend fun sendFragmentNack(messageId: String, missingIndices: List<Int>) {
        val nackPayload = FragmentNackPayload(
            messageId = messageId,
            missingIndices = missingIndices
        )

        val nackMessage = P2PMessage(
            id = UUID.randomUUID().toString(),
            fromDeviceId = "",
            toDeviceId = "",
            type = MessageType.FRAGMENT_NACK,
            payload = kotlinx.serialization.json.Json.encodeToString(
                FragmentNackPayload.serializer(),
                nackPayload
            ),
            requiresAck = false
        )

        connection.sendMessage(nackMessage)
        Log.d(TAG, "Fragment NACK sent for $messageId, missing: $missingIndices")
    }

    /**
     * 处理收到的分片 NACK，重传缺失的分片
     */
    private suspend fun handleFragmentNack(payload: FragmentNackPayload) {
        if (!P2PFeatureFlags.enableFragmentRecovery) return

        val messageId = payload.messageId
        val sentContext = sentFragments[messageId]

        if (sentContext == null) {
            Log.w(TAG, "Received NACK for unknown message: $messageId")
            return
        }

        Log.i(TAG, "Retransmitting fragments for $messageId: ${payload.missingIndices}")

        for (index in payload.missingIndices) {
            val fragment = sentContext.fragments[index]
            if (fragment != null) {
                val fragmentMessage = P2PMessage(
                    id = "${messageId}_frag_${index}_retx",
                    fromDeviceId = "",
                    toDeviceId = "",
                    type = MessageType.TEXT,
                    payload = kotlinx.serialization.json.Json.encodeToString(
                        MessageFragment.serializer(),
                        fragment
                    ),
                    requiresAck = false
                )
                connection.sendMessage(fragmentMessage)
                sentContext.retransmitCount++
            } else {
                Log.w(TAG, "Cannot retransmit fragment $index for $messageId - not found in cache")
            }
        }
    }

    /**
     * 启动 NACK 检查
     */
    private fun startNackCheck() {
        nackCheckJob?.cancel()
        nackCheckJob = scope.launch {
            while (isActive) {
                delay(NACK_CHECK_INTERVAL_MS)
                checkFragmentGapsAndSendNack()
            }
        }
        Log.d(TAG, "NACK check started (interval: ${NACK_CHECK_INTERVAL_MS}ms)")
    }

    /**
     * 停止 NACK 检查
     */
    private fun stopNackCheck() {
        nackCheckJob?.cancel()
        nackCheckJob = null
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
     *
     * @param timeoutMs 超时时间（毫秒），默认 120 秒
     * @return 清理的分片组数量
     */
    fun cleanupFragmentCache(timeoutMs: Long = FRAGMENT_TIMEOUT_MS): Int {
        val now = System.currentTimeMillis()
        var cleanedCount = 0

        fragmentCache.entries.removeIf { (messageId, context) ->
            val age = now - context.createdAt
            if (age > timeoutMs) {
                Log.w(TAG, "Removing expired fragment group: $messageId (${context.fragments.size}/${context.totalFragments} fragments, age: ${age}ms)")
                cleanedCount++
                true
            } else {
                false
            }
        }

        if (cleanedCount > 0) {
            Log.i(TAG, "Cleaned up $cleanedCount expired fragment groups")
        }

        return cleanedCount
    }

    /**
     * 启动定期分片清理
     */
    private fun startFragmentCleanup() {
        fragmentCleanupJob?.cancel()
        fragmentCleanupJob = scope.launch {
            while (isActive) {
                delay(FRAGMENT_CLEANUP_INTERVAL_MS)
                cleanupFragmentCache()
            }
        }
        Log.d(TAG, "Fragment cleanup started (interval: ${FRAGMENT_CLEANUP_INTERVAL_MS}ms)")
    }

    /**
     * 停止分片清理
     */
    private fun stopFragmentCleanup() {
        fragmentCleanupJob?.cancel()
        fragmentCleanupJob = null
    }

    /**
     * 获取分片缓存统计
     */
    fun getFragmentCacheStats(): FragmentCacheStats {
        var totalFragments = 0
        var oldestAge = 0L
        val now = System.currentTimeMillis()

        fragmentCache.values.forEach { context ->
            totalFragments += context.fragments.size
            val age = now - context.createdAt
            if (age > oldestAge) {
                oldestAge = age
            }
        }

        return FragmentCacheStats(
            pendingMessages = fragmentCache.size,
            totalFragments = totalFragments,
            oldestAgeMs = oldestAge
        )
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
        stopFragmentCleanup()
        stopNackCheck()
        stopBatchAckProcessor()
        clearQueue()
        fragmentCache.clear()
        sentFragments.clear()
        messageSendTimes.clear()
        retransmissionManager.cancelAll()
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
    val data: String,

    /** 发送方设备ID（用于重组时恢复） */
    val fromDeviceId: String = "",

    /** 接收方设备ID（用于重组时恢复） */
    val toDeviceId: String = ""
)

/**
 * 分片组装上下文
 *
 * 用于跟踪消息分片的接收状态，支持超时清理和重复检测
 */
data class FragmentAssemblyContext(
    /** 消息 ID */
    val messageId: String,

    /** 总分片数 */
    val totalFragments: Int,

    /** 创建时间 */
    val createdAt: Long,

    /** 最后更新时间 */
    var lastUpdatedAt: Long = createdAt,

    /** 已接收的分片 */
    val fragments: MutableList<MessageFragment> = mutableListOf(),

    /** 已接收的分片索引（用于重复检测） */
    val receivedIndices: MutableSet<Int> = mutableSetOf(),

    /** 是否已发送 NACK */
    var nackSent: Boolean = false,

    /** NACK 发送时间 */
    var nackSentAt: Long = 0
)

/**
 * 分片缓存统计
 */
data class FragmentCacheStats(
    /** 待完成的消息数 */
    val pendingMessages: Int,

    /** 总分片数 */
    val totalFragments: Int,

    /** 最老的分片组年龄（毫秒） */
    val oldestAgeMs: Long
)

/**
 * 已发送的分片上下文（用于重传）
 */
data class SentFragmentContext(
    /** 消息 ID */
    val messageId: String,

    /** 总分片数 */
    val totalFragments: Int,

    /** 发送时间 */
    val sentAt: Long,

    /** 已发送的分片 */
    val fragments: MutableMap<Int, MessageFragment> = mutableMapOf(),

    /** 重传计数 */
    var retransmitCount: Int = 0
)

/**
 * 分片 NACK 负载
 */
@kotlinx.serialization.Serializable
data class FragmentNackPayload(
    /** 消息 ID */
    val messageId: String,

    /** 缺失的分片索引列表 */
    val missingIndices: List<Int>
)

/**
 * 重传管理器
 *
 * 管理消息的自动重传，支持指数退避
 */
class RetransmissionManager {
    private val pendingRetransmissions = ConcurrentHashMap<String, RetransmissionTask>()

    /**
     * 计划重传
     */
    fun scheduleRetransmission(
        messageId: String,
        message: P2PMessage,
        attempt: Int,
        sendFunction: suspend (P2PMessage) -> Boolean
    ): Job? {
        if (attempt > 3) {
            pendingRetransmissions.remove(messageId)
            return null
        }

        val delay = calculateBackoffDelay(attempt)
        val task = RetransmissionTask(
            messageId = messageId,
            message = message,
            attempt = attempt,
            scheduledAt = System.currentTimeMillis(),
            delayMs = delay
        )

        pendingRetransmissions[messageId] = task
        return null // Job will be created by caller
    }

    /**
     * 取消重传
     */
    fun cancelRetransmission(messageId: String) {
        pendingRetransmissions.remove(messageId)?.job?.cancel()
    }

    /**
     * 取消所有重传
     */
    fun cancelAll() {
        pendingRetransmissions.values.forEach { it.job?.cancel() }
        pendingRetransmissions.clear()
    }

    /**
     * 计算退避延迟
     */
    private fun calculateBackoffDelay(attempt: Int): Long {
        val baseDelay = 1000L
        val maxDelay = 15000L
        val delay = baseDelay * (1L shl (attempt - 1).coerceAtMost(4))
        return delay.coerceAtMost(maxDelay)
    }

    /**
     * 获取待重传数量
     */
    fun getPendingCount(): Int = pendingRetransmissions.size
}

/**
 * 重传任务
 */
data class RetransmissionTask(
    val messageId: String,
    val message: P2PMessage,
    val attempt: Int,
    val scheduledAt: Long,
    val delayMs: Long,
    var job: Job? = null
)
