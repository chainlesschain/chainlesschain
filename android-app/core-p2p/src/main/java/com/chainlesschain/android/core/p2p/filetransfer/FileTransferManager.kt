package com.chainlesschain.android.core.p2p.filetransfer

import android.content.Context
import android.net.Uri
import android.os.Environment
import timber.log.Timber
import com.chainlesschain.android.core.p2p.filetransfer.model.FileChunk
import com.chainlesschain.android.core.p2p.filetransfer.model.FileChunkAck
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferStatus
import com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 传输状态
 */
sealed class TransferState {
    /** 出站传输 */
    data class Outgoing(
        val metadata: FileTransferMetadata,
        val fileUri: Uri,
        var status: FileTransferStatus = FileTransferStatus.PENDING,
        var currentChunk: Int = 0,
        /** 每个分块的重试次数 (chunkIndex -> retryCount) */
        val chunkRetryCount: MutableMap<Int, Int> = mutableMapOf(),
        var job: Job? = null
    ) : TransferState() {
        /**
         * 获取分块的重试次数
         */
        fun getRetryCount(chunkIndex: Int): Int = chunkRetryCount[chunkIndex] ?: 0

        /**
         * 增加分块重试次数并返回新值
         */
        fun incrementRetryCount(chunkIndex: Int): Int {
            val newCount = (chunkRetryCount[chunkIndex] ?: 0) + 1
            chunkRetryCount[chunkIndex] = newCount
            return newCount
        }

        /**
         * 重置分块重试次数（ACK成功后调用）
         */
        fun resetRetryCount(chunkIndex: Int) {
            chunkRetryCount.remove(chunkIndex)
        }

        /**
         * 获取总重试次数（用于统计）
         */
        fun getTotalRetryCount(): Int = chunkRetryCount.values.sum()
    }

    /** 入站传输 */
    data class Incoming(
        val metadata: FileTransferMetadata,
        val tempFile: File,
        var status: FileTransferStatus = FileTransferStatus.PENDING,
        var receivedChunks: MutableSet<Int> = mutableSetOf(),
        var expectedChunk: Int = 0,
        /** 分块接收失败次数 (chunkIndex -> failCount) */
        val chunkFailCount: MutableMap<Int, Int> = mutableMapOf()
    ) : TransferState() {
        /**
         * 记录分块接收失败
         */
        fun recordChunkFailure(chunkIndex: Int): Int {
            val newCount = (chunkFailCount[chunkIndex] ?: 0) + 1
            chunkFailCount[chunkIndex] = newCount
            return newCount
        }
    }
}

/**
 * 传输完成结果
 */
data class TransferResult(
    val transferId: String,
    val success: Boolean,
    val localFilePath: String? = null,
    val errorMessage: String? = null
)

/**
 * 判断一个传输是否「卡死」（应被清理以释放并发槽）。纯函数，便于单测。
 *
 * - REQUESTING：出站等待对端 accept / 入站等待本机用户 accept，超 [requestTimeoutMs] 无动作即视为卡死。
 * - TRANSFERRING：超 [stuckTimeoutMs] 没有任何分块进展即视为卡死。
 * - PAUSED / PENDING / 终态：不自动清理（用户暂停的不能被偷偷删；终态本就走 [com.chainlesschain.android.
 *   core.p2p.filetransfer.FileTransferManager.cleanupCompletedTransfers] 回收）。
 *
 * @param lastActivityAt 该传输最后一次有进展（请求创建 / accept / 分块收发）的时间戳
 */
internal fun isTransferStuck(
    status: FileTransferStatus,
    lastActivityAt: Long,
    now: Long,
    requestTimeoutMs: Long = FileTransferManager.REQUEST_TIMEOUT_MS,
    stuckTimeoutMs: Long = FileTransferManager.STUCK_TRANSFER_TIMEOUT_MS,
): Boolean {
    val limit = when (status) {
        FileTransferStatus.REQUESTING -> requestTimeoutMs
        FileTransferStatus.TRANSFERRING -> stuckTimeoutMs
        else -> return false
    }
    return now - lastActivityAt > limit
}

/**
 * 文件传输管理器
 *
 * Main orchestrator for P2P file transfers.
 * Manages active transfers, handles chunk sending/receiving, and coordinates with transport layer.
 */
@Singleton
class FileTransferManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val fileChunker: FileChunker,
    private val transport: FileTransferTransport,
    private val progressTracker: TransferProgressTracker,
    private val checkpointManager: CheckpointManager
) {
    companion object {
        /** Maximum concurrent transfers */
        const val MAX_CONCURRENT_TRANSFERS = 3

        /** Maximum retry attempts */
        const val MAX_RETRIES = 3

        /** Delay between chunk retries (ms) */
        const val RETRY_DELAY_MS = 1000L

        /** REQUESTING 状态无动作多久算卡死（出站无 accept / 入站无人受理）。 */
        const val REQUEST_TIMEOUT_MS = 120_000L // 2 min

        /** TRANSFERRING 状态多久没有分块进展算卡死。 */
        const val STUCK_TRANSFER_TIMEOUT_MS = 120_000L // 2 min

        /** 卡死扫描周期。 */
        const val STUCK_SWEEP_INTERVAL_MS = 30_000L // 30 s
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Active transfers (transferId -> TransferState)
    private val activeTransfers = ConcurrentHashMap<String, TransferState>()

    // 每个传输最后一次有进展的时间戳（transferId -> epochMs），用于卡死检测。
    private val lastActivity = ConcurrentHashMap<String, Long>()

    // Local device ID (must be set before using)
    private var localDeviceId: String? = null

    // Transfer completion events
    private val _transferResults = MutableSharedFlow<TransferResult>(replay = 0, extraBufferCapacity = 16)
    val transferResults: SharedFlow<TransferResult> = _transferResults.asSharedFlow()

    // Pending transfer requests (for UI to show accept/reject)
    private val _pendingRequests = MutableStateFlow<List<FileTransferMetadata>>(emptyList())
    val pendingRequests: StateFlow<List<FileTransferMetadata>> = _pendingRequests.asStateFlow()

    // Download directory (use app-specific external storage, compatible with SDK 35)
    private val downloadDir: File by lazy {
        File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "ChainlessChain")
            .also { it.mkdirs() }
    }

    init {
        // Listen for transport events
        scope.launch {
            transport.events.collect { event ->
                handleTransportEvent(event)
            }
        }
        // 周期性清理卡死传输，释放并发槽（否则失败/无进展的传输会一直占满 MAX_CONCURRENT_TRANSFERS）
        startStuckSweeper()
    }

    /** 记录某传输刚有进展（请求创建 / accept / 分块收发），刷新卡死计时。 */
    private fun touch(transferId: String) {
        lastActivity[transferId] = System.currentTimeMillis()
    }

    private fun TransferState.currentStatus(): FileTransferStatus = when (this) {
        is TransferState.Outgoing -> status
        is TransferState.Incoming -> status
    }

    private fun startStuckSweeper() {
        scope.launch {
            while (isActive) {
                delay(STUCK_SWEEP_INTERVAL_MS)
                runCatching { sweepStuckTransfers() }
                    .onFailure { Timber.w(it, "stuck transfer sweep failed") }
            }
        }
    }

    /**
     * 扫描并清理卡死传输。可单测（通过预置 [lastActivity] / activeTransfers 后直接调用）。
     */
    internal suspend fun sweepStuckTransfers() {
        val now = System.currentTimeMillis()
        val stuck = activeTransfers.entries.mapNotNull { (id, state) ->
            val last = lastActivity[id] ?: now
            if (isTransferStuck(state.currentStatus(), last, now)) id else null
        }
        stuck.forEach { id ->
            Timber.w("Stuck transfer timed out (no progress), cleaning up: $id")
            cleanupTransfer(id, "Transfer timed out (no progress)")
        }
    }

    /**
     * Initialize with local device ID
     */
    fun initialize(deviceId: String) {
        localDeviceId = deviceId
        Timber.i("FileTransferManager initialized with device: $deviceId")
    }

    /**
     * Start sending a file to a peer
     *
     * @param fileUri URI of the file to send
     * @param toDeviceId Target device ID
     * @return TransferMetadata or null if failed to start
     */
    suspend fun sendFile(fileUri: Uri, toDeviceId: String): FileTransferMetadata? {
        val localId = localDeviceId ?: run {
            Timber.e("Local device ID not set")
            return null
        }

        // Check concurrent transfer limit
        if (getActiveTransferCount() >= MAX_CONCURRENT_TRANSFERS) {
            Timber.w("Maximum concurrent transfers reached")
            return null
        }

        try {
            // Create transfer metadata
            val metadata = fileChunker.createTransferMetadata(
                uri = fileUri,
                senderDeviceId = localId,
                receiverDeviceId = toDeviceId
            )

            // Create transfer state
            val state = TransferState.Outgoing(
                metadata = metadata,
                fileUri = fileUri,
                status = FileTransferStatus.REQUESTING
            )
            activeTransfers[metadata.transferId] = state
            touch(metadata.transferId)

            // Start progress tracking
            progressTracker.startTracking(metadata, isOutgoing = true)
            progressTracker.updateStatus(metadata.transferId, FileTransferStatus.REQUESTING)

            // Create checkpoint for resume support
            checkpointManager.createCheckpoint(
                metadata = metadata,
                isOutgoing = true,
                sourceFileUri = fileUri.toString()
            )

            // Send request to peer
            val sent = transport.sendTransferRequest(metadata, toDeviceId, localId)
            if (!sent) {
                cleanupTransfer(metadata.transferId, "Failed to send transfer request")
                return null
            }

            Timber.i("Transfer request sent: ${metadata.fileName} (${metadata.getReadableFileSize()})")
            return metadata
        } catch (e: Exception) {
            Timber.e(e, "Failed to start file transfer")
            return null
        }
    }

    /**
     * Accept an incoming transfer request
     *
     * @param transferId Transfer ID to accept
     */
    suspend fun acceptTransfer(transferId: String) {
        val state = activeTransfers[transferId] as? TransferState.Incoming ?: run {
            Timber.w("Transfer not found or not incoming: $transferId")
            return
        }

        val localId = localDeviceId ?: return

        // Update status
        state.status = FileTransferStatus.TRANSFERRING
        touch(transferId)
        progressTracker.updateStatus(transferId, FileTransferStatus.TRANSFERRING)

        // Send accept message
        transport.sendAccept(
            transferId = transferId,
            toDeviceId = state.metadata.senderDeviceId,
            fromDeviceId = localId
        )

        // Remove from pending requests
        updatePendingRequests()

        Timber.i("Transfer accepted: ${state.metadata.fileName}")
    }

    /**
     * Reject an incoming transfer request
     *
     * @param transferId Transfer ID to reject
     * @param reason Rejection reason
     */
    suspend fun rejectTransfer(transferId: String, reason: String? = null) {
        val state = activeTransfers[transferId] as? TransferState.Incoming ?: run {
            Timber.w("Transfer not found or not incoming: $transferId")
            return
        }

        val localId = localDeviceId ?: return

        // Send reject message
        transport.sendReject(
            transferId = transferId,
            toDeviceId = state.metadata.senderDeviceId,
            fromDeviceId = localId,
            reason = reason
        )

        // Clean up
        cleanupTransfer(transferId, "Rejected by user")
    }

    /**
     * Pause an active transfer
     *
     * @param transferId Transfer ID to pause
     */
    suspend fun pauseTransfer(transferId: String) {
        val state = activeTransfers[transferId] ?: return
        val localId = localDeviceId ?: return

        when (state) {
            is TransferState.Outgoing -> {
                state.job?.cancel()
                state.status = FileTransferStatus.PAUSED

                transport.sendPause(
                    transferId = transferId,
                    toDeviceId = state.metadata.receiverDeviceId,
                    fromDeviceId = localId
                )
            }
            is TransferState.Incoming -> {
                state.status = FileTransferStatus.PAUSED

                transport.sendPause(
                    transferId = transferId,
                    toDeviceId = state.metadata.senderDeviceId,
                    fromDeviceId = localId
                )
            }
        }

        progressTracker.updateStatus(transferId, FileTransferStatus.PAUSED)
        Timber.i("Transfer paused: $transferId")
    }

    /**
     * Resume a paused transfer
     *
     * @param transferId Transfer ID to resume
     */
    suspend fun resumeTransfer(transferId: String) {
        val state = activeTransfers[transferId] ?: return
        val localId = localDeviceId ?: return
        touch(transferId)

        when (state) {
            is TransferState.Outgoing -> {
                state.status = FileTransferStatus.TRANSFERRING
                progressTracker.updateStatus(transferId, FileTransferStatus.TRANSFERRING)

                transport.sendResume(
                    transferId = transferId,
                    toDeviceId = state.metadata.receiverDeviceId,
                    fromDeviceId = localId,
                    fromChunk = state.currentChunk
                )

                // Restart sending
                startSendingChunks(state)
            }
            is TransferState.Incoming -> {
                state.status = FileTransferStatus.TRANSFERRING
                progressTracker.updateStatus(transferId, FileTransferStatus.TRANSFERRING)

                transport.sendResume(
                    transferId = transferId,
                    toDeviceId = state.metadata.senderDeviceId,
                    fromDeviceId = localId,
                    fromChunk = state.expectedChunk
                )
            }
        }

        Timber.i("Transfer resumed: $transferId")
    }

    /**
     * Cancel a transfer
     *
     * @param transferId Transfer ID to cancel
     * @param reason Cancellation reason
     */
    suspend fun cancelTransfer(transferId: String, reason: String? = null) {
        val state = activeTransfers[transferId] ?: return
        val localId = localDeviceId ?: return

        val peerId = when (state) {
            is TransferState.Outgoing -> {
                state.job?.cancel()
                state.metadata.receiverDeviceId
            }
            is TransferState.Incoming -> state.metadata.senderDeviceId
        }

        transport.sendCancel(
            transferId = transferId,
            toDeviceId = peerId,
            fromDeviceId = localId,
            reason = reason
        )

        cleanupTransfer(transferId, reason ?: "Cancelled by user")
    }

    /**
     * Retry a failed transfer
     *
     * @param transferId Transfer ID to retry
     */
    suspend fun retryTransfer(transferId: String) {
        val state = activeTransfers[transferId]

        when (state) {
            is TransferState.Outgoing -> {
                if (state.status.canRetry()) {
                    state.chunkRetryCount.clear()
                    state.currentChunk = 0
                    state.status = FileTransferStatus.REQUESTING

                    progressTracker.updateStatus(transferId, FileTransferStatus.REQUESTING)

                    // Re-send request
                    transport.sendTransferRequest(
                        state.metadata,
                        state.metadata.receiverDeviceId,
                        localDeviceId ?: return
                    )
                }
            }
            is TransferState.Incoming -> {
                // For incoming, we can't retry - need sender to re-initiate
                Timber.w("Cannot retry incoming transfer")
            }
            null -> {
                Timber.w("Transfer not found: $transferId")
            }
        }
    }

    /**
     * Get progress for all active transfers
     */
    fun getAllProgress(): Map<String, TransferProgress> {
        return progressTracker.getAllActiveTransfers()
    }

    /**
     * Get progress for a specific transfer
     */
    fun getProgress(transferId: String): TransferProgress? {
        return progressTracker.getProgress(transferId)
    }

    /**
     * Get count of active (non-terminal) transfers
     */
    fun getActiveTransferCount(): Int {
        return activeTransfers.values.count { state ->
            val status = when (state) {
                is TransferState.Outgoing -> state.status
                is TransferState.Incoming -> state.status
            }
            !status.isTerminal()
        }
    }

    /**
     * Clean up old completed transfers
     */
    fun cleanupCompletedTransfers() {
        val toRemove = activeTransfers.entries
            .filter { (_, state) ->
                val status = when (state) {
                    is TransferState.Outgoing -> state.status
                    is TransferState.Incoming -> state.status
                }
                status.isTerminal()
            }
            .map { it.key }

        toRemove.forEach {
            activeTransfers.remove(it)
            lastActivity.remove(it)
        }
        progressTracker.clearCompletedTransfers()
    }

    // Private implementation

    private fun handleTransportEvent(event: FileTransferEvent) {
        scope.launch {
            when (event) {
                is FileTransferEvent.TransferRequested -> handleTransferRequest(event)
                is FileTransferEvent.TransferAccepted -> handleTransferAccepted(event)
                is FileTransferEvent.TransferRejected -> handleTransferRejected(event)
                is FileTransferEvent.ChunkReceived -> handleChunkReceived(event)
                is FileTransferEvent.ChunkAcknowledged -> handleChunkAck(event)
                is FileTransferEvent.TransferPaused -> handleTransferPaused(event)
                is FileTransferEvent.TransferResumed -> handleTransferResumed(event)
                is FileTransferEvent.TransferCancelled -> handleTransferCancelled(event)
                is FileTransferEvent.TransferCompleted -> handleTransferCompleted(event)
            }
        }
    }

    private suspend fun handleTransferRequest(event: FileTransferEvent.TransferRequested) {
        Timber.i("Received transfer request: ${event.metadata.fileName}")

        // Check concurrent transfer limit
        if (getActiveTransferCount() >= MAX_CONCURRENT_TRANSFERS) {
            Timber.w("Rejecting transfer - max concurrent transfers reached")
            transport.sendReject(
                event.metadata.transferId,
                event.fromDeviceId,
                localDeviceId ?: return,
                "Maximum concurrent transfers reached"
            )
            return
        }

        // Create temp file for receiving
        val tempFile = fileChunker.createTempFile(event.metadata.transferId, event.metadata.fileName)

        // Create incoming transfer state
        val state = TransferState.Incoming(
            metadata = event.metadata,
            tempFile = tempFile,
            status = FileTransferStatus.REQUESTING
        )
        activeTransfers[event.metadata.transferId] = state
        touch(event.metadata.transferId)

        // Start progress tracking
        progressTracker.startTracking(event.metadata, isOutgoing = false)

        // Create checkpoint for resume support
        checkpointManager.createCheckpoint(
            metadata = event.metadata,
            isOutgoing = false,
            tempFilePath = tempFile.absolutePath
        )

        // Add to pending requests for UI
        updatePendingRequests()
    }

    private suspend fun handleTransferAccepted(event: FileTransferEvent.TransferAccepted) {
        val state = activeTransfers[event.transferId] as? TransferState.Outgoing ?: return

        Timber.i("Transfer accepted: ${state.metadata.fileName}")

        state.status = FileTransferStatus.TRANSFERRING
        touch(event.transferId)
        progressTracker.updateStatus(event.transferId, FileTransferStatus.TRANSFERRING)

        // Start sending chunks
        startSendingChunks(state)
    }

    private suspend fun handleTransferRejected(event: FileTransferEvent.TransferRejected) {
        Timber.i("Transfer rejected: ${event.transferId} - ${event.reason}")
        cleanupTransfer(event.transferId, event.reason ?: "Rejected by peer")
    }

    private suspend fun handleChunkReceived(event: FileTransferEvent.ChunkReceived) {
        val state = activeTransfers[event.chunk.transferId] as? TransferState.Incoming ?: return
        val localId = localDeviceId ?: return

        // Write chunk to temp file
        val success = fileChunker.writeChunk(event.chunk, state.tempFile)

        // Send ACK
        val ack = FileChunkAck(
            transferId = event.chunk.transferId,
            chunkIndex = event.chunk.chunkIndex,
            success = success,
            errorMessage = if (!success) "Failed to write chunk" else null,
            nextExpectedChunk = event.chunk.chunkIndex + 1
        )
        transport.sendChunkAck(ack, event.fromDeviceId, localId)

        if (success) {
            touch(event.chunk.transferId)
            state.receivedChunks.add(event.chunk.chunkIndex)
            state.expectedChunk = event.chunk.chunkIndex + 1

            // Update progress
            val bytesTransferred = state.receivedChunks.size.toLong() * state.metadata.chunkSize
            progressTracker.updateProgress(
                event.chunk.transferId,
                bytesTransferred.coerceAtMost(state.metadata.fileSize),
                state.receivedChunks.size
            )

            // Update checkpoint periodically (every 10 chunks)
            if (state.receivedChunks.size % CheckpointManager.AUTO_SAVE_INTERVAL == 0) {
                scope.launch {
                    checkpointManager.updateCheckpoint(
                        transferId = event.chunk.transferId,
                        chunkIndex = event.chunk.chunkIndex,
                        chunkSize = event.chunk.chunkSize.toLong()
                    )
                }
            }

            // Check if transfer is complete
            if (state.receivedChunks.size == state.metadata.totalChunks) {
                finalizeIncomingTransfer(state)
            }
        } else {
            Timber.e("Failed to write chunk ${event.chunk.chunkIndex}")
        }
    }

    private fun handleChunkAck(event: FileTransferEvent.ChunkAcknowledged) {
        val state = activeTransfers[event.ack.transferId] as? TransferState.Outgoing ?: return

        if (event.ack.success) {
            touch(event.ack.transferId)
            // Update progress
            progressTracker.recordChunkCompletion(
                event.ack.transferId,
                event.ack.chunkIndex,
                state.metadata.chunkSize
            )

            // Update checkpoint periodically (every 10 chunks)
            if (event.ack.chunkIndex % CheckpointManager.AUTO_SAVE_INTERVAL == 0) {
                scope.launch {
                    checkpointManager.updateCheckpoint(
                        transferId = event.ack.transferId,
                        chunkIndex = event.ack.chunkIndex,
                        chunkSize = state.metadata.chunkSize.toLong()
                    )
                }
            }
        } else {
            Timber.w("Chunk ${event.ack.chunkIndex} failed: ${event.ack.errorMessage}")
            // Chunk will be retried by the sending loop
        }
    }

    private suspend fun handleTransferPaused(event: FileTransferEvent.TransferPaused) {
        val state = activeTransfers[event.transferId] ?: return

        when (state) {
            is TransferState.Outgoing -> {
                state.job?.cancel()
                state.status = FileTransferStatus.PAUSED
            }
            is TransferState.Incoming -> {
                state.status = FileTransferStatus.PAUSED
            }
        }

        progressTracker.updateStatus(event.transferId, FileTransferStatus.PAUSED)
        Timber.i("Transfer paused by peer: ${event.transferId}")
    }

    private suspend fun handleTransferResumed(event: FileTransferEvent.TransferResumed) {
        val state = activeTransfers[event.transferId] ?: return
        touch(event.transferId)

        when (state) {
            is TransferState.Outgoing -> {
                state.currentChunk = event.fromChunk
                state.status = FileTransferStatus.TRANSFERRING
                progressTracker.updateStatus(event.transferId, FileTransferStatus.TRANSFERRING)
                startSendingChunks(state)
            }
            is TransferState.Incoming -> {
                state.expectedChunk = event.fromChunk
                state.status = FileTransferStatus.TRANSFERRING
                progressTracker.updateStatus(event.transferId, FileTransferStatus.TRANSFERRING)
            }
        }

        Timber.i("Transfer resumed by peer: ${event.transferId}")
    }

    private suspend fun handleTransferCancelled(event: FileTransferEvent.TransferCancelled) {
        Timber.i("Transfer cancelled by peer: ${event.transferId} - ${event.reason}")
        cleanupTransfer(event.transferId, event.reason ?: "Cancelled by peer")
    }

    private suspend fun handleTransferCompleted(event: FileTransferEvent.TransferCompleted) {
        // This is sent by receiver to confirm completion
        val state = activeTransfers[event.transferId] as? TransferState.Outgoing ?: return

        state.status = FileTransferStatus.COMPLETED
        progressTracker.updateStatus(event.transferId, FileTransferStatus.COMPLETED)

        _transferResults.emit(TransferResult(
            transferId = event.transferId,
            success = true
        ))

        // Delete checkpoint on successful completion
        checkpointManager.deleteCheckpoint(event.transferId)

        Timber.i("Transfer completed: ${state.metadata.fileName}")
    }

    private fun startSendingChunks(state: TransferState.Outgoing) {
        val localId = localDeviceId ?: return

        state.job = scope.launch {
            try {
                while (state.currentChunk < state.metadata.totalChunks && state.status == FileTransferStatus.TRANSFERRING) {
                    // Wait if sliding window is full
                    while (!transport.canSendMoreChunks(state.metadata.transferId) &&
                        state.status == FileTransferStatus.TRANSFERRING) {
                        delay(50)

                        // Check for timed out chunks and retry with per-chunk retry count
                        val timedOut = transport.getTimedOutChunks(state.metadata.transferId)
                        for (chunkIndex in timedOut) {
                            val retryCount = state.incrementRetryCount(chunkIndex)
                            if (retryCount <= MAX_RETRIES) {
                                Timber.w("Retrying chunk $chunkIndex (attempt $retryCount/$MAX_RETRIES)")
                                retrySendChunk(state, chunkIndex, localId)
                            } else {
                                Timber.e("Chunk $chunkIndex exceeded max retries ($MAX_RETRIES)")
                                cleanupTransfer(
                                    state.metadata.transferId,
                                    "Chunk $chunkIndex failed after $MAX_RETRIES retries"
                                )
                                return@launch
                            }
                        }
                    }

                    if (state.status != FileTransferStatus.TRANSFERRING) break

                    // Read and send next chunk with compression support
                    val chunk = fileChunker.readChunk(
                        uri = state.fileUri,
                        chunkIndex = state.currentChunk,
                        chunkSize = state.metadata.chunkSize,
                        totalChunks = state.metadata.totalChunks,
                        transferId = state.metadata.transferId,
                        mimeType = state.metadata.mimeType,
                        enableCompression = state.metadata.compressionEnabled
                    )

                    val sent = transport.sendChunk(chunk, state.metadata.receiverDeviceId, localId)
                    if (sent) {
                        state.currentChunk++
                        // 成功发送后重置该分块的重试计数
                        state.resetRetryCount(state.currentChunk - 1)
                    } else {
                        // 发送失败，记录重试
                        val retryCount = state.incrementRetryCount(state.currentChunk)
                        if (retryCount > MAX_RETRIES) {
                            cleanupTransfer(
                                state.metadata.transferId,
                                "Failed to send chunk ${state.currentChunk} after $MAX_RETRIES attempts"
                            )
                            return@launch
                        }
                        Timber.w("Failed to send chunk ${state.currentChunk}, retrying (attempt $retryCount)")
                        delay(RETRY_DELAY_MS)
                    }
                }
            } catch (e: Exception) {
                if (state.status == FileTransferStatus.TRANSFERRING) {
                    Timber.e(e, "Error sending chunks")
                    cleanupTransfer(state.metadata.transferId, e.message ?: "Unknown error")
                }
            }
        }
    }

    private suspend fun retrySendChunk(state: TransferState.Outgoing, chunkIndex: Int, localId: String) {
        try {
            val chunk = fileChunker.readChunk(
                uri = state.fileUri,
                chunkIndex = chunkIndex,
                chunkSize = state.metadata.chunkSize,
                totalChunks = state.metadata.totalChunks,
                transferId = state.metadata.transferId
            )
            transport.sendChunk(chunk, state.metadata.receiverDeviceId, localId)
        } catch (e: Exception) {
            Timber.e(e, "Failed to retry chunk $chunkIndex")
        }
    }

    private suspend fun finalizeIncomingTransfer(state: TransferState.Incoming) {
        val localId = localDeviceId ?: return

        // Verify checksum
        val checksumValid = fileChunker.verifyFileChecksum(state.tempFile, state.metadata.checksum)

        if (!checksumValid) {
            Timber.e("Checksum verification failed for ${state.metadata.fileName}")
            cleanupTransfer(state.metadata.transferId, "Checksum verification failed")
            return
        }

        // Move to final location
        val finalFile = fileChunker.finalizeTempFile(
            state.tempFile,
            downloadDir,
            state.metadata.fileName
        )

        if (finalFile != null) {
            state.status = FileTransferStatus.COMPLETED
            progressTracker.updateStatus(state.metadata.transferId, FileTransferStatus.COMPLETED)

            // Send completion to sender
            transport.sendComplete(
                state.metadata.transferId,
                state.metadata.senderDeviceId,
                localId
            )

            _transferResults.emit(TransferResult(
                transferId = state.metadata.transferId,
                success = true,
                localFilePath = finalFile.absolutePath
            ))

            // Delete checkpoint on successful completion
            checkpointManager.deleteCheckpoint(state.metadata.transferId)

            Timber.i("Transfer completed and saved: ${finalFile.absolutePath}")
        } else {
            cleanupTransfer(state.metadata.transferId, "Failed to finalize file")
        }
    }

    private suspend fun cleanupTransfer(transferId: String, reason: String?) {
        val state = activeTransfers.remove(transferId)
        lastActivity.remove(transferId)

        val status = if (reason?.contains("cancel", ignoreCase = true) == true) {
            FileTransferStatus.CANCELLED
        } else {
            FileTransferStatus.FAILED
        }

        when (state) {
            is TransferState.Outgoing -> {
                state.job?.cancel()
                state.status = status
            }
            is TransferState.Incoming -> {
                state.status = status
                // Clean up temp file (except for paused transfers)
                if (status != FileTransferStatus.PAUSED) {
                    state.tempFile.delete()
                }
            }
            null -> {}
        }

        progressTracker.updateStatus(transferId, status)
        transport.clearTransferState(transferId)
        fileChunker.cleanupTempFiles(transferId)

        // Delete checkpoint only for terminal states (not paused)
        if (status.isTerminal()) {
            checkpointManager.deleteCheckpoint(transferId)
        }

        updatePendingRequests()

        _transferResults.emit(TransferResult(
            transferId = transferId,
            success = false,
            errorMessage = reason
        ))

        Timber.i("Transfer cleaned up: $transferId - $reason")
    }

    private fun updatePendingRequests() {
        _pendingRequests.value = activeTransfers.values
            .filterIsInstance<TransferState.Incoming>()
            .filter { it.status == FileTransferStatus.REQUESTING }
            .map { it.metadata }
    }

    /**
     * Shutdown the manager
     */
    fun shutdown() {
        scope.cancel()
        activeTransfers.values.forEach { state ->
            if (state is TransferState.Outgoing) {
                state.job?.cancel()
            }
        }
        activeTransfers.clear()
        lastActivity.clear()
    }
}
