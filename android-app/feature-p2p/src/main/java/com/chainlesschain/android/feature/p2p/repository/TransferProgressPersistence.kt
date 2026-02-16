package com.chainlesschain.android.feature.p2p.repository

import timber.log.Timber
import com.chainlesschain.android.core.database.dao.FileTransferDao
import com.chainlesschain.android.core.database.entity.FileTransferStatusEnum
import com.chainlesschain.android.core.p2p.filetransfer.TransferProgressTracker
import com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 传输进度持久化管理器
 *
 * 智能管理进度的数据库持久化：
 * - 节流：避免过于频繁的数据库写入
 * - 检查点：在重要节点强制保存
 * - 应用重启恢复：从数据库恢复传输状态
 * - 批量保存：合并多个更新减少IO
 */
@Singleton
class TransferProgressPersistence @Inject constructor(
    private val fileTransferDao: FileTransferDao,
    private val progressTracker: TransferProgressTracker
) {
    companion object {
        /** 最小保存间隔（毫秒） */
        private const val MIN_SAVE_INTERVAL_MS = 2000L // 2秒

        /** 每N个分块强制保存一次 */
        private const val CHECKPOINT_CHUNK_INTERVAL = 50

        /** 每N字节强制保存一次 */
        private const val CHECKPOINT_BYTES_INTERVAL = 10L * 1024 * 1024 // 10MB

        /** 批量保存间隔 */
        private const val BATCH_SAVE_INTERVAL_MS = 5000L // 5秒
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 每个传输的上次保存时间
    private val lastSaveTime = ConcurrentHashMap<String, Long>()

    // 每个传输的上次保存的分块数
    private val lastSavedChunks = ConcurrentHashMap<String, Int>()

    // 每个传输的上次保存的字节数
    private val lastSavedBytes = ConcurrentHashMap<String, Long>()

    // 待保存的进度队列
    private val pendingSaves = ConcurrentHashMap<String, TransferProgress>()

    // 批量保存任务
    private var batchSaveJob: Job? = null

    init {
        startBatchSaveJob()
    }

    /**
     * 更新进度（带智能节流）
     */
    fun updateProgress(progress: TransferProgress) {
        val transferId = progress.transferId
        val now = System.currentTimeMillis()

        // 检查是否需要保存
        if (shouldSave(progress, now)) {
            // 立即保存
            scope.launch {
                saveProgress(progress)
            }
        } else {
            // 加入待保存队列，等待批量保存
            pendingSaves[transferId] = progress
        }
    }

    /**
     * 强制保存进度（用于暂停、取消等操作）
     */
    suspend fun forceSave(transferId: String) {
        val progress = progressTracker.getProgress(transferId)
        if (progress != null) {
            saveProgress(progress)
            pendingSaves.remove(transferId)
        }
    }

    /**
     * 强制保存所有待保存的进度
     */
    suspend fun flushAll() {
        val toSave = pendingSaves.toMap()
        pendingSaves.clear()

        for ((_, progress) in toSave) {
            saveProgress(progress)
        }

        Timber.i("Flushed ${toSave.size} pending saves")
    }

    /**
     * 从数据库恢复未完成的传输
     */
    suspend fun recoverFromDatabase(): List<RecoverableTransfer> {
        val activeTransfers = fileTransferDao.getActive().first()
        val recoverable = mutableListOf<RecoverableTransfer>()

        for (transfer in activeTransfers) {
            // 跳过正在请求中的传输（需要用户确认）
            if (transfer.status == FileTransferStatusEnum.REQUESTING) {
                continue
            }

            val recoverableTransfer = RecoverableTransfer(
                transferId = transfer.id,
                peerId = transfer.peerId,
                fileName = transfer.fileName,
                fileSize = transfer.fileSize,
                mimeType = transfer.mimeType,
                checksum = transfer.fileChecksum,
                chunkSize = transfer.chunkSize,
                totalChunks = transfer.totalChunks,
                completedChunks = transfer.completedChunks,
                bytesTransferred = transfer.bytesTransferred,
                isOutgoing = transfer.isOutgoing,
                localFilePath = transfer.localFilePath,
                tempFilePath = transfer.tempFilePath
            )

            recoverable.add(recoverableTransfer)

            Timber.i("Found recoverable transfer: ${transfer.id}, " +
                    "progress: ${transfer.completedChunks}/${transfer.totalChunks}")
        }

        return recoverable
    }

    /**
     * 清理传输的持久化状态
     */
    fun cleanupTransfer(transferId: String) {
        lastSaveTime.remove(transferId)
        lastSavedChunks.remove(transferId)
        lastSavedBytes.remove(transferId)
        pendingSaves.remove(transferId)
    }

    /**
     * 清理所有状态
     */
    fun cleanup() {
        batchSaveJob?.cancel()
        lastSaveTime.clear()
        lastSavedChunks.clear()
        lastSavedBytes.clear()
        pendingSaves.clear()
    }

    private fun shouldSave(progress: TransferProgress, now: Long): Boolean {
        val transferId = progress.transferId

        // 检查时间间隔
        val lastTime = lastSaveTime[transferId] ?: 0L
        if (now - lastTime < MIN_SAVE_INTERVAL_MS) {
            // 检查是否到达检查点
            return isAtCheckpoint(progress)
        }

        return true
    }

    private fun isAtCheckpoint(progress: TransferProgress): Boolean {
        val transferId = progress.transferId

        // 检查分块检查点
        val lastChunks = lastSavedChunks[transferId] ?: 0
        val chunkDiff = progress.completedChunks - lastChunks
        if (chunkDiff >= CHECKPOINT_CHUNK_INTERVAL) {
            return true
        }

        // 检查字节检查点
        val lastBytes = lastSavedBytes[transferId] ?: 0L
        val bytesDiff = progress.bytesTransferred - lastBytes
        if (bytesDiff >= CHECKPOINT_BYTES_INTERVAL) {
            return true
        }

        // 检查是否完成（始终保存）
        if (progress.completedChunks == progress.totalChunks) {
            return true
        }

        return false
    }

    private suspend fun saveProgress(progress: TransferProgress) {
        val transferId = progress.transferId
        val now = System.currentTimeMillis()

        try {
            fileTransferDao.updateProgress(
                transferId = transferId,
                completedChunks = progress.completedChunks,
                bytesTransferred = progress.bytesTransferred
            )

            // 更新保存状态
            lastSaveTime[transferId] = now
            lastSavedChunks[transferId] = progress.completedChunks
            lastSavedBytes[transferId] = progress.bytesTransferred

            Timber.d("Saved progress: $transferId - " +
                    "${progress.completedChunks}/${progress.totalChunks} chunks, " +
                    "${progress.bytesTransferred} bytes")
        } catch (e: Exception) {
            Timber.e(e, "Failed to save progress: $transferId")
        }
    }

    private fun startBatchSaveJob() {
        batchSaveJob = scope.launch {
            while (isActive) {
                delay(BATCH_SAVE_INTERVAL_MS)

                // 批量保存所有待保存的进度
                val toSave = pendingSaves.toMap()
                if (toSave.isNotEmpty()) {
                    pendingSaves.clear()

                    for ((_, progress) in toSave) {
                        saveProgress(progress)
                    }

                    Timber.d("Batch saved ${toSave.size} progress updates")
                }
            }
        }
    }
}

/**
 * 可恢复的传输信息
 */
data class RecoverableTransfer(
    val transferId: String,
    val peerId: String,
    val fileName: String,
    val fileSize: Long,
    val mimeType: String,
    val checksum: String,
    val chunkSize: Int,
    val totalChunks: Int,
    val completedChunks: Int,
    val bytesTransferred: Long,
    val isOutgoing: Boolean,
    val localFilePath: String?,
    val tempFilePath: String?
) {
    /**
     * 计算恢复进度百分比
     */
    fun getRecoveryPercent(): Float {
        return if (totalChunks > 0) {
            (completedChunks.toFloat() / totalChunks) * 100
        } else {
            0f
        }
    }

    /**
     * 检查是否可以恢复
     */
    fun canResume(): Boolean {
        return when {
            // 出站传输需要有本地文件路径
            isOutgoing && localFilePath.isNullOrEmpty() -> false
            // 入站传输需要有临时文件路径
            !isOutgoing && tempFilePath.isNullOrEmpty() -> false
            // 已完成的不需要恢复
            completedChunks >= totalChunks -> false
            else -> true
        }
    }
}
