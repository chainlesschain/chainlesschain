package com.chainlesschain.android.core.p2p.filetransfer

import android.util.Log
import com.chainlesschain.android.core.database.dao.TransferCheckpointDao
import com.chainlesschain.android.core.database.entity.CheckpointSummary
import com.chainlesschain.android.core.database.entity.TransferCheckpointEntity
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 断点管理器
 *
 * 负责传输断点的持久化、恢复和清理
 * 支持断点续传功能
 */
@Singleton
class CheckpointManager @Inject constructor(
    private val checkpointDao: TransferCheckpointDao
) {
    companion object {
        private const val TAG = "CheckpointManager"

        /** 自动保存频率（每N个分块） */
        const val AUTO_SAVE_INTERVAL = 10

        /** 检查点过期时间（7天） */
        private const val CHECKPOINT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000L
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /**
     * 创建新的检查点
     *
     * @param metadata 传输元数据
     * @param isOutgoing 是否为出站传输
     * @param tempFilePath 临时文件路径（接收方）
     * @param sourceFileUri 源文件URI（发送方）
     */
    suspend fun createCheckpoint(
        metadata: FileTransferMetadata,
        isOutgoing: Boolean,
        tempFilePath: String? = null,
        sourceFileUri: String? = null
    ): TransferCheckpointEntity {
        val checkpoint = TransferCheckpointEntity.create(
            transferId = metadata.transferId,
            fileId = metadata.transferId, // Use transferId as fileId for now
            fileName = metadata.fileName,
            totalSize = metadata.fileSize,
            totalChunks = metadata.totalChunks,
            chunkSize = metadata.chunkSize,
            isOutgoing = isOutgoing,
            peerId = if (isOutgoing) metadata.receiverDeviceId else metadata.senderDeviceId,
            fileChecksum = metadata.checksum,
            tempFilePath = tempFilePath,
            sourceFileUri = sourceFileUri
        )

        checkpointDao.upsert(checkpoint)
        Log.d(TAG, "Created checkpoint for transfer: ${metadata.transferId}")

        return checkpoint
    }

    /**
     * 更新检查点（记录已完成的分块）
     *
     * @param transferId 传输ID
     * @param chunkIndex 已完成的分块索引
     * @param chunkSize 分块大小
     */
    suspend fun updateCheckpoint(transferId: String, chunkIndex: Int, chunkSize: Long) {
        val checkpoint = checkpointDao.getByTransferId(transferId) ?: run {
            Log.w(TAG, "Checkpoint not found for transfer: $transferId")
            return
        }

        val updatedCheckpoint = checkpoint.withReceivedChunk(chunkIndex, chunkSize)
        checkpointDao.update(updatedCheckpoint)

        Log.v(TAG, "Updated checkpoint for transfer $transferId: chunk $chunkIndex completed")
    }

    /**
     * 批量更新检查点（记录多个已完成的分块）
     *
     * @param transferId 传输ID
     * @param chunkIndices 已完成的分块索引列表
     */
    suspend fun updateCheckpointBatch(transferId: String, chunkIndices: Collection<Int>) {
        val checkpoint = checkpointDao.getByTransferId(transferId) ?: run {
            Log.w(TAG, "Checkpoint not found for transfer: $transferId")
            return
        }

        val updatedCheckpoint = checkpoint.withReceivedChunks(chunkIndices)
        checkpointDao.update(updatedCheckpoint)

        Log.d(TAG, "Batch updated checkpoint for transfer $transferId: ${chunkIndices.size} chunks")
    }

    /**
     * 获取检查点
     *
     * @param transferId 传输ID
     * @return 检查点实体或null
     */
    suspend fun getCheckpoint(transferId: String): TransferCheckpointEntity? {
        return checkpointDao.getByTransferId(transferId)
    }

    /**
     * 观察检查点变化
     *
     * @param transferId 传输ID
     * @return 检查点Flow
     */
    fun observeCheckpoint(transferId: String): Flow<TransferCheckpointEntity?> {
        return checkpointDao.observeByTransferId(transferId)
    }

    /**
     * 获取所有可恢复的检查点
     *
     * @return 可恢复的检查点列表
     */
    suspend fun getResumableCheckpoints(): List<TransferCheckpointEntity> {
        return checkpointDao.getResumableCheckpoints()
            .filter { it.canResume() }
    }

    /**
     * 观察所有可恢复的检查点摘要
     *
     * @return 检查点摘要Flow
     */
    fun observeResumableCheckpointSummaries(): Flow<List<CheckpointSummary>> {
        return checkpointDao.observeResumableCheckpoints()
            .map { checkpoints ->
                checkpoints
                    .filter { it.canResume() }
                    .map { CheckpointSummary.from(it) }
            }
    }

    /**
     * 获取特定peer的检查点
     *
     * @param peerId 对等设备ID
     * @return 检查点列表
     */
    suspend fun getCheckpointsByPeer(peerId: String): List<TransferCheckpointEntity> {
        return checkpointDao.getByPeerId(peerId)
    }

    /**
     * 删除检查点
     *
     * @param transferId 传输ID
     */
    suspend fun deleteCheckpoint(transferId: String) {
        val deleted = checkpointDao.deleteByTransferId(transferId)
        Log.d(TAG, "Deleted checkpoint for transfer $transferId (affected: $deleted)")
    }

    /**
     * 删除所有检查点
     */
    suspend fun deleteAllCheckpoints() {
        val deleted = checkpointDao.deleteAll()
        Log.i(TAG, "Deleted all checkpoints (count: $deleted)")
    }

    /**
     * 清理过期的检查点
     *
     * @param maxAgeMs 最大保留时间（毫秒），默认7天
     */
    suspend fun cleanupExpiredCheckpoints(maxAgeMs: Long = CHECKPOINT_EXPIRY_MS) {
        val cutoffTime = System.currentTimeMillis() - maxAgeMs
        val deleted = checkpointDao.deleteOlderThan(cutoffTime)

        if (deleted > 0) {
            Log.i(TAG, "Cleaned up $deleted expired checkpoints")
        }
    }

    /**
     * 检查是否存在检查点
     *
     * @param transferId 传输ID
     * @return true if exists
     */
    suspend fun hasCheckpoint(transferId: String): Boolean {
        return checkpointDao.exists(transferId)
    }

    /**
     * 获取检查点总数
     */
    suspend fun getCheckpointCount(): Int {
        return checkpointDao.getCount()
    }

    /**
     * 获取可恢复检查点总数
     */
    suspend fun getResumableCount(): Int {
        return checkpointDao.getResumableCount()
    }

    /**
     * 从检查点恢复传输
     *
     * 返回需要传输的分块列表
     *
     * @param transferId 传输ID
     * @return 缺失的分块索引列表，如果不存在检查点则返回null
     */
    suspend fun restoreFromCheckpoint(transferId: String): List<Int>? {
        val checkpoint = getCheckpoint(transferId) ?: return null

        if (!checkpoint.canResume()) {
            Log.w(TAG, "Checkpoint for $transferId cannot be resumed")
            return null
        }

        val missingChunks = checkpoint.getMissingChunks()
        Log.i(TAG, "Restored checkpoint for $transferId: ${missingChunks.size} chunks remaining")

        return missingChunks
    }

    /**
     * 获取检查点进度信息
     *
     * @param transferId 传输ID
     * @return Triple of (received chunks, total chunks, progress percentage)
     */
    suspend fun getCheckpointProgress(transferId: String): Triple<Int, Int, Float>? {
        val checkpoint = getCheckpoint(transferId) ?: return null

        return Triple(
            checkpoint.getReceivedChunks().size,
            checkpoint.totalChunks,
            checkpoint.getProgressPercentage()
        )
    }

    /**
     * 定期清理任务（应用启动时调用）
     */
    fun startPeriodicCleanup() {
        scope.launch {
            try {
                cleanupExpiredCheckpoints()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to cleanup expired checkpoints", e)
            }
        }
    }

    /**
     * 导出检查点摘要（用于调试）
     */
    suspend fun exportCheckpointSummaries(): List<CheckpointSummary> {
        return checkpointDao.getAll().map { CheckpointSummary.from(it) }
    }
}
