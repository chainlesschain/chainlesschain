package com.chainlesschain.android.core.p2p.filetransfer

import timber.log.Timber
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.filetransfer.model.FileChunk
import com.chainlesschain.android.core.p2p.filetransfer.model.FileChunkAck
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferStatus
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件传输事件
 */
sealed class FileTransferEvent {
    /** 收到传输请求 */
    data class TransferRequested(
        val metadata: FileTransferMetadata,
        val fromDeviceId: String
    ) : FileTransferEvent()

    /** 传输请求被接受 */
    data class TransferAccepted(val transferId: String, val byDeviceId: String) : FileTransferEvent()

    /** 传输请求被拒绝 */
    data class TransferRejected(val transferId: String, val byDeviceId: String, val reason: String?) : FileTransferEvent()

    /** 收到文件分块 */
    data class ChunkReceived(val chunk: FileChunk, val fromDeviceId: String) : FileTransferEvent()

    /** 收到分块确认 */
    data class ChunkAcknowledged(val ack: FileChunkAck) : FileTransferEvent()

    /** 传输已暂停 */
    data class TransferPaused(val transferId: String, val byDeviceId: String) : FileTransferEvent()

    /** 传输已恢复 */
    data class TransferResumed(val transferId: String, val byDeviceId: String, val fromChunk: Int) : FileTransferEvent()

    /** 传输已取消 */
    data class TransferCancelled(val transferId: String, val byDeviceId: String, val reason: String?) : FileTransferEvent()

    /** 传输完成 */
    data class TransferCompleted(val transferId: String, val byDeviceId: String) : FileTransferEvent()
}

/**
 * 控制消息载荷
 */
@kotlinx.serialization.Serializable
private data class ControlPayload(
    val transferId: String,
    val action: String? = null,
    val reason: String? = null,
    val fromChunk: Int? = null
)

/**
 * 文件传输传输层
 *
 * Handles P2P message sending/receiving for file transfers.
 * Supports sliding window for concurrent chunk transfers.
 */
@Singleton
class FileTransferTransport @Inject constructor(
    private val connectionManager: P2PConnectionManager
) {
    companion object {
        /** Maximum concurrent chunks in flight (sliding window) */
        const val MAX_CHUNKS_IN_FLIGHT = 4

        /** ACK timeout in milliseconds */
        const val ACK_TIMEOUT_MS = 30_000L

        /** Maximum retry attempts per chunk */
        const val MAX_CHUNK_RETRIES = 3

        /** Bandwidth limit in bytes per second (0 = unlimited) */
        const val DEFAULT_BANDWIDTH_LIMIT = 0L
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    // File transfer events
    private val _events = MutableSharedFlow<FileTransferEvent>(replay = 0, extraBufferCapacity = 64)
    val events: SharedFlow<FileTransferEvent> = _events.asSharedFlow()

    // Pending ACKs for sent chunks (transferId -> (chunkIndex -> sentTime))
    private val pendingAcks = ConcurrentHashMap<String, ConcurrentHashMap<Int, Long>>()

    // Current bandwidth limit
    private var bandwidthLimit = DEFAULT_BANDWIDTH_LIMIT

    // Last send time for bandwidth limiting
    private var lastSendTime = 0L
    private var bytesSentThisSecond = 0L
    private var currentSecondStart = 0L

    init {
        // Listen for incoming P2P messages related to file transfers
        scope.launch {
            connectionManager.receivedMessages
                .filter { isFileTransferMessage(it.type) }
                .collect { message ->
                    handleIncomingMessage(message)
                }
        }
    }

    /**
     * Check if a message type is file transfer related
     */
    private fun isFileTransferMessage(type: MessageType): Boolean {
        return type in listOf(
            MessageType.FILE_TRANSFER_REQUEST,
            MessageType.FILE_TRANSFER_ACCEPT,
            MessageType.FILE_TRANSFER_REJECT,
            MessageType.FILE_TRANSFER_CHUNK,
            MessageType.FILE_TRANSFER_ACK,
            MessageType.FILE_TRANSFER_PAUSE,
            MessageType.FILE_TRANSFER_RESUME,
            MessageType.FILE_TRANSFER_CANCEL,
            MessageType.FILE_TRANSFER_COMPLETE
        )
    }

    /**
     * Handle incoming file transfer messages
     */
    private suspend fun handleIncomingMessage(message: P2PMessage) {
        try {
            when (message.type) {
                MessageType.FILE_TRANSFER_REQUEST -> {
                    val metadata = json.decodeFromString<FileTransferMetadata>(message.payload)
                    _events.emit(FileTransferEvent.TransferRequested(metadata, message.fromDeviceId))
                }
                MessageType.FILE_TRANSFER_ACCEPT -> {
                    val payload = json.decodeFromString<ControlPayload>(message.payload)
                    _events.emit(FileTransferEvent.TransferAccepted(payload.transferId, message.fromDeviceId))
                }
                MessageType.FILE_TRANSFER_REJECT -> {
                    val payload = json.decodeFromString<ControlPayload>(message.payload)
                    _events.emit(FileTransferEvent.TransferRejected(
                        payload.transferId,
                        message.fromDeviceId,
                        payload.reason
                    ))
                }
                MessageType.FILE_TRANSFER_CHUNK -> {
                    val chunk = json.decodeFromString<FileChunk>(message.payload)
                    _events.emit(FileTransferEvent.ChunkReceived(chunk, message.fromDeviceId))
                }
                MessageType.FILE_TRANSFER_ACK -> {
                    val ack = json.decodeFromString<FileChunkAck>(message.payload)
                    handleChunkAck(ack)
                    _events.emit(FileTransferEvent.ChunkAcknowledged(ack))
                }
                MessageType.FILE_TRANSFER_PAUSE -> {
                    val payload = json.decodeFromString<ControlPayload>(message.payload)
                    _events.emit(FileTransferEvent.TransferPaused(payload.transferId, message.fromDeviceId))
                }
                MessageType.FILE_TRANSFER_RESUME -> {
                    val payload = json.decodeFromString<ControlPayload>(message.payload)
                    _events.emit(FileTransferEvent.TransferResumed(
                        payload.transferId,
                        message.fromDeviceId,
                        payload.fromChunk ?: 0
                    ))
                }
                MessageType.FILE_TRANSFER_CANCEL -> {
                    val payload = json.decodeFromString<ControlPayload>(message.payload)
                    _events.emit(FileTransferEvent.TransferCancelled(
                        payload.transferId,
                        message.fromDeviceId,
                        payload.reason
                    ))
                }
                MessageType.FILE_TRANSFER_COMPLETE -> {
                    val payload = json.decodeFromString<ControlPayload>(message.payload)
                    _events.emit(FileTransferEvent.TransferCompleted(payload.transferId, message.fromDeviceId))
                }
                else -> {}
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle file transfer message: ${message.type}")
        }
    }

    /**
     * Send a file transfer request to a peer
     *
     * @param metadata Transfer metadata
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @return true if sent successfully
     */
    suspend fun sendTransferRequest(
        metadata: FileTransferMetadata,
        toDeviceId: String,
        fromDeviceId: String
    ): Boolean {
        return sendMessage(
            type = MessageType.FILE_TRANSFER_REQUEST,
            payload = json.encodeToString(metadata),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Accept a file transfer request
     *
     * @param transferId Transfer ID to accept
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @return true if sent successfully
     */
    suspend fun sendAccept(
        transferId: String,
        toDeviceId: String,
        fromDeviceId: String
    ): Boolean {
        return sendMessage(
            type = MessageType.FILE_TRANSFER_ACCEPT,
            payload = json.encodeToString(ControlPayload(transferId = transferId)),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Reject a file transfer request
     *
     * @param transferId Transfer ID to reject
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @param reason Rejection reason
     * @return true if sent successfully
     */
    suspend fun sendReject(
        transferId: String,
        toDeviceId: String,
        fromDeviceId: String,
        reason: String? = null
    ): Boolean {
        return sendMessage(
            type = MessageType.FILE_TRANSFER_REJECT,
            payload = json.encodeToString(ControlPayload(transferId = transferId, reason = reason)),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Send a file chunk
     *
     * @param chunk Chunk to send
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @return true if sent successfully
     */
    suspend fun sendChunk(
        chunk: FileChunk,
        toDeviceId: String,
        fromDeviceId: String
    ): Boolean {
        // Apply bandwidth limiting if enabled
        applyBandwidthLimit(chunk.chunkSize)

        // Track pending ACK
        pendingAcks.getOrPut(chunk.transferId) { ConcurrentHashMap() }[chunk.chunkIndex] = System.currentTimeMillis()

        return sendMessage(
            type = MessageType.FILE_TRANSFER_CHUNK,
            payload = json.encodeToString(chunk),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Send a chunk acknowledgment
     *
     * @param ack Acknowledgment to send
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @return true if sent successfully
     */
    suspend fun sendChunkAck(
        ack: FileChunkAck,
        toDeviceId: String,
        fromDeviceId: String
    ): Boolean {
        return sendMessage(
            type = MessageType.FILE_TRANSFER_ACK,
            payload = json.encodeToString(ack),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Send a pause request
     *
     * @param transferId Transfer ID to pause
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @return true if sent successfully
     */
    suspend fun sendPause(
        transferId: String,
        toDeviceId: String,
        fromDeviceId: String
    ): Boolean {
        return sendMessage(
            type = MessageType.FILE_TRANSFER_PAUSE,
            payload = json.encodeToString(ControlPayload(transferId = transferId)),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Send a resume request
     *
     * @param transferId Transfer ID to resume
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @param fromChunk Chunk index to resume from
     * @return true if sent successfully
     */
    suspend fun sendResume(
        transferId: String,
        toDeviceId: String,
        fromDeviceId: String,
        fromChunk: Int
    ): Boolean {
        return sendMessage(
            type = MessageType.FILE_TRANSFER_RESUME,
            payload = json.encodeToString(ControlPayload(transferId = transferId, fromChunk = fromChunk)),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Send a cancel request
     *
     * @param transferId Transfer ID to cancel
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @param reason Cancellation reason
     * @return true if sent successfully
     */
    suspend fun sendCancel(
        transferId: String,
        toDeviceId: String,
        fromDeviceId: String,
        reason: String? = null
    ): Boolean {
        // Clear pending ACKs
        pendingAcks.remove(transferId)

        return sendMessage(
            type = MessageType.FILE_TRANSFER_CANCEL,
            payload = json.encodeToString(ControlPayload(transferId = transferId, reason = reason)),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Send a transfer complete message
     *
     * @param transferId Transfer ID that completed
     * @param toDeviceId Target device ID
     * @param fromDeviceId Local device ID
     * @return true if sent successfully
     */
    suspend fun sendComplete(
        transferId: String,
        toDeviceId: String,
        fromDeviceId: String
    ): Boolean {
        // Clear pending ACKs
        pendingAcks.remove(transferId)

        return sendMessage(
            type = MessageType.FILE_TRANSFER_COMPLETE,
            payload = json.encodeToString(ControlPayload(transferId = transferId)),
            toDeviceId = toDeviceId,
            fromDeviceId = fromDeviceId
        )
    }

    /**
     * Wait for an ACK for a specific chunk with timeout
     *
     * @param transferId Transfer ID
     * @param chunkIndex Chunk index to wait for
     * @param timeoutMs Timeout in milliseconds
     * @return FileChunkAck or null if timeout
     */
    suspend fun waitForAck(
        transferId: String,
        chunkIndex: Int,
        timeoutMs: Long = ACK_TIMEOUT_MS
    ): FileChunkAck? {
        return try {
            withTimeout(timeoutMs) {
                events
                    .filter { it is FileTransferEvent.ChunkAcknowledged }
                    .filter { (it as FileTransferEvent.ChunkAcknowledged).ack.transferId == transferId }
                    .filter { (it as FileTransferEvent.ChunkAcknowledged).ack.chunkIndex == chunkIndex }
                    .first()
                    .let { (it as FileTransferEvent.ChunkAcknowledged).ack }
            }
        } catch (e: Exception) {
            Timber.w("ACK timeout for chunk $chunkIndex of transfer $transferId")
            null
        }
    }

    /**
     * Get the number of chunks in flight for a transfer
     */
    fun getChunksInFlight(transferId: String): Int {
        return pendingAcks[transferId]?.size ?: 0
    }

    /**
     * Check if we can send more chunks (sliding window check)
     */
    fun canSendMoreChunks(transferId: String): Boolean {
        return getChunksInFlight(transferId) < MAX_CHUNKS_IN_FLIGHT
    }

    /**
     * Get pending chunk indices for a transfer
     */
    fun getPendingChunkIndices(transferId: String): Set<Int> {
        return pendingAcks[transferId]?.keys?.toSet() ?: emptySet()
    }

    /**
     * Get timed out chunks for a transfer
     */
    fun getTimedOutChunks(transferId: String): List<Int> {
        val now = System.currentTimeMillis()
        return pendingAcks[transferId]?.entries
            ?.filter { now - it.value > ACK_TIMEOUT_MS }
            ?.map { it.key }
            ?: emptyList()
    }

    /**
     * Set bandwidth limit
     *
     * @param bytesPerSecond Bandwidth limit in bytes per second (0 = unlimited)
     */
    fun setBandwidthLimit(bytesPerSecond: Long) {
        bandwidthLimit = bytesPerSecond
    }

    /**
     * Clear state for a completed/cancelled transfer
     */
    fun clearTransferState(transferId: String) {
        pendingAcks.remove(transferId)
    }

    // Private helpers

    private fun handleChunkAck(ack: FileChunkAck) {
        pendingAcks[ack.transferId]?.remove(ack.chunkIndex)
    }

    private suspend fun sendMessage(
        type: MessageType,
        payload: String,
        toDeviceId: String,
        fromDeviceId: String
    ): Boolean {
        return try {
            val message = P2PMessage(
                id = UUID.randomUUID().toString(),
                fromDeviceId = fromDeviceId,
                toDeviceId = toDeviceId,
                type = type,
                payload = payload,
                requiresAck = type != MessageType.FILE_TRANSFER_ACK // Don't require ACK for ACK messages
            )

            connectionManager.sendMessage(toDeviceId, message)
            true
        } catch (e: Exception) {
            Timber.e(e, "Failed to send $type message")
            false
        }
    }

    /**
     * 应用带宽限制（使用令牌桶算法）
     *
     * Token Bucket Algorithm:
     * - 令牌以恒定速率补充（每秒 bandwidthLimit 个字节的令牌）
     * - 发送数据前需要获取足够的令牌
     * - 如果令牌不足，等待直到有足够令牌
     *
     * @param bytesToSend 要发送的字节数
     */
    private suspend fun applyBandwidthLimit(bytesToSend: Int) {
        if (bandwidthLimit <= 0) return

        val now = System.currentTimeMillis()
        val elapsedMs = now - currentSecondStart

        // 补充令牌：根据时间流逝补充令牌
        if (elapsedMs > 0) {
            // 计算应该补充的令牌数量
            val tokensToAdd = (bandwidthLimit * elapsedMs) / 1000
            // 更新可用字节（减去已发送的，加上补充的，但不超过限制）
            val available = minOf(bandwidthLimit, bandwidthLimit - bytesSentThisSecond + tokensToAdd)
            bytesSentThisSecond = bandwidthLimit - available
            currentSecondStart = now
        }

        // 检查是否有足够的令牌
        val availableTokens = bandwidthLimit - bytesSentThisSecond

        if (bytesToSend > availableTokens) {
            // 计算需要等待多长时间才能获得足够令牌
            val deficit = bytesToSend - availableTokens
            val waitTimeMs = (deficit * 1000) / bandwidthLimit

            if (waitTimeMs > 0) {
                Timber.d("Bandwidth throttling: waiting ${waitTimeMs}ms for ${deficit} bytes")
                delay(waitTimeMs)

                // 等待后重置计数器
                currentSecondStart = System.currentTimeMillis()
                bytesSentThisSecond = bytesToSend.toLong()
            }
        } else {
            // 有足够令牌，直接消费
            bytesSentThisSecond += bytesToSend
        }
    }

    /**
     * 检查是否可以发送指定大小的数据（不阻塞）
     *
     * @param bytesToSend 要发送的字节数
     * @return true 如果可以立即发送
     */
    fun canSendWithinBandwidth(bytesToSend: Int): Boolean {
        if (bandwidthLimit <= 0) return true

        val now = System.currentTimeMillis()
        val elapsedMs = now - currentSecondStart
        val tokensToAdd = if (elapsedMs > 0) (bandwidthLimit * elapsedMs) / 1000 else 0
        val available = minOf(bandwidthLimit, bandwidthLimit - bytesSentThisSecond + tokensToAdd)

        return bytesToSend <= available
    }
}
