package com.chainlesschain.android.feature.filebrowser.data.worker

import android.content.Context
import timber.log.Timber
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.chainlesschain.android.feature.filebrowser.data.scanner.IncrementalUpdateManager
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

/**
 * Background Scan Worker
 *
 * Performs automatic background scanning of media files using WorkManager.
 *
 * Features:
 * - Periodic scanning (every 24 hours)
 * - One-time full scan
 * - Incremental update mode
 * - Battery-aware scheduling
 * - Network constraints (Wi-Fi only for large scans)
 */
@HiltWorker
class ScanWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val mediaStoreScanner: MediaStoreScanner,
    private val incrementalUpdateManager: IncrementalUpdateManager
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val WORK_NAME_PERIODIC = "periodic_file_scan"
        const val WORK_NAME_ONE_TIME = "one_time_file_scan"
        const val INPUT_SCAN_MODE = "scan_mode"
        const val OUTPUT_RESULT = "scan_result"

        const val SCAN_MODE_FULL = "full"
        const val SCAN_MODE_INCREMENTAL = "incremental"

        /**
         * Schedule periodic file scanning
         *
         * @param context Application context
         * @param repeatInterval Repeat interval in hours (default: 24)
         */
        fun schedulePeriodicScan(context: Context, repeatInterval: Long = 24) {
            val constraints = Constraints.Builder()
                .setRequiresBatteryNotLow(true)
                .setRequiresStorageNotLow(true)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<ScanWorker>(
                repeatInterval,
                TimeUnit.HOURS,
                15, // Flex interval: can run 15 minutes before scheduled time
                TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setInputData(
                    workDataOf(INPUT_SCAN_MODE to SCAN_MODE_INCREMENTAL)
                )
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    WORK_NAME_PERIODIC,
                    ExistingPeriodicWorkPolicy.UPDATE,
                    workRequest
                )

            Timber.d("Scheduled periodic scan every $repeatInterval hours")
        }

        /**
         * Schedule one-time file scan
         *
         * @param context Application context
         * @param fullScan Whether to perform full scan (default: false)
         */
        fun scheduleOneTimeScan(context: Context, fullScan: Boolean = false) {
            val constraints = Constraints.Builder()
                .setRequiresBatteryNotLow(true)
                .build()

            val scanMode = if (fullScan) SCAN_MODE_FULL else SCAN_MODE_INCREMENTAL

            val workRequest = OneTimeWorkRequestBuilder<ScanWorker>()
                .setConstraints(constraints)
                .setInputData(
                    workDataOf(INPUT_SCAN_MODE to scanMode)
                )
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    WORK_NAME_ONE_TIME,
                    ExistingWorkPolicy.REPLACE,
                    workRequest
                )

            Timber.d("Scheduled one-time $scanMode scan")
        }

        /**
         * Cancel all scheduled scans
         *
         * @param context Application context
         */
        fun cancelAllScans(context: Context) {
            WorkManager.getInstance(context).apply {
                cancelUniqueWork(WORK_NAME_PERIODIC)
                cancelUniqueWork(WORK_NAME_ONE_TIME)
            }

            Timber.d("Cancelled all scheduled scans")
        }

        /**
         * Cancel periodic scan only
         *
         * @param context Application context
         */
        fun cancelPeriodicScan(context: Context) {
            WorkManager.getInstance(context)
                .cancelUniqueWork(WORK_NAME_PERIODIC)

            Timber.d("Cancelled periodic scan")
        }
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        val channelId = "file_scan_progress"
        val notificationManager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
            as android.app.NotificationManager
        if (notificationManager.getNotificationChannel(channelId) == null) {
            val channel = android.app.NotificationChannel(
                channelId,
                "File Scan Progress",
                android.app.NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows file scan progress"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val notification = androidx.core.app.NotificationCompat.Builder(applicationContext, channelId)
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .setContentTitle("Scanning files")
            .setContentText("Scanning media files in background...")
            .setOngoing(true)
            .setProgress(0, 0, true)
            .build()

        return ForegroundInfo(WORK_NAME_PERIODIC.hashCode(), notification)
    }

    override suspend fun doWork(): Result {
        return try {
            Timber.d("Starting background scan")

            val scanMode = inputData.getString(INPUT_SCAN_MODE) ?: SCAN_MODE_INCREMENTAL

            val result = when (scanMode) {
                SCAN_MODE_FULL -> performFullScan()
                SCAN_MODE_INCREMENTAL -> performIncrementalScan()
                else -> {
                    Timber.w("Unknown scan mode: $scanMode, defaulting to incremental")
                    performIncrementalScan()
                }
            }

            if (result.isSuccess) {
                Timber.d("Background scan completed successfully")
                Result.success(createOutputData(result))
            } else {
                Timber.e("Background scan failed: ${result.error}")
                Result.failure(createOutputData(result))
            }
        } catch (e: Exception) {
            Timber.e(e, "Error during background scan")
            Result.failure(
                workDataOf(
                    OUTPUT_RESULT to "error",
                    "error_message" to (e.message ?: "Unknown error")
                )
            )
        }
    }

    /**
     * Perform full scan of all media files
     */
    private suspend fun performFullScan(): ScanResult {
        return try {
            val result = mediaStoreScanner.scanAllFiles()

            if (result.isSuccess) {
                val totalFiles = result.getOrNull() ?: 0
                ScanResult(
                    success = true,
                    totalFiles = totalFiles,
                    scanMode = SCAN_MODE_FULL
                )
            } else {
                ScanResult(
                    success = false,
                    error = result.exceptionOrNull()?.message ?: "Scan failed",
                    scanMode = SCAN_MODE_FULL
                )
            }
        } catch (e: Exception) {
            ScanResult(
                success = false,
                error = e.message ?: "Unknown error",
                scanMode = SCAN_MODE_FULL
            )
        }
    }

    /**
     * Perform incremental scan (only new/modified files)
     */
    private suspend fun performIncrementalScan(): ScanResult {
        return try {
            // Check if update is needed (1 hour threshold)
            if (!incrementalUpdateManager.isUpdateNeeded(threshold = 3600_000L)) {
                Timber.d("Incremental update not needed yet")
                return ScanResult(
                    success = true,
                    totalFiles = 0,
                    scanMode = SCAN_MODE_INCREMENTAL,
                    skipped = true
                )
            }

            val result = incrementalUpdateManager.performIncrementalUpdate()

            ScanResult(
                success = result.isSuccess,
                totalFiles = result.totalProcessed,
                newFiles = result.newFilesCount,
                modifiedFiles = result.modifiedFilesCount,
                deletedFiles = result.deletedFilesCount,
                error = result.error,
                scanMode = SCAN_MODE_INCREMENTAL
            )
        } catch (e: Exception) {
            ScanResult(
                success = false,
                error = e.message ?: "Unknown error",
                scanMode = SCAN_MODE_INCREMENTAL
            )
        }
    }

    /**
     * Create output data from scan result
     */
    private fun createOutputData(result: ScanResult): Data {
        return workDataOf(
            OUTPUT_RESULT to if (result.success) "success" else "failure",
            "scan_mode" to result.scanMode,
            "total_files" to result.totalFiles,
            "new_files" to result.newFiles,
            "modified_files" to result.modifiedFiles,
            "deleted_files" to result.deletedFiles,
            "skipped" to result.skipped
        ).also { data ->
            result.error?.let { error ->
                Data.Builder()
                    .putAll(data)
                    .putString("error_message", error)
                    .build()
            }
        }
    }

    /**
     * Result of scan operation
     */
    private data class ScanResult(
        val success: Boolean,
        val totalFiles: Int = 0,
        val newFiles: Int = 0,
        val modifiedFiles: Int = 0,
        val deletedFiles: Int = 0,
        val error: String? = null,
        val scanMode: String,
        val skipped: Boolean = false
    ) {
        val isSuccess: Boolean
            get() = success && error == null
    }
}
