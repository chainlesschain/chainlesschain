package com.chainlesschain.android.capture.location

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import timber.log.Timber
import javax.inject.Inject

/**
 * 位置采集前台服务（M3 D2）。设计文档 §5.3 LocationTagger：「LocationTagger 部分 M3 D-loc
 * be6cb4974（JVM-testable parts 已落）；剩 ACCESS_FINE_LOCATION 权限 + GPS provider 接线 +
 * 笔记元数据写入」。
 *
 * 责任：宿主一个常驻 [LocationTagger] 实例，保证锁屏/熄屏期间也能拿到位置更新（前台服务
 * 类型 location）。
 *
 * 启动：从 UI（Settings / 用户主动开启）调 [start]；停止：调 [stop] 或 onTaskRemoved。
 *
 * 注意：Foreground Service 通知是必须的（Android 8+），即使没有用户可见的 UI。本服务用极简
 * 通知（图标 + "位置采集中"），点击回 MainActivity；用户可点系统通知"停止"按钮停止。
 */
@AndroidEntryPoint
class LocationForegroundService : Service() {

    @Inject lateinit var locationTagger: LocationTagger

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Timber.i("LocationForegroundService.onStartCommand: action=${intent?.action}")
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelfSafe()
                return START_NOT_STICKY
            }
            else -> startForegroundWithNotification()
        }

        when (locationTagger.start()) {
            LocationTagger.State.PermissionRequired -> {
                Timber.w("LocationForegroundService: permission missing — self-stop")
                stopSelfSafe()
            }
            LocationTagger.State.HardwareUnavailable -> {
                Timber.w("LocationForegroundService: hardware unavailable — self-stop")
                stopSelfSafe()
            }
            else -> Unit
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelfSafe()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        Timber.i("LocationForegroundService.onDestroy")
        locationTagger.stop()
        scope.cancel()
        super.onDestroy()
    }

    private fun startForegroundWithNotification() {
        ensureNotificationChannel(this)
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, LocationForegroundService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notif: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("位置采集中")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .setSilent(true)
            .addAction(0, "停止", stopIntent)
            .build()

        startForeground(NOTIFICATION_ID, notif)
    }

    private fun stopSelfSafe() {
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        stopSelf()
    }

    companion object {
        const val CHANNEL_ID = "location_capture"
        const val NOTIFICATION_ID = 9001
        const val ACTION_STOP = "com.chainlesschain.android.location.STOP"

        /** 从 UI 调起：context.startForegroundService(start(context))。 */
        fun start(context: Context): Intent =
            Intent(context, LocationForegroundService::class.java)

        /** 从 UI 调起：context.startService(stop(context))。 */
        fun stop(context: Context): Intent =
            Intent(context, LocationForegroundService::class.java).setAction(ACTION_STOP)

        fun ensureNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
            val ch = NotificationChannel(
                CHANNEL_ID,
                "位置采集",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "M3 D2 LocationTagger 后台位置采集服务通知"
                setShowBadge(false)
            }
            mgr.createNotificationChannel(ch)
        }
    }
}
