package com.chainlesschain.android.feature.filebrowser.worker

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * 后台文件扫描Worker
 *
 * 功能:
 * - 定期自动扫描设备文件 (增量更新)
 * - 使用WorkManager调度
 * - 支持周期性执行 (每6小时)
 * - 仅在WiFi和充电时执行 (节省电量和流量)
 * - 支持重试策略
 */
@HiltWorker
class FileScanWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val scanner: MediaStoreScanner
) : CoroutineWorker(context, workerParams) {

    companion object {
        private const val TAG = "FileScanWorker"
        const val WORK_NAME = "file_scan_worker"

        // Worker配置
        private const val REPEAT_INTERVAL_HOURS = 6L
        private const val FLEX_INTERVAL_HOURS = 2L
        private const val MAX_RETRY_COUNT = 3
        private const val INITIAL_BACKOFF_SECONDS = 30L

        // Notification配置
        private const val NOTIFICATION_CHANNEL_ID = "file_scan_channel"
        private const val NOTIFICATION_ID = 1001

        /**
         * 调度周期性文件扫描任务
         *
         * @param context Android Context
         */
        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.UNMETERED) // WiFi only
                .setRequiresCharging(true) // 充电时执行
                .setRequiresBatteryNotLow(true) // 电量充足
                .build()

            val workRequest = PeriodicWorkRequestBuilder<FileScanWorker>(
                REPEAT_INTERVAL_HOURS, TimeUnit.HOURS,
                FLEX_INTERVAL_HOURS, TimeUnit.HOURS
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    INITIAL_BACKOFF_SECONDS,
                    TimeUnit.SECONDS
                )
                .addTag(WORK_NAME)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    workRequest
                )

            Log.d(TAG, "File scan worker scheduled (every ${REPEAT_INTERVAL_HOURS}h)")
        }

        /**
         * 取消周期性文件扫描任务
         *
         * @param context Android Context
         */
        fun cancel(context: Context) {
            WorkManager.getInstance(context)
                .cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "File scan worker cancelled")
        }

        /**
         * 立即执行一次文件扫描 (忽略约束条件)
         *
         * @param context Android Context
         * @param useIncrementalScan 是否使用增量扫描
         */
        fun runNow(context: Context, useIncrementalScan: Boolean = true) {
            val inputData = Data.Builder()
                .putBoolean(KEY_USE_INCREMENTAL_SCAN, useIncrementalScan)
                .build()

            val workRequest = OneTimeWorkRequestBuilder<FileScanWorker>()
                .setInputData(inputData)
                .addTag(WORK_NAME)
                .build()

            WorkManager.getInstance(context)
                .enqueue(workRequest)

            Log.d(TAG, "File scan worker enqueued (one-time, incremental=$useIncrementalScan)")
        }

        private const val KEY_USE_INCREMENTAL_SCAN = "use_incremental_scan"
        private const val KEY_SCAN_RESULT = "scan_result"
        private const val KEY_FILE_COUNT = "file_count"

        /**
         * 创建通知渠道 (Android 8.0+)
         *
         * 应该在Application.onCreate()中调用
         */
        fun createNotificationChannel(context: Context) {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                val channel = android.app.NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "文件扫描",
                    android.app.NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "后台文件扫描进度通知"
                    setShowBadge(false)
                }

                val notificationManager = context.getSystemService(
                    android.app.NotificationManager::class.java
                )
                notificationManager.createNotificationChannel(channel)
            }
        }
    }

    override suspend fun doWork(): Result {
        Log.d(TAG, "File scan worker started (attempt ${runAttemptCount + 1})")

        return try {
            // 检查是否使用增量扫描
            val useIncrementalScan = inputData.getBoolean(KEY_USE_INCREMENTAL_SCAN, true)

            // 检查当前扫描状态，避免重复扫描
            val currentProgress = scanner.scanProgress.first()
            if (currentProgress is MediaStoreScanner.ScanProgress.Scanning) {
                Log.w(TAG, "Scan already in progress, skipping")
                return Result.retry()
            }

            // 执行扫描
            val result = if (useIncrementalScan) {
                Log.d(TAG, "Starting incremental scan...")
                scanner.scanIncrementalFiles()
            } else {
                Log.d(TAG, "Starting full scan...")
                scanner.scanAllFiles()
            }

            if (result.isSuccess) {
                val fileCount = result.getOrNull() ?: 0
                Log.d(TAG, "File scan completed: $fileCount files")

                // 返回结果数据
                val outputData = Data.Builder()
                    .putBoolean(KEY_SCAN_RESULT, true)
                    .putInt(KEY_FILE_COUNT, fileCount)
                    .build()

                Result.success(outputData)
            } else {
                val error = result.exceptionOrNull()
                Log.e(TAG, "File scan failed: ${error?.message}", error)

                // 重试策略: 失败少于最大重试次数时重试
                if (runAttemptCount < MAX_RETRY_COUNT) {
                    Result.retry()
                } else {
                    Result.failure()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Unexpected error during file scan", e)

            if (runAttemptCount < MAX_RETRY_COUNT) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        return createForegroundInfo()
    }

    /**
     * 创建前台通知信息
     *
     * Note: 长时间运行的Worker需要显示通知
     */
    private fun createForegroundInfo(): ForegroundInfo {
        val notification = androidx.core.app.NotificationCompat.Builder(
            applicationContext,
            NOTIFICATION_CHANNEL_ID
        )
            .setContentTitle("文件扫描中")
            .setContentText("正在更新文件索引...")
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .setOngoing(true)
            .build()

        return ForegroundInfo(NOTIFICATION_ID, notification)
    }
}

/**
 * WorkManager配置
 *
 * 在Application中初始化
 */
object FileScanWorkManager {

    /**
     * 初始化WorkManager配置
     *
     * @param context Application context
     */
    fun initialize(context: Context) {
        // 创建通知渠道
        FileScanWorker.createNotificationChannel(context)

        // 配置WorkManager
        val config = Configuration.Builder()
            .setMinimumLoggingLevel(Log.DEBUG)
            .build()

        WorkManager.initialize(context, config)

        Log.d("FileScanWorkManager", "WorkManager initialized")
    }

    /**
     * 启用自动扫描
     *
     * @param context Application context
     */
    fun enableAutoScan(context: Context) {
        FileScanWorker.schedule(context)
    }

    /**
     * 禁用自动扫描
     *
     * @param context Application context
     */
    fun disableAutoScan(context: Context) {
        FileScanWorker.cancel(context)
    }

    /**
     * 检查自动扫描状态
     *
     * @param context Application context
     * @return 是否已启用
     */
    fun isAutoScanEnabled(context: Context): Boolean {
        val workInfos = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(FileScanWorker.WORK_NAME)
            .get()

        return workInfos.any { workInfo ->
            workInfo.state == WorkInfo.State.ENQUEUED ||
            workInfo.state == WorkInfo.State.RUNNING
        }
    }
}
