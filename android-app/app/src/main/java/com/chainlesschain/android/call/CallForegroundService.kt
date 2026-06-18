package com.chainlesschain.android.call

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.chainlesschain.android.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * FAMILY-67 通话前台服务（P3）。仅在通话进入 CONNECTING/ACTIVE（接听后，麦克风权限已授）时由
 * [AndroidCallServiceLauncher] 启动，保证锁屏/后台/熄屏期间麦克风采集不被系统杀。
 *
 * 类型 microphone(+camera 视频)。启动前已请求权限，避免 Android 14 媒体型前台服务无权限崩溃。
 * 观察 [CallManager.callState]：结束→stopSelf；ongoing 通知带「挂断」。
 */
@AndroidEntryPoint
class CallForegroundService : Service() {

    @Inject lateinit var callManager: CallManager

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val session = callManager.callState.value
        startForegroundCompat(buildNotification(session))

        scope.launch {
            callManager.callState.collect { s ->
                if (s == null || s.state.isTerminal) {
                    stopSelfSafe()
                } else {
                    runCatching {
                        val mgr = getSystemService(android.app.NotificationManager::class.java)
                        mgr?.notify(CallNotifications.NOTIFICATION_ID, buildNotification(s))
                    }
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun startForegroundCompat(notif: Notification) {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                if (callManager.callState.value?.media == CallMediaType.VIDEO) {
                    type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                }
                startForeground(CallNotifications.NOTIFICATION_ID, notif, type)
            } else {
                startForeground(CallNotifications.NOTIFICATION_ID, notif)
            }
        }.onFailure {
            Timber.w(it, "[CallFGS] startForeground failed — fallback plain")
            runCatching { startForeground(CallNotifications.NOTIFICATION_ID, notif) }
        }
    }

    private fun buildNotification(session: CallSession?): Notification {
        CallNotifications.ensureChannel(this)
        val title = when (session?.media) {
            CallMediaType.VIDEO -> "视频通话"
            else -> "语音通话"
        }
        val text = if (session?.state == CallState.ACTIVE) "通话中" else "连接中…"

        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val hangup = PendingIntent.getBroadcast(
            this, 3,
            Intent(this, CallActionReceiver::class.java).setAction(CallNotifications.ACTION_HANGUP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(this, CallNotifications.CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setUsesChronometer(session?.state == CallState.ACTIVE)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "挂断", hangup)
            .build()
    }

    private fun stopSelfSafe() {
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        fun start(context: Context) {
            val intent = Intent(context, CallForegroundService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            }.onFailure { Timber.w(it, "[CallFGS] start failed") }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallForegroundService::class.java)) }
        }
    }
}
