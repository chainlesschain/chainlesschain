package com.chainlesschain.android.remote.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.chainlesschain.android.remote.commands.NotificationCommands
import com.chainlesschain.android.remote.commands.NotificationReceivedEvent
import com.chainlesschain.android.remote.events.RemoteEventDispatcher
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 本地通知管理器
 *
 * 管理Android本地通知显示，处理来自PC的通知推送
 */
@Singleton
class LocalNotificationManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val notificationCommands: NotificationCommands,
    private val eventDispatcher: RemoteEventDispatcher
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val notificationManager = NotificationManagerCompat.from(context)

    companion object {
        const val CHANNEL_ID_PC_NOTIFICATIONS = "pc_notifications"
        const val CHANNEL_NAME = "PC Notifications"
        const val CHANNEL_DESCRIPTION = "Notifications synced from PC"

        const val CHANNEL_ID_WORKFLOW = "workflow_notifications"
        const val CHANNEL_NAME_WORKFLOW = "Workflow Updates"
        const val CHANNEL_DESCRIPTION_WORKFLOW = "Workflow execution status updates"
    }

    // Notification state
    private val _unreadCount = MutableStateFlow(0)
    val unreadCount: StateFlow<Int> = _unreadCount.asStateFlow()

    private val _notificationsEnabled = MutableStateFlow(true)
    val notificationsEnabled: StateFlow<Boolean> = _notificationsEnabled.asStateFlow()

    private var notificationIdCounter = 1000

    init {
        createNotificationChannels()
        startListening()
    }

    private fun createNotificationChannels() {
        // PC notifications channel
        val pcChannel = NotificationChannel(
            CHANNEL_ID_PC_NOTIFICATIONS,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = CHANNEL_DESCRIPTION
        }

        // Workflow notifications channel
        val workflowChannel = NotificationChannel(
            CHANNEL_ID_WORKFLOW,
            CHANNEL_NAME_WORKFLOW,
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = CHANNEL_DESCRIPTION_WORKFLOW
        }

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return
        manager.createNotificationChannel(pcChannel)
        manager.createNotificationChannel(workflowChannel)

        Timber.d("Notification channels created")
    }

    private fun startListening() {
        // Listen for notifications from PC
        scope.launch {
            eventDispatcher.notificationReceived.collect { event ->
                if (_notificationsEnabled.value) {
                    showNotification(event)
                }
            }
        }

        // Listen for workflow progress
        scope.launch {
            eventDispatcher.workflowProgress.collect { event ->
                // Show progress notification for long-running workflows
                if (event.progress > 0 && event.progress < 100) {
                    showWorkflowProgressNotification(
                        workflowId = event.workflowId,
                        workflowName = event.workflowName,
                        progress = event.progress,
                        currentStep = event.currentStep
                    )
                }
            }
        }

        // Listen for workflow completion
        scope.launch {
            eventDispatcher.workflowCompleted.collect { event ->
                showWorkflowCompletedNotification(
                    workflowName = event.workflowName,
                    success = event.success,
                    error = event.error
                )
            }
        }
    }

    /**
     * Check if notifications are allowed
     */
    fun hasNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    /**
     * Enable or disable notifications
     */
    fun setNotificationsEnabled(enabled: Boolean) {
        _notificationsEnabled.value = enabled
    }

    /**
     * Show a notification from PC
     */
    private fun showNotification(event: NotificationReceivedEvent) {
        if (!hasNotificationPermission()) {
            Timber.w("No notification permission, skipping notification")
            return
        }

        val notificationId = notificationIdCounter++

        val builder = NotificationCompat.Builder(context, CHANNEL_ID_PC_NOTIFICATIONS)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(event.title)
            .setContentText(event.body)
            .setPriority(getPriority(event.priority))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)

        // Set big text style for longer messages
        if (event.body.length > 50) {
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(event.body))
        }

        try {
            notificationManager.notify(notificationId, builder.build())
            refreshUnreadCount()
            Timber.d("Notification shown: ${event.title}")
        } catch (e: SecurityException) {
            Timber.e(e, "Failed to show notification - permission denied")
        }
    }

    /**
     * Show workflow progress notification
     */
    private fun showWorkflowProgressNotification(
        workflowId: String,
        workflowName: String,
        progress: Int,
        currentStep: String?
    ) {
        if (!hasNotificationPermission()) return

        val notificationId = workflowId.hashCode()

        val builder = NotificationCompat.Builder(context, CHANNEL_ID_WORKFLOW)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Running: $workflowName")
            .setContentText(currentStep ?: "Executing...")
            .setProgress(100, progress, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)

        try {
            notificationManager.notify(notificationId, builder.build())
        } catch (e: SecurityException) {
            Timber.e(e, "Failed to show workflow progress notification")
        }
    }

    /**
     * Show workflow completed notification
     */
    private fun showWorkflowCompletedNotification(
        workflowName: String,
        success: Boolean,
        error: String?
    ) {
        if (!hasNotificationPermission()) return

        val notificationId = workflowName.hashCode()

        // Cancel the progress notification
        notificationManager.cancel(notificationId)

        val builder = NotificationCompat.Builder(context, CHANNEL_ID_WORKFLOW)
            .setSmallIcon(
                if (success) android.R.drawable.ic_dialog_info
                else android.R.drawable.ic_dialog_alert
            )
            .setContentTitle(
                if (success) "Completed: $workflowName"
                else "Failed: $workflowName"
            )
            .setContentText(
                if (success) "Workflow executed successfully"
                else error ?: "An error occurred"
            )
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)

        try {
            val completedNotificationId = (workflowName + "_completed").hashCode()
            notificationManager.notify(completedNotificationId, builder.build())
        } catch (e: SecurityException) {
            Timber.e(e, "Failed to show workflow completion notification")
        }
    }

    /**
     * Send a notification to PC
     */
    suspend fun sendToPC(
        title: String,
        body: String,
        priority: String = "normal"
    ): Result<Unit> {
        return notificationCommands.send(
            title = title,
            body = body
        ).map {
            Timber.d("Notification sent to PC: $title")
        }
    }

    /**
     * Refresh unread count from data source
     */
    private fun refreshUnreadCount() {
        scope.launch {
            try {
                val result = notificationCommands.getUnreadCount()
                result.onSuccess { response ->
                    _unreadCount.value = response.unreadCount
                }.onFailure {
                    // Fallback: increment locally if query fails
                    _unreadCount.value++
                }
            } catch (e: Exception) {
                // Fallback: increment locally if query fails
                _unreadCount.value++
                Timber.w(e, "Failed to refresh unread count, using local increment")
            }
        }
    }

    /**
     * Clear unread count
     */
    fun clearUnreadCount() {
        _unreadCount.value = 0
    }

    /**
     * Cancel all notifications
     */
    fun cancelAll() {
        notificationManager.cancelAll()
        _unreadCount.value = 0
    }

    private fun getPriority(priority: String): Int {
        return when (priority.lowercase()) {
            "low" -> NotificationCompat.PRIORITY_LOW
            "high" -> NotificationCompat.PRIORITY_HIGH
            "urgent" -> NotificationCompat.PRIORITY_MAX
            else -> NotificationCompat.PRIORITY_DEFAULT
        }
    }
}
