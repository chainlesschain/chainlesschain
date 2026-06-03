package com.chainlesschain.android.core.p2p.filetransfer

import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferStatus
import com.chainlesschain.android.core.p2p.filetransfer.model.SpeedSample
import com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 传输进度跟踪器
 *
 * Tracks active file transfers and calculates real-time speed and ETA.
 * Uses a rolling window of samples for accurate speed calculation.
 */
@Singleton
class TransferProgressTracker @Inject constructor() {

    companion object {
        private const val TAG = "TransferProgressTracker"

        /** Number of samples to keep for rolling average */
        private const val SPEED_SAMPLE_WINDOW = 10

        /** Minimum interval between speed samples (ms) */
        private const val MIN_SAMPLE_INTERVAL_MS = 100L

        /** Progress emission interval (ms) */
        private const val PROGRESS_EMISSION_INTERVAL_MS = 250L
    }

    /**
     * Internal state for tracking a single transfer
     */
    private data class TransferState(
        val metadata: FileTransferMetadata,
        val isOutgoing: Boolean,
        var bytesTransferred: Long = 0,
        var completedChunks: Int = 0,
        var status: FileTransferStatus = FileTransferStatus.PENDING,
        var startTime: Long = System.currentTimeMillis(),
        var lastUpdateTime: Long = System.currentTimeMillis(),
        var lastEmissionTime: Long = 0,
        val speedSamples: MutableList<SpeedSample> = java.util.Collections.synchronizedList(mutableListOf())
    )

    // Active transfers state
    private val activeTransfers = ConcurrentHashMap<String, TransferState>()

    // Progress flow for all transfers
    private val _progressFlow = MutableSharedFlow<TransferProgress>(replay = 0, extraBufferCapacity = 64)
    val progressFlow: SharedFlow<TransferProgress> = _progressFlow.asSharedFlow()

    // All transfers progress as state (for UI)
    private val _allTransfersProgress = MutableStateFlow<Map<String, TransferProgress>>(emptyMap())
    val allTransfersProgress: StateFlow<Map<String, TransferProgress>> = _allTransfersProgress.asStateFlow()

    /**
     * Start tracking a new transfer
     *
     * @param metadata Transfer metadata
     * @param isOutgoing Whether this is an outgoing transfer
     */
    fun startTracking(metadata: FileTransferMetadata, isOutgoing: Boolean) {
        val state = TransferState(
            metadata = metadata,
            isOutgoing = isOutgoing,
            status = FileTransferStatus.REQUESTING
        )
        activeTransfers[metadata.transferId] = state
        emitProgress(metadata.transferId, forceEmit = true)
    }

    /**
     * Update transfer status
     *
     * @param transferId Transfer ID
     * @param status New status
     */
    fun updateStatus(transferId: String, status: FileTransferStatus) {
        activeTransfers[transferId]?.let { state ->
            state.status = status
            state.lastUpdateTime = System.currentTimeMillis()

            if (status == FileTransferStatus.TRANSFERRING) {
                state.startTime = System.currentTimeMillis()
            }

            emitProgress(transferId, forceEmit = true)

            // Remove from active tracking if terminal
            if (status.isTerminal()) {
                // Keep for a short time so UI can show final state
                // Will be removed later
            }
        }
    }

    /**
     * Update bytes transferred and completed chunks
     *
     * @param transferId Transfer ID
     * @param bytesTransferred Total bytes transferred so far
     * @param completedChunks Number of completed chunks
     */
    fun updateProgress(transferId: String, bytesTransferred: Long, completedChunks: Int) {
        activeTransfers[transferId]?.let { state ->
            val now = System.currentTimeMillis()

            // Only add speed sample if enough time has passed
            if (now - state.lastUpdateTime >= MIN_SAMPLE_INTERVAL_MS) {
                state.speedSamples.add(SpeedSample(bytesTransferred, now))

                // Keep only recent samples
                while (state.speedSamples.size > SPEED_SAMPLE_WINDOW) {
                    state.speedSamples.removeAt(0)
                }
            }

            state.bytesTransferred = bytesTransferred
            state.completedChunks = completedChunks
            state.lastUpdateTime = now

            // Only emit at intervals to avoid flooding
            if (now - state.lastEmissionTime >= PROGRESS_EMISSION_INTERVAL_MS) {
                emitProgress(transferId)
                state.lastEmissionTime = now
            }
        }
    }

    /**
     * Record a single chunk completion
     *
     * @param transferId Transfer ID
     * @param chunkIndex Completed chunk index
     * @param chunkSize Size of the chunk in bytes
     */
    fun recordChunkCompletion(transferId: String, chunkIndex: Int, chunkSize: Int) {
        activeTransfers[transferId]?.let { state ->
            val newBytesTransferred = state.bytesTransferred + chunkSize
            val newCompletedChunks = state.completedChunks + 1
            updateProgress(transferId, newBytesTransferred, newCompletedChunks)
        }
    }

    /**
     * Get current progress for a transfer
     *
     * @param transferId Transfer ID
     * @return Current progress or null if not tracking
     */
    fun getProgress(transferId: String): TransferProgress? {
        return activeTransfers[transferId]?.let { state ->
            buildProgress(state)
        }
    }

    /**
     * Get all active transfers
     *
     * @return Map of transfer IDs to progress
     */
    fun getAllActiveTransfers(): Map<String, TransferProgress> {
        return activeTransfers.mapValues { (_, state) -> buildProgress(state) }
    }

    /**
     * Stop tracking a transfer
     *
     * @param transferId Transfer ID to stop tracking
     */
    fun stopTracking(transferId: String) {
        activeTransfers.remove(transferId)
        updateAllTransfersState()
    }

    /**
     * Clear all completed transfers from tracking
     */
    fun clearCompletedTransfers() {
        val toRemove = activeTransfers.entries
            .filter { it.value.status.isTerminal() }
            .map { it.key }

        toRemove.forEach { activeTransfers.remove(it) }
        updateAllTransfersState()
    }

    /**
     * Check if a transfer is being tracked
     */
    fun isTracking(transferId: String): Boolean = activeTransfers.containsKey(transferId)

    /**
     * Get count of active (non-terminal) transfers
     */
    fun getActiveTransferCount(): Int {
        return activeTransfers.values.count { !it.status.isTerminal() }
    }

    // Private helper functions

    private fun emitProgress(transferId: String, forceEmit: Boolean = false) {
        activeTransfers[transferId]?.let { state ->
            val progress = buildProgress(state)
            _progressFlow.tryEmit(progress)
            updateAllTransfersState()
        }
    }

    private fun updateAllTransfersState() {
        _allTransfersProgress.value = activeTransfers.mapValues { (_, state) ->
            buildProgress(state)
        }
    }

    private fun buildProgress(state: TransferState): TransferProgress {
        val speed = calculateSpeed(state)
        val eta = calculateEta(state, speed)

        return TransferProgress(
            transferId = state.metadata.transferId,
            bytesTransferred = state.bytesTransferred,
            totalBytes = state.metadata.fileSize,
            completedChunks = state.completedChunks,
            totalChunks = state.metadata.totalChunks,
            speedBytesPerSecond = speed,
            etaSeconds = eta,
            status = state.status,
            lastUpdateTime = state.lastUpdateTime,
            isOutgoing = state.isOutgoing,
            peerId = if (state.isOutgoing) state.metadata.receiverDeviceId else state.metadata.senderDeviceId,
            fileName = state.metadata.fileName
        )
    }

    /**
     * Calculate current transfer speed using rolling window average
     */
    private fun calculateSpeed(state: TransferState): Long {
        if (state.speedSamples.size < 2) return 0L
        if (state.status != FileTransferStatus.TRANSFERRING) return 0L

        val samples = state.speedSamples.toList()
        val firstSample = samples.first()
        val lastSample = samples.last()

        val timeDiffMs = lastSample.timestamp - firstSample.timestamp
        if (timeDiffMs <= 0) return 0L

        val bytesDiff = lastSample.bytesTransferred - firstSample.bytesTransferred
        if (bytesDiff <= 0) return 0L

        // Convert to bytes per second
        return (bytesDiff * 1000L) / timeDiffMs
    }

    /**
     * Calculate estimated time remaining
     */
    private fun calculateEta(state: TransferState, speedBytesPerSecond: Long): Long {
        if (speedBytesPerSecond <= 0) return -1L
        if (state.status != FileTransferStatus.TRANSFERRING) return -1L

        val remainingBytes = state.metadata.fileSize - state.bytesTransferred
        if (remainingBytes <= 0) return 0L

        return remainingBytes / speedBytesPerSecond
    }
}
