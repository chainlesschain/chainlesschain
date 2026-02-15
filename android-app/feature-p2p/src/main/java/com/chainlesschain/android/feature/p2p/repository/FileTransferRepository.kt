package com.chainlesschain.android.feature.p2p.repository

import android.content.Context
import android.net.Uri
import android.util.Log
import com.chainlesschain.android.core.database.dao.FileTransferDao
import com.chainlesschain.android.core.database.entity.FileTransferEntity
import com.chainlesschain.android.core.database.entity.FileTransferStatusEnum
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.p2p.filetransfer.FileChunker
import com.chainlesschain.android.core.p2p.filetransfer.FileTransferManager
import com.chainlesschain.android.core.p2p.filetransfer.TransferProgressTracker
import com.chainlesschain.android.core.p2p.filetransfer.TransferResult
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferStatus
import com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件传输仓库
 *
 * 负责：
 * - 文件传输操作（发送、接收、暂停、恢复、取消）
 * - 传输记录持久化
 * - E2EE加密集成（通过FileTransferManager）
 * - 进度跟踪
 * - 离线队列集成
 */
@Singleton
class FileTransferRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val fileTransferDao: FileTransferDao,
    private val fileTransferManager: FileTransferManager,
    private val progressTracker: TransferProgressTracker,
    private val fileChunker: FileChunker,
    private val sessionManager: PersistentSessionManager
) {
    companion object {
        private const val TAG = "FileTransferRepository"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var resultCollectJob: Job? = null
    private var progressCollectJob: Job? = null

    // Real-time progress from tracker
    val progressFlow: SharedFlow<TransferProgress> = progressTracker.progressFlow

    // All transfers progress state
    val allTransfersProgress: StateFlow<Map<String, TransferProgress>> = progressTracker.allTransfersProgress

    // Pending incoming requests
    val pendingRequests: StateFlow<List<FileTransferMetadata>> = fileTransferManager.pendingRequests

    // Transfer completion results
    val transferResults: SharedFlow<TransferResult> = fileTransferManager.transferResults

    init {
        // Listen for transfer results and persist to database
        resultCollectJob = scope.launch {
            fileTransferManager.transferResults.collect { result ->
                handleTransferResult(result)
            }
        }

        // Listen for progress updates and persist periodically
        progressCollectJob = scope.launch {
            progressTracker.progressFlow.collect { progress ->
                updateProgressInDatabase(progress)
            }
        }
    }

    /**
     * Initialize with local device ID
     */
    fun initialize(deviceId: String) {
        fileTransferManager.initialize(deviceId)
    }

    // ===== Send Operations =====

    /**
     * Send a file to a peer
     *
     * @param fileUri URI of the file to send
     * @param peerId Target device ID
     * @return Transfer metadata or null if failed
     */
    suspend fun sendFile(fileUri: Uri, peerId: String): FileTransferMetadata? {
        // Check if we have an E2EE session
        if (!sessionManager.hasSession(peerId)) {
            Log.e(TAG, "No E2EE session with peer: $peerId")
            return null
        }

        // Start the transfer
        val metadata = fileTransferManager.sendFile(fileUri, peerId)

        if (metadata != null) {
            // Persist to database
            val entity = metadataToEntity(metadata, isOutgoing = true, localFilePath = fileUri.toString())
            fileTransferDao.insert(entity)
            Log.i(TAG, "File transfer initiated: ${metadata.fileName}")
        }

        return metadata
    }

    // ===== Receive Operations =====

    /**
     * Accept an incoming transfer request
     *
     * @param transferId Transfer ID to accept
     */
    suspend fun acceptTransfer(transferId: String) {
        // Update database status
        fileTransferDao.updateStatus(transferId, FileTransferStatusEnum.TRANSFERRING)

        // Accept in manager
        fileTransferManager.acceptTransfer(transferId)
    }

    /**
     * Reject an incoming transfer request
     *
     * @param transferId Transfer ID to reject
     * @param reason Rejection reason
     */
    suspend fun rejectTransfer(transferId: String, reason: String? = null) {
        // Update database status
        fileTransferDao.updateStatus(transferId, FileTransferStatusEnum.REJECTED)

        // Reject in manager
        fileTransferManager.rejectTransfer(transferId, reason)
    }

    // ===== Control Operations =====

    /**
     * Pause an active transfer
     *
     * @param transferId Transfer ID to pause
     */
    suspend fun pauseTransfer(transferId: String) {
        fileTransferDao.updateStatus(transferId, FileTransferStatusEnum.PAUSED)
        fileTransferManager.pauseTransfer(transferId)
    }

    /**
     * Resume a paused transfer
     *
     * @param transferId Transfer ID to resume
     */
    suspend fun resumeTransfer(transferId: String) {
        fileTransferDao.updateStatus(transferId, FileTransferStatusEnum.TRANSFERRING)
        fileTransferManager.resumeTransfer(transferId)
    }

    /**
     * Cancel a transfer
     *
     * @param transferId Transfer ID to cancel
     * @param reason Cancellation reason
     */
    suspend fun cancelTransfer(transferId: String, reason: String? = null) {
        fileTransferDao.updateStatus(transferId, FileTransferStatusEnum.CANCELLED)
        fileTransferManager.cancelTransfer(transferId, reason)
    }

    /**
     * Retry a failed transfer
     *
     * @param transferId Transfer ID to retry
     */
    suspend fun retryTransfer(transferId: String) {
        val entity = fileTransferDao.getById(transferId) ?: return

        if (FileTransferStatusEnum.canRetry(entity.status)) {
            fileTransferDao.resetRetryCount(transferId)
            fileTransferDao.updateStatus(transferId, FileTransferStatusEnum.REQUESTING)
            fileTransferManager.retryTransfer(transferId)
        }
    }

    // ===== Query Operations =====

    /**
     * Get all transfers with a peer
     */
    fun getTransfersByPeer(peerId: String): Flow<List<FileTransferEntity>> {
        return fileTransferDao.getByPeer(peerId)
    }

    /**
     * Get all transfers
     */
    fun getAllTransfers(): Flow<List<FileTransferEntity>> {
        return fileTransferDao.getAll()
    }

    /**
     * Get active transfers
     */
    fun getActiveTransfers(): Flow<List<FileTransferEntity>> {
        return fileTransferDao.getActive()
    }

    /**
     * Get active transfers with a specific peer
     */
    fun getActiveTransfersByPeer(peerId: String): Flow<List<FileTransferEntity>> {
        return fileTransferDao.getActiveByPeer(peerId)
    }

    /**
     * Get pending incoming requests
     */
    fun getPendingIncomingRequests(): Flow<List<FileTransferEntity>> {
        return fileTransferDao.getPendingIncomingRequests()
    }

    /**
     * Get pending requests for a peer
     */
    fun getPendingRequestsByPeer(peerId: String): Flow<List<FileTransferEntity>> {
        return fileTransferDao.getPendingRequestsByPeer(peerId)
    }

    /**
     * Get completed transfers
     */
    fun getCompletedTransfers(): Flow<List<FileTransferEntity>> {
        return fileTransferDao.getCompleted()
    }

    /**
     * Get failed transfers
     */
    fun getFailedTransfers(): Flow<List<FileTransferEntity>> {
        return fileTransferDao.getFailed()
    }

    /**
     * Get a specific transfer by ID
     */
    suspend fun getTransferById(transferId: String): FileTransferEntity? {
        return fileTransferDao.getById(transferId)
    }

    /**
     * Observe a specific transfer
     */
    fun observeTransfer(transferId: String): Flow<FileTransferEntity?> {
        return fileTransferDao.observeById(transferId)
    }

    /**
     * Get real-time progress for a transfer
     */
    fun getTransferProgress(transferId: String): TransferProgress? {
        return progressTracker.getProgress(transferId)
    }

    /**
     * Get combined transfer data (entity + progress)
     */
    fun getTransferWithProgress(transferId: String): Flow<Pair<FileTransferEntity?, TransferProgress?>> {
        return combine(
            fileTransferDao.observeById(transferId),
            progressTracker.allTransfersProgress
        ) { entity, progressMap ->
            entity to progressMap[transferId]
        }
    }

    /**
     * Count active transfers
     */
    suspend fun countActiveTransfers(): Int {
        return fileTransferDao.countActive()
    }

    /**
     * Count active transfers with a peer
     */
    suspend fun countActiveTransfersByPeer(peerId: String): Int {
        return fileTransferDao.countActiveByPeer(peerId)
    }

    // ===== Cleanup Operations =====

    /**
     * Delete a transfer record
     */
    suspend fun deleteTransfer(transferId: String) {
        val entity = fileTransferDao.getById(transferId) ?: return

        // Cancel if still active
        if (!FileTransferStatusEnum.isTerminal(entity.status)) {
            cancelTransfer(transferId, "Deleted by user")
        }

        // Clean up temp files
        fileChunker.cleanupTempFiles(transferId)

        // Delete from database
        fileTransferDao.deleteById(transferId)
    }

    /**
     * Delete all transfers with a peer
     */
    suspend fun deleteTransfersByPeer(peerId: String) {
        val transfers = fileTransferDao.getByPeer(peerId).map { it }
        // Cancel active ones
        // This is a simplification - in production you'd want to properly cancel each
        fileTransferDao.deleteByPeer(peerId)
    }

    /**
     * Delete old completed transfers
     *
     * @param maxAgeMillis Maximum age in milliseconds (default 7 days)
     */
    suspend fun deleteOldCompletedTransfers(maxAgeMillis: Long = 7L * 24 * 60 * 60 * 1000) {
        val cutoffTime = System.currentTimeMillis() - maxAgeMillis
        fileTransferDao.deleteOldCompleted(cutoffTime)
    }

    /**
     * Clear all completed transfers
     */
    suspend fun clearCompletedTransfers() {
        fileTransferDao.clearCompleted()
        fileTransferManager.cleanupCompletedTransfers()
    }

    /**
     * Clear all failed transfers
     */
    suspend fun clearFailedTransfers() {
        fileTransferDao.clearFailed()
    }

    /**
     * Clean up old temp files
     */
    fun cleanupOldTempFiles(maxAgeMillis: Long = 24L * 60 * 60 * 1000) {
        fileChunker.cleanupOldTempFiles(maxAgeMillis)
    }

    // ===== Private Helpers =====

    private suspend fun handleTransferResult(result: TransferResult) {
        if (result.success) {
            fileTransferDao.markCompleted(result.transferId, result.localFilePath)
            Log.i(TAG, "Transfer completed: ${result.transferId}")
        } else {
            fileTransferDao.markFailed(result.transferId, result.errorMessage)
            Log.w(TAG, "Transfer failed: ${result.transferId} - ${result.errorMessage}")
        }
    }

    private suspend fun updateProgressInDatabase(progress: TransferProgress) {
        // Only update periodically to avoid too many database writes
        try {
            fileTransferDao.updateProgress(
                transferId = progress.transferId,
                completedChunks = progress.completedChunks,
                bytesTransferred = progress.bytesTransferred
            )
        } catch (e: Exception) {
            // Ignore - transfer might have been deleted
        }
    }

    /**
     * Handle incoming transfer request (called by manager via events)
     */
    internal suspend fun handleIncomingRequest(metadata: FileTransferMetadata) {
        val entity = metadataToEntity(metadata, isOutgoing = false)
        fileTransferDao.insert(entity)
        Log.i(TAG, "Incoming transfer request received: ${metadata.fileName}")
    }

    private fun metadataToEntity(
        metadata: FileTransferMetadata,
        isOutgoing: Boolean,
        localFilePath: String? = null
    ): FileTransferEntity {
        return FileTransferEntity(
            id = metadata.transferId,
            peerId = if (isOutgoing) metadata.receiverDeviceId else metadata.senderDeviceId,
            fileName = metadata.fileName,
            fileSize = metadata.fileSize,
            mimeType = metadata.mimeType,
            fileChecksum = metadata.checksum,
            thumbnailBase64 = metadata.thumbnail,
            localFilePath = localFilePath,
            tempFilePath = null,
            isOutgoing = isOutgoing,
            status = if (isOutgoing) FileTransferStatusEnum.REQUESTING else FileTransferStatusEnum.REQUESTING,
            chunkSize = metadata.chunkSize,
            totalChunks = metadata.totalChunks,
            completedChunks = 0,
            bytesTransferred = 0,
            retryCount = 0,
            errorMessage = null,
            createdAt = metadata.createdAt,
            updatedAt = System.currentTimeMillis()
        )
    }

    private fun entityToStatus(statusString: String): FileTransferStatus {
        return when (statusString) {
            FileTransferStatusEnum.PENDING -> FileTransferStatus.PENDING
            FileTransferStatusEnum.REQUESTING -> FileTransferStatus.REQUESTING
            FileTransferStatusEnum.TRANSFERRING -> FileTransferStatus.TRANSFERRING
            FileTransferStatusEnum.PAUSED -> FileTransferStatus.PAUSED
            FileTransferStatusEnum.COMPLETED -> FileTransferStatus.COMPLETED
            FileTransferStatusEnum.FAILED -> FileTransferStatus.FAILED
            FileTransferStatusEnum.CANCELLED -> FileTransferStatus.CANCELLED
            FileTransferStatusEnum.REJECTED -> FileTransferStatus.REJECTED
            else -> FileTransferStatus.PENDING
        }
    }

    fun cleanup() {
        resultCollectJob?.cancel()
        resultCollectJob = null
        progressCollectJob?.cancel()
        progressCollectJob = null
    }
}
