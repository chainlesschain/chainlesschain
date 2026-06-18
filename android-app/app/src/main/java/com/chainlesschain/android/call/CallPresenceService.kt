package com.chainlesschain.android.call

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.chainlesschain.android.R
import com.chainlesschain.android.sync.FriendSyncConnector
import dagger.Lazy
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * FAMILY-67「保持在线接听」前台服务（P3+）。
 *
 * 通话来电信令走信令服务器长连接，而长连接只在进程存活时保持。本服务作为前台服务保活进程
 * （系统内存回收不杀前台服务）并**周期重新 ensureConnected**（[FriendSyncConnector.ensureConnected]
 * 幂等：已连直接返回，掉线则重连+重注册）→ app 退到后台 / 熄屏时仍能收到来电（CallManager 单例的
 * 信令订阅随进程存活）。
 *
 * 限制：被「强行停止」/系统重启后未再打开 app 则失效；Android 14 dataSync 前台服务有每日时长上限。
 * 用户可在通知「停止」关闭（持久化 opt-out，下次不自动起）。
 */
@AndroidEntryPoint
class CallPresenceService : Service() {

    @Inject lateinit var friendSyncConnector: Lazy<FriendSyncConnector>

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            setEnabled(this, false)
            stopSelfSafe()
            return START_NOT_STICKY
        }
        startForegroundCompat()
        scope.launch {
            while (isActive) {
                runCatching { friendSyncConnector.get().ensureConnected() }
                    .onFailure { Timber.w(it, "[CallPresence] ensureConnected failed") }
                delay(REENSURE_INTERVAL_MS)
            }
        }
        Timber.i("[CallPresence] online-for-calls service started")
        return START_STICKY
    }

    private fun startForegroundCompat() {
        ensureChannel(this)
        val open = PendingIntent.getActivity(
            this, 0,
            (packageManager.getLaunchIntentForPackage(packageName) ?: Intent())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, CallPresenceService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notif: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("保持在线 · 可接听好友来电")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .addAction(0, "停止", stop)
            .build()
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, notif)
            }
        }.onFailure {
            Timber.w(it, "[CallPresence] startForeground failed")
            runCatching { startForeground(NOTIFICATION_ID, notif) }
        }
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
        const val CHANNEL_ID = "call_presence"
        const val NOTIFICATION_ID = 9103
        const val ACTION_STOP = "com.chainlesschain.android.call.PRESENCE_STOP"
        const val REENSURE_INTERVAL_MS = 45_000L

        private const val PREFS = "call_presence"
        private const val KEY_ENABLED = "enabled"

        /** 默认开启；用户从通知「停止」后持久化为关闭。 */
        fun isEnabled(context: Context): Boolean =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)

        fun setEnabled(context: Context, enabled: Boolean) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
        }

        /** 启动（若用户未 opt-out）。从 MainActivity 调。 */
        fun startIfEnabled(context: Context) {
            if (!isEnabled(context)) return
            val intent = Intent(context, CallPresenceService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            }.onFailure { Timber.w(it, "[CallPresence] start failed") }
        }

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "保持在线接听", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "保持信令在线以便后台接收好友来电"
                    setShowBadge(false)
                },
            )
        }
    }
}
