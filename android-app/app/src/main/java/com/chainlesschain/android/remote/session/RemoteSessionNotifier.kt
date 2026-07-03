package com.chainlesschain.android.remote.session

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
import com.chainlesschain.android.MainActivity
import org.json.JSONObject

/**
 * Posts an OS-level notification when the host asks the paired device to approve
 * a tool/command. Self-contained (no Hilt) to match the Remote Session feature's
 * standalone ViewModel wiring; tapping the notification opens the app so the
 * user can approve or reject on the Remote Session screen.
 */
class RemoteSessionNotifier(private val context: Context) {

    private val manager = NotificationManagerCompat.from(context)

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Remote approvals",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Approval requests from a paired coding session"
            }
            val system = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            system?.createNotificationChannel(channel)
        }
    }

    /** Returns true if an approval notification was actually posted. */
    fun notifyApproval(event: JSONObject): Boolean {
        if (!hasPermission()) return false
        val requestId = event.optString("requestId", event.optString("approvalId"))
        val body = event.optString(
            "content",
            event.optJSONObject("payload")?.optString("content") ?: "A remote session needs your approval",
        )

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_OPEN_REMOTE_SESSION, true)
        }
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val contentIntent = PendingIntent.getActivity(
            context,
            requestId.hashCode(),
            intent,
            pendingFlags,
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Approval requested")
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)

        return try {
            manager.notify(notificationIdFor(requestId), builder.build())
            true
        } catch (_: SecurityException) {
            false
        }
    }

    fun cancel(requestId: String) {
        manager.cancel(notificationIdFor(requestId))
    }

    private fun notificationIdFor(requestId: String): Int =
        if (requestId.isBlank()) BASE_NOTIFICATION_ID else BASE_NOTIFICATION_ID + (requestId.hashCode() and 0xFFFF)

    private fun hasPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

    companion object {
        const val CHANNEL_ID = "remote_session_approvals"
        const val EXTRA_OPEN_REMOTE_SESSION = "open_remote_session"
        private const val BASE_NOTIFICATION_ID = 42000
    }
}
