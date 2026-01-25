package com.chainlesschain.android.core.p2p.filetransfer

import android.util.Log
import com.chainlesschain.android.core.database.dao.TransferQueueDao
import com.chainlesschain.android.core.database.entity.TransferQueueEntity
import com.chainlesschain.android.core.database.entity.TransferQueueStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 传输调度器
 *
 * 管理文件传输队列，控制并发传输数量，自动调度下一个传输
 */
@Singleton
class TransferScheduler @Inject constructor(
    private val queueDao: TransferQueueDao,
    private val fileTransferManager: FileTransferManager
) {
    companion object {
        private const val TAG = "TransferScheduler"

        /** 最大并发传输数量 */
        const val MAX_CONCURRENT_TRANSFERS = 3

        /** 调度检查间隔（毫秒） */
        private const val SCHEDULE_CHECK_INTERVAL_MS = 1000L

        /** 自动重试失败传输的延迟（毫秒） */
        private const val RETRY_DELAY_MS = 5000L
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 当前活动传输的transferId集合
    private val activeTransfers = mutableSetOf<String>()

    // 调度器是否正在运行
    private var isRunning = false

    // 队列变更事件
    private val _queueEvents = MutableSharedFlow<QueueEvent>(replay = 0, extraBufferCapacity = 16)
    val queueEvents: SharedFlow<QueueEvent> = _queueEvents.asSharedFlow()

    // 队列统计信息
    private val _queueStats = MutableStateFlow(QueueStats())
    val queueStats: StateFlow<QueueStats> = _queueStats.asStateFlow()

    /**
     * 启动调度器
     */
    fun start() {
        if (isRunning) {
            Log.w(TAG, "Scheduler already running")
            return
        }

        isRunning = true
        Log.i(TAG, "Transfer scheduler started")

        // 启动调度循环
        scope.launch {
            while (isRunning) {
                try {
                    scheduleNext()
                    updateStatistics()
                } catch (e: Exception) {
                    Log.e(TAG, "Error in scheduler loop", e)
                }
                delay(SCHEDULE_CHECK_INTERVAL_MS)
            }
        }

        // 监听传输完成事件
        scope.launch {
            fileTransferManager.transferResults.collect { result ->
                handleTransferCompleted(result)
            }
        }
    }

    /**
     * 停止调度器
     */
    fun stop() {
        isRunning = false
        Log.i(TAG, "Transfer scheduler stopped")
    }

    /**
     * 将传输加入队列
     *
     * @param queueItem 队列项
     */
    suspend fun enqueue(queueItem: TransferQueueEntity) {
        queueDao.insert(queueItem)
        _queueEvents.emit(QueueEvent.ItemAdded(queueItem))
        Log.i(TAG, "Transfer enqueued: ${queueItem.fileName} (priority: ${queueItem.priority})")

        // 立即尝试调度
        scheduleNext()
    }

    /**
     * 批量加入队列
     */
    suspend fun enqueueAll(queueItems: List<TransferQueueEntity>) {
        queueDao.insertAll(queueItems)
        queueItems.forEach { _queueEvents.emit(QueueEvent.ItemAdded(it)) }
        Log.i(TAG, "Batch enqueued: ${queueItems.size} items")

        // 立即尝试调度
        scheduleNext()
    }

    /**
     * 取消队列中的传输
     *
     * @param transferId 传输ID
     */
    suspend fun cancel(transferId: String) {
        val queueItem = queueDao.getByTransferId(transferId) ?: return

        when (queueItem.status) {
            TransferQueueStatus.QUEUED -> {
                // 直接取消排队中的项
                queueDao.updateStatus(transferId, TransferQueueStatus.CANCELLED)
                _queueEvents.emit(QueueEvent.ItemCancelled(queueItem))
                Log.i(TAG, "Cancelled queued transfer: ${queueItem.fileName}")
            }
            TransferQueueStatus.TRANSFERRING -> {
                // 取消正在传输的项
                fileTransferManager.cancelTransfer(transferId, "Cancelled by user")
                activeTransfers.remove(transferId)
                queueDao.updateStatus(transferId, TransferQueueStatus.CANCELLED)
                _queueEvents.emit(QueueEvent.ItemCancelled(queueItem))
                Log.i(TAG, "Cancelled active transfer: ${queueItem.fileName}")
            }
            else -> {
                Log.w(TAG, "Cannot cancel transfer in status: ${queueItem.status}")
            }
        }
    }

    /**
     * 重试失败的传输
     *
     * @param transferId 传输ID
     */
    suspend fun retry(transferId: String) {
        val queueItem = queueDao.getByTransferId(transferId) ?: return

        if (!queueItem.canRetry()) {
            Log.w(TAG, "Transfer cannot be retried: ${queueItem.fileName}")
            return
        }

        val updated = queueItem.withRetry()
        queueDao.update(updated)
        _queueEvents.emit(QueueEvent.ItemRetried(updated))
        Log.i(TAG, "Retrying transfer: ${queueItem.fileName} (attempt ${updated.retryCount})")

        // 延迟后尝试调度
        scope.launch {
            delay(RETRY_DELAY_MS)
            scheduleNext()
        }
    }

    /**
     * 清理已完成的队列项
     *
     * @param olderThanMs 保留时间（毫秒），默认24小时
     */
    suspend fun cleanupCompleted(olderThanMs: Long = 24 * 60 * 60 * 1000L) {
        val cutoffTime = System.currentTimeMillis() - olderThanMs
        val deleted = queueDao.deleteCompletedBefore(cutoffTime)
        if (deleted > 0) {
            Log.i(TAG, "Cleaned up $deleted completed queue items")
        }
    }

    /**
     * 获取队列中所有项
     */
    suspend fun getAllQueueItems(): List<TransferQueueEntity> {
        return queueDao.getAll()
    }

    /**
     * 获取排队中的项
     */
    suspend fun getQueuedItems(): List<TransferQueueEntity> {
        return queueDao.getQueued()
    }

    /**
     * 获取传输中的项
     */
    suspend fun getTransferringItems(): List<TransferQueueEntity> {
        return queueDao.getTransferring()
    }

    // Private implementation

    /**
     * 调度下一个传输
     */
    private suspend fun scheduleNext() {
        // 检查当前活动传输数量
        val transferringCount = queueDao.getTransferringCount()
        if (transferringCount >= MAX_CONCURRENT_TRANSFERS) {
            return // 已达到并发上限
        }

        // 获取排队中的项（按优先级排序）
        val queuedItems = queueDao.getQueued()
        if (queuedItems.isEmpty()) {
            return // 队列为空
        }

        // 计算可以启动的传输数量
        val slotsAvailable = MAX_CONCURRENT_TRANSFERS - transferringCount
        val itemsToStart = queuedItems.take(slotsAvailable)

        for (queueItem in itemsToStart) {
            startTransfer(queueItem)
        }
    }

    /**
     * 启动传输
     */
    private suspend fun startTransfer(queueItem: TransferQueueEntity) {
        try {
            // 更新状态为传输中
            queueDao.updateStatus(queueItem.transferId, TransferQueueStatus.TRANSFERRING)
            activeTransfers.add(queueItem.transferId)

            _queueEvents.emit(QueueEvent.ItemStarted(queueItem))
            Log.i(TAG, "Starting transfer: ${queueItem.fileName}")

            // TODO: 实际启动传输
            // 这里需要根据queueItem的信息调用fileTransferManager
            // 由于没有存储完整的文件URI和对等设备信息，这部分需要额外的元数据存储
            // 或者在enqueue时就启动传输，这里只做调度控制

        } catch (e: Exception) {
            Log.e(TAG, "Failed to start transfer: ${queueItem.fileName}", e)
            queueDao.updateStatus(queueItem.transferId, TransferQueueStatus.FAILED)
            activeTransfers.remove(queueItem.transferId)
            _queueEvents.emit(QueueEvent.ItemFailed(queueItem, e.message ?: "Unknown error"))
        }
    }

    /**
     * 处理传输完成事件
     */
    private suspend fun handleTransferCompleted(result: TransferResult) {
        val queueItem = queueDao.getByTransferId(result.transferId) ?: return

        activeTransfers.remove(result.transferId)

        val newStatus = if (result.success) {
            TransferQueueStatus.COMPLETED
        } else {
            TransferQueueStatus.FAILED
        }

        // 更新队列状态
        val updated = queueItem.withStatus(newStatus).copy(
            errorMessage = result.errorMessage
        )
        queueDao.update(updated)

        val event = if (result.success) {
            QueueEvent.ItemCompleted(updated)
        } else {
            QueueEvent.ItemFailed(updated, result.errorMessage ?: "Unknown error")
        }
        _queueEvents.emit(event)

        Log.i(TAG, "Transfer completed: ${queueItem.fileName} (success: ${result.success})")

        // 尝试调度下一个传输
        scheduleNext()

        // 如果失败且可重试，稍后自动重试
        if (!result.success && updated.canRetry()) {
            scope.launch {
                delay(RETRY_DELAY_MS)
                retry(result.transferId)
            }
        }
    }

    /**
     * 更新统计信息
     */
    private suspend fun updateStatistics() {
        val stats = queueDao.getStatistics()
        _queueStats.value = QueueStats(
            total = stats.total,
            queued = stats.queued,
            transferring = stats.transferring,
            completed = stats.completed,
            failed = stats.failed
        )
    }
}

/**
 * 队列事件
 */
sealed class QueueEvent {
    data class ItemAdded(val item: TransferQueueEntity) : QueueEvent()
    data class ItemStarted(val item: TransferQueueEntity) : QueueEvent()
    data class ItemCompleted(val item: TransferQueueEntity) : QueueEvent()
    data class ItemFailed(val item: TransferQueueEntity, val error: String) : QueueEvent()
    data class ItemCancelled(val item: TransferQueueEntity) : QueueEvent()
    data class ItemRetried(val item: TransferQueueEntity) : QueueEvent()
}

/**
 * 队列统计
 */
data class QueueStats(
    val total: Int = 0,
    val queued: Int = 0,
    val transferring: Int = 0,
    val completed: Int = 0,
    val failed: Int = 0
) {
    val activeCount: Int
        get() = queued + transferring

    val completionRate: Float
        get() = if (total > 0) completed.toFloat() / total else 0f
}
