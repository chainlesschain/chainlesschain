package com.chainlesschain.android.feature.p2p.worker

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.chainlesschain.android.core.database.dao.FileTransferDao
import com.chainlesschain.android.core.database.entity.FileTransferStatusEnum
import com.chainlesschain.android.core.p2p.filetransfer.FileTransferManager
import com.chainlesschain.android.feature.p2p.notification.FileTransferNotificationManager
import com.chainlesschain.android.feature.p2p.repository.FileTransferRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * 文件传输后台工作器
 *
 * 使用 WorkManager 支持后台文件传输，确保传输能在以下场景继续：
 * - 应用进入后台
 * - 应用被系统杀死后重启
 * - 设备重启后
 *
 * 特性：
 * - 网络感知：仅在有网络时执行
 * - 自动重试：失败后指数退避重试
 * - 进度通知：通过 NotificationManager 显示进度
 * - 电池优化：支持低电量暂停
 */
@HiltWorker
class FileTransferWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val fileTransferRepository: FileTransferRepository,
    private val fileTransferDao: FileTransferDao,
    private val notificationManager: FileTransferNotificationManager
) : CoroutineWorker(context, workerParams) {

    companion object {
        private const val TAG = "FileTransferWorker"

        // Input data keys
        const val KEY_TRANSFER_ID = "transfer_id"
        const val KEY_FILE_URI = "file_uri"
        const val KEY_PEER_ID = "peer_id"
        const val KEY_IS_OUTGOING = "is_outgoing"

        // Work names
        const val WORK_NAME_PREFIX = "file_transfer_"

        /**
         * 创建发送文件的工作请求
         */
        fun createSendWorkRequest(
            transferId: String,
            fileUri: Uri,
            peerId: String
        ): OneTimeWorkRequest {
            val inputData = workDataOf(
                KEY_TRANSFER_ID to transferId,
                KEY_FILE_URI to fileUri.toString(),
                KEY_PEER_ID to peerId,
                KEY_IS_OUTGOING to true
            )

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(false) // 允许低电量传输
                .build()

            return OneTimeWorkRequestBuilder<FileTransferWorker>()
                .setInputData(inputData)
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .addTag("file_transfer")
                .addTag("transfer_$transferId")
                .build()
        }

        /**
         * 创建接收文件的工作请求
         */
        fun createReceiveWorkRequest(
            transferId: String,
            peerId: String
        ): OneTimeWorkRequest {
            val inputData = workDataOf(
                KEY_TRANSFER_ID to transferId,
                KEY_PEER_ID to peerId,
                KEY_IS_OUTGOING to false
            )

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            return OneTimeWorkRequestBuilder<FileTransferWorker>()
                .setInputData(inputData)
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .addTag("file_transfer")
                .addTag("transfer_$transferId")
                .build()
        }

        /**
         * 获取唯一工作名称
         */
        fun getUniqueWorkName(transferId: String): String = "$WORK_NAME_PREFIX$transferId"
    }

    override suspend fun doWork(): Result {
        val transferId = inputData.getString(KEY_TRANSFER_ID) ?: return Result.failure()
        val isOutgoing = inputData.getBoolean(KEY_IS_OUTGOING, true)

        Log.i(TAG, "Starting file transfer work: $transferId (outgoing: $isOutgoing)")

        return try {
            // 获取传输记录
            val transfer = fileTransferDao.getById(transferId)
            if (transfer == null) {
                Log.e(TAG, "Transfer not found: $transferId")
                return Result.failure()
            }

            // 检查是否已完成或取消
            if (FileTransferStatusEnum.isTerminal(transfer.status)) {
                Log.i(TAG, "Transfer already in terminal state: ${transfer.status}")
                return Result.success()
            }

            // 设置为前台服务以保持活跃
            setForeground(createForegroundInfo(transfer.fileName, isOutgoing))

            if (isOutgoing) {
                handleOutgoingTransfer(transferId)
            } else {
                handleIncomingTransfer(transferId)
            }

            // 检查最终状态
            val finalTransfer = fileTransferDao.getById(transferId)
            when (finalTransfer?.status) {
                FileTransferStatusEnum.COMPLETED -> {
                    Log.i(TAG, "Transfer completed: $transferId")
                    Result.success()
                }
                FileTransferStatusEnum.FAILED -> {
                    Log.w(TAG, "Transfer failed, will retry: $transferId")
                    if (runAttemptCount < 3) {
                        Result.retry()
                    } else {
                        Result.failure()
                    }
                }
                FileTransferStatusEnum.CANCELLED, FileTransferStatusEnum.REJECTED -> {
                    Log.i(TAG, "Transfer cancelled/rejected: $transferId")
                    Result.success() // 不需要重试
                }
                FileTransferStatusEnum.PAUSED -> {
                    Log.i(TAG, "Transfer paused: $transferId")
                    Result.success() // 暂停状态，等待用户恢复
                }
                else -> {
                    // 传输中状态，说明可能被中断
                    Log.w(TAG, "Transfer interrupted: $transferId")
                    Result.retry()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Transfer work failed", e)
            if (runAttemptCount < 3) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }

    private suspend fun handleOutgoingTransfer(transferId: String) {
        val fileUriString = inputData.getString(KEY_FILE_URI)
        val peerId = inputData.getString(KEY_PEER_ID)

        if (fileUriString == null || peerId == null) {
            Log.e(TAG, "Missing file URI or peer ID")
            return
        }

        val fileUri = Uri.parse(fileUriString)

        // 检查是否需要恢复传输
        val transfer = fileTransferDao.getById(transferId)
        if (transfer != null && transfer.completedChunks > 0) {
            // 恢复传输
            Log.i(TAG, "Resuming transfer from chunk ${transfer.completedChunks}")
            fileTransferRepository.resumeTransfer(transferId)
        } else {
            // 新传输已经在 Repository 中开始，这里只需等待完成
            // 通过观察进度来更新通知
            observeTransferProgress(transferId, transfer?.fileName ?: "File", true)
        }
    }

    private suspend fun handleIncomingTransfer(transferId: String) {
        // 入站传输由 P2P 消息触发，这里主要是确保传输继续
        val transfer = fileTransferDao.getById(transferId) ?: return

        if (transfer.status == FileTransferStatusEnum.REQUESTING) {
            // 等待用户接受
            Log.i(TAG, "Waiting for user to accept transfer: $transferId")
            return
        }

        // 观察进度
        observeTransferProgress(transferId, transfer.fileName, false)
    }

    private suspend fun observeTransferProgress(
        transferId: String,
        fileName: String,
        isOutgoing: Boolean
    ) {
        // 观察进度直到传输完成
        fileTransferRepository.allTransfersProgress.collect { progressMap ->
            val progress = progressMap[transferId]
            if (progress != null) {
                // 更新进度通知
                notificationManager.showProgressNotification(
                    transferId = transferId,
                    fileName = fileName,
                    progress = progress,
                    isOutgoing = isOutgoing
                )

                // 更新 WorkManager 进度
                setProgress(workDataOf(
                    "progress" to progress.getProgressPercent().toInt(),
                    "speed" to progress.speedBytesPerSecond,
                    "eta" to progress.etaSeconds
                ))
            }

            // 检查是否完成
            val transfer = fileTransferDao.getById(transferId)
            if (transfer != null && FileTransferStatusEnum.isTerminal(transfer.status)) {
                return@collect
            }
        }
    }

    private fun createForegroundInfo(fileName: String, isOutgoing: Boolean): ForegroundInfo {
        val title = if (isOutgoing) "正在发送文件" else "正在接收文件"

        val notification = androidx.core.app.NotificationCompat.Builder(
            applicationContext,
            "file_transfer_progress"
        )
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(title)
            .setContentText(fileName)
            .setOngoing(true)
            .setProgress(100, 0, true)
            .build()

        return ForegroundInfo(
            inputData.getString(KEY_TRANSFER_ID).hashCode(),
            notification
        )
    }
}

/**
 * 文件传输工作调度器
 *
 * 用于调度和管理文件传输后台工作
 */
class FileTransferWorkScheduler(
    private val context: Context
) {
    private val workManager = WorkManager.getInstance(context)

    /**
     * 调度发送文件工作
     */
    fun scheduleSendFile(transferId: String, fileUri: Uri, peerId: String) {
        val workRequest = FileTransferWorker.createSendWorkRequest(transferId, fileUri, peerId)
        val uniqueWorkName = FileTransferWorker.getUniqueWorkName(transferId)

        workManager.enqueueUniqueWork(
            uniqueWorkName,
            ExistingWorkPolicy.KEEP, // 如果已存在相同工作，保持原有
            workRequest
        )

        Log.i("FileTransferWorkScheduler", "Scheduled send work: $transferId")
    }

    /**
     * 调度接收文件工作
     */
    fun scheduleReceiveFile(transferId: String, peerId: String) {
        val workRequest = FileTransferWorker.createReceiveWorkRequest(transferId, peerId)
        val uniqueWorkName = FileTransferWorker.getUniqueWorkName(transferId)

        workManager.enqueueUniqueWork(
            uniqueWorkName,
            ExistingWorkPolicy.KEEP,
            workRequest
        )

        Log.i("FileTransferWorkScheduler", "Scheduled receive work: $transferId")
    }

    /**
     * 取消传输工作
     */
    fun cancelTransfer(transferId: String) {
        workManager.cancelUniqueWork(FileTransferWorker.getUniqueWorkName(transferId))
        Log.i("FileTransferWorkScheduler", "Cancelled work: $transferId")
    }

    /**
     * 取消所有传输工作
     */
    fun cancelAllTransfers() {
        workManager.cancelAllWorkByTag("file_transfer")
        Log.i("FileTransferWorkScheduler", "Cancelled all transfer works")
    }

    /**
     * 获取传输工作状态
     */
    fun getWorkInfo(transferId: String) =
        workManager.getWorkInfosForUniqueWorkLiveData(FileTransferWorker.getUniqueWorkName(transferId))

    /**
     * 恢复所有未完成的传输
     */
    suspend fun resumePendingTransfers(fileTransferDao: FileTransferDao) {
        val activeTransfers = fileTransferDao.getActive().first()

        for (transfer in activeTransfers) {
            if (transfer.isOutgoing) {
                transfer.localFilePath?.let { path ->
                    scheduleSendFile(
                        transfer.id,
                        Uri.parse(path),
                        transfer.peerId
                    )
                }
            } else {
                scheduleReceiveFile(transfer.id, transfer.peerId)
            }
        }

        Log.i("FileTransferWorkScheduler", "Resumed ${activeTransfers.size} pending transfers")
    }
}
