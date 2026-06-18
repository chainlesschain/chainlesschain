package com.chainlesschain.android.call

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-67 [CallServiceLauncher] 的 Android 实现（P3）。
 *
 * - **来电（INCOMING）**：高优先级全屏通知（[NotificationCompat.Builder.setFullScreenIntent] → [CallActivity]，
 *   锁屏/熄屏自动点亮拉起）+ 接听/拒接动作。不起前台服务（麦克风此时未采集，避开 Android 14 无权限崩溃）。
 * - **去电（OUTGOING/RINGING）**：普通进行中通知（挂断）。
 * - **接通（CONNECTING/ACTIVE）**：启动 [CallForegroundService]（microphone(+camera)），保锁屏/后台麦克风不被杀。
 * - **结束**：撤通知 + 停服务。
 */
@Singleton
class AndroidCallServiceLauncher @Inject constructor(
    @ApplicationContext private val context: Context,
    private val ringer: CallRinger,
) : CallServiceLauncher {

    private val nm: NotificationManager? =
        context.getSystemService(NotificationManager::class.java)

    override fun onCall(session: CallSession) {
        when (session.state) {
            CallState.INCOMING -> { ringer.startRinging(); notifyIncoming(session) }
            CallState.OUTGOING, CallState.OUTGOING_RINGING -> { ringer.startRingback(); notifyOutgoing(session) }
            CallState.CONNECTING, CallState.ACTIVE -> { ringer.stop(); CallForegroundService.start(context) }
            else -> { ringer.stop() /* ENDED/IDLE → clear() 负责 */ }
        }
    }

    override fun clear() {
        ringer.stop()
        runCatching { nm?.cancel(CallNotifications.NOTIFICATION_ID) }
        CallForegroundService.stop(context)
    }

    @SuppressLint("MissingPermission")
    private fun notifyIncoming(session: CallSession) {
        CallNotifications.ensureChannel(context)
        val mediaLabel = if (session.media == CallMediaType.VIDEO) "视频通话" else "语音通话"

        val fullScreen = PendingIntent.getActivity(
            context, 10,
            Intent(context, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val accept = PendingIntent.getBroadcast(
            context, 11,
            Intent(context, CallActionReceiver::class.java).setAction(CallNotifications.ACTION_ACCEPT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val reject = PendingIntent.getBroadcast(
            context, 12,
            Intent(context, CallActionReceiver::class.java).setAction(CallNotifications.ACTION_REJECT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notif = NotificationCompat.Builder(context, CallNotifications.CHANNEL_ID)
            .setContentTitle("$mediaLabel 来电")
            .setContentText(shortDid(session.peerDid))
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "拒接", reject)
            .addAction(android.R.drawable.ic_menu_call, "接听", accept)
            .build()
        runCatching { nm?.notify(CallNotifications.NOTIFICATION_ID, notif) }
            .onFailure { Timber.w(it, "[CallLauncher] notifyIncoming failed") }
    }

    @SuppressLint("MissingPermission")
    private fun notifyOutgoing(session: CallSession) {
        CallNotifications.ensureChannel(context)
        val mediaLabel = if (session.media == CallMediaType.VIDEO) "视频通话" else "语音通话"
        val open = PendingIntent.getActivity(
            context, 13,
            Intent(context, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val hangup = PendingIntent.getBroadcast(
            context, 14,
            Intent(context, CallActionReceiver::class.java).setAction(CallNotifications.ACTION_HANGUP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notif = NotificationCompat.Builder(context, CallNotifications.CHANNEL_ID)
            .setContentTitle("$mediaLabel 呼叫中")
            .setContentText(shortDid(session.peerDid))
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "挂断", hangup)
            .build()
        runCatching { nm?.notify(CallNotifications.NOTIFICATION_ID, notif) }
    }

    private fun shortDid(did: String): String =
        if (did.length <= 22) did else did.take(14) + "…" + did.takeLast(6)
}
