package com.chainlesschain.android.feature.p2p.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferStatus
import com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件传输通知管理器
 *
 * 管理文件传输的系统通知，支持：
 * - 传输进度显示
 * - 传输完成/失败通知
 * - 待接收请求通知
 * - 多传输同时进行的通知组
 */
@Singleton
class FileTransferNotificationManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val CHANNEL_ID_PROGRESS = "file_transfer_progress"
        private const val CHANNEL_ID_COMPLETE = "file_transfer_complete"
        private const val CHANNEL_ID_REQUEST = "file_transfer_request"

        private const val NOTIFICATION_GROUP = "com.chainlesschain.FILE_TRANSFER"

        // 通知ID范围
        private const val NOTIFICATION_ID_BASE_PROGRESS = 10000
        private const val NOTIFICATION_ID_BASE_COMPLETE = 20000
        private const val NOTIFICATION_ID_BASE_REQUEST = 30000
        private const val NOTIFICATION_ID_SUMMARY = 9999
    }

    private val notificationManager = NotificationManagerCompat.from(context)
    private val activeNotifications = mutableMapOf<String, Int>()
    private var nextNotificationId = NOTIFICATION_ID_BASE_PROGRESS

    init {
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // 进度通道（低优先级，静默）
            val progressChannel = NotificationChannel(
                CHANNEL_ID_PROGRESS,
                "文件传输进度",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "显示文件传输进度"
                setShowBadge(false)
            }

            // 完成通道（默认优先级）
            val completeChannel = NotificationChannel(
                CHANNEL_ID_COMPLETE,
                "文件传输完成",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "文件传输完成或失败通知"
            }

            // 请求通道（高优先级）
            val requestChannel = NotificationChannel(
                CHANNEL_ID_REQUEST,
                "文件传输请求",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "收到新的文件传输请求"
            }

            manager.createNotificationChannels(listOf(progressChannel, completeChannel, requestChannel))
        }
    }

    /**
     * 显示传输进度通知
     */
    fun showProgressNotification(
        transferId: String,
        fileName: String,
        progress: TransferProgress,
        isOutgoing: Boolean
    ) {
        val notificationId = getOrCreateNotificationId(transferId)
        val title = if (isOutgoing) "正在发送" else "正在接收"
        val progressPercent = progress.getProgressPercent().toInt()

        val notification = NotificationCompat.Builder(context, CHANNEL_ID_PROGRESS)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("$title: $fileName")
            .setContentText("${progress.getReadableSpeed()} · ${progress.getReadableEta()}")
            .setProgress(100, progressPercent, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setGroup(NOTIFICATION_GROUP)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        try {
            notificationManager.notify(notificationId, notification)
            updateSummaryNotification()
        } catch (e: SecurityException) {
            // 无通知权限
        }
    }

    /**
     * 显示传输完成通知
     */
    fun showCompletionNotification(
        transferId: String,
        fileName: String,
        success: Boolean,
        isOutgoing: Boolean,
        errorMessage: String? = null
    ) {
        // 移除进度通知
        cancelProgressNotification(transferId)

        val notificationId = NOTIFICATION_ID_BASE_COMPLETE + transferId.hashCode().and(0xFFFF)

        val (title, text, icon) = if (success) {
            val action = if (isOutgoing) "发送完成" else "接收完成"
            Triple(action, fileName, android.R.drawable.stat_sys_download_done)
        } else {
            val action = if (isOutgoing) "发送失败" else "接收失败"
            val message = errorMessage ?: "传输失败"
            Triple(action, "$fileName - $message", android.R.drawable.stat_notify_error)
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID_COMPLETE)
            .setSmallIcon(icon)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setGroup(NOTIFICATION_GROUP)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        try {
            notificationManager.notify(notificationId, notification)
            updateSummaryNotification()
        } catch (e: SecurityException) {
            // 无通知权限
        }
    }

    /**
     * 显示传输请求通知
     */
    fun showTransferRequestNotification(
        transferId: String,
        fileName: String,
        fileSize: String,
        senderName: String,
        acceptIntent: PendingIntent? = null,
        rejectIntent: PendingIntent? = null
    ) {
        val notificationId = NOTIFICATION_ID_BASE_REQUEST + transferId.hashCode().and(0xFFFF)

        val builder = NotificationCompat.Builder(context, CHANNEL_ID_REQUEST)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("收到文件")
            .setContentText("$senderName 想发送 $fileName ($fileSize)")
            .setAutoCancel(true)
            .setGroup(NOTIFICATION_GROUP)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)

        // 添加操作按钮
        acceptIntent?.let {
            builder.addAction(
                android.R.drawable.ic_menu_save,
                "接受",
                it
            )
        }

        rejectIntent?.let {
            builder.addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "拒绝",
                it
            )
        }

        try {
            notificationManager.notify(notificationId, builder.build())
        } catch (e: SecurityException) {
            // 无通知权限
        }
    }

    /**
     * 取消传输请求通知
     */
    fun cancelRequestNotification(transferId: String) {
        val notificationId = NOTIFICATION_ID_BASE_REQUEST + transferId.hashCode().and(0xFFFF)
        notificationManager.cancel(notificationId)
    }

    /**
     * 取消进度通知
     */
    fun cancelProgressNotification(transferId: String) {
        activeNotifications.remove(transferId)?.let { notificationId ->
            notificationManager.cancel(notificationId)
        }
        updateSummaryNotification()
    }

    /**
     * 取消所有传输通知
     */
    fun cancelAllNotifications() {
        activeNotifications.values.forEach { notificationId ->
            notificationManager.cancel(notificationId)
        }
        activeNotifications.clear()
        notificationManager.cancel(NOTIFICATION_ID_SUMMARY)
    }

    /**
     * 更新传输状态
     */
    fun updateTransferStatus(
        transferId: String,
        fileName: String,
        status: FileTransferStatus,
        isOutgoing: Boolean,
        errorMessage: String? = null
    ) {
        when (status) {
            FileTransferStatus.COMPLETED -> {
                showCompletionNotification(transferId, fileName, true, isOutgoing)
            }
            FileTransferStatus.FAILED, FileTransferStatus.CANCELLED, FileTransferStatus.REJECTED -> {
                showCompletionNotification(transferId, fileName, false, isOutgoing, errorMessage)
            }
            FileTransferStatus.PAUSED -> {
                showPausedNotification(transferId, fileName, isOutgoing)
            }
            else -> {
                // 其他状态不更新通知
            }
        }
    }

    private fun showPausedNotification(
        transferId: String,
        fileName: String,
        isOutgoing: Boolean
    ) {
        val notificationId = getOrCreateNotificationId(transferId)
        val title = if (isOutgoing) "发送已暂停" else "接收已暂停"

        val notification = NotificationCompat.Builder(context, CHANNEL_ID_PROGRESS)
            .setSmallIcon(android.R.drawable.ic_media_pause)
            .setContentTitle(title)
            .setContentText(fileName)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setGroup(NOTIFICATION_GROUP)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        try {
            notificationManager.notify(notificationId, notification)
        } catch (e: SecurityException) {
            // 无通知权限
        }
    }

    private fun getOrCreateNotificationId(transferId: String): Int {
        return activeNotifications.getOrPut(transferId) {
            nextNotificationId++
        }
    }

    private fun updateSummaryNotification() {
        if (activeNotifications.isEmpty()) {
            notificationManager.cancel(NOTIFICATION_ID_SUMMARY)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activeNotifications.size > 1) {
            val summary = NotificationCompat.Builder(context, CHANNEL_ID_PROGRESS)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("文件传输")
                .setContentText("${activeNotifications.size} 个传输进行中")
                .setGroup(NOTIFICATION_GROUP)
                .setGroupSummary(true)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()

            try {
                notificationManager.notify(NOTIFICATION_ID_SUMMARY, summary)
            } catch (e: SecurityException) {
                // 无通知权限
            }
        }
    }
}
