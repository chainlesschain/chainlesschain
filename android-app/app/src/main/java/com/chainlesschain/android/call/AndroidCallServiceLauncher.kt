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
            CallState.ENDED -> { ringer.stop(); maybeNotifyMissed(session) }
            else -> { ringer.stop() /* IDLE → clear() 负责 */ }
        }
    }

    /** 未接来电（来电、从未接通、对端放弃或超时；非我方拒接/挂断）→ 发持久「未接来电」通知。 */
    private fun maybeNotifyMissed(session: CallSession) {
        val missed = session.direction == CallDirection.INCOMING &&
            session.connectedAtMs == 0L &&
            (session.endReason == CallEndReason.REMOTE_HANGUP || session.endReason == CallEndReason.TIMEOUT_NO_ANSWER)
        if (!missed) return
        CallNotifications.ensureChannel(context)
        val mediaLabel = if (session.media == CallMediaType.VIDEO) "视频通话" else "语音通话"
        val open = PendingIntent.getActivity(
            context, 20,
            (context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: Intent(context, CallActivity::class.java))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notif = NotificationCompat.Builder(context, CallNotifications.CHANNEL_ID)
            .setContentTitle("未接$mediaLabel")
            .setContentText(shortDid(session.peerDid))
            .setSmallIcon(android.R.drawable.sym_call_missed)
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        runCatching { nm?.notify(CallNotifications.MISSED_NOTIFICATION_ID, notif) }
            .onFailure { Timber.w(it, "[CallLauncher] notifyMissed failed") }
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

        // CallStyle.forIncomingCall：系统级来电样式，锁屏/熄屏/通知栏都渲染醒目的「接听/拒绝」按钮
        // （即便 Android 14+ 全屏 intent 被降级为 heads-up，按钮仍在）。配合 setFullScreenIntent
        // 在已授权设备上直接拉起全屏 CallActivity（android:showWhenLocked/turnScreenOn 越锁屏）。
        val caller = androidx.core.app.Person.Builder()
            .setName("$mediaLabel · ${shortDid(session.peerDid)}")
            .setImportant(true)
            .build()
        val notif = NotificationCompat.Builder(context, CallNotifications.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("$mediaLabel 来电")
            .setContentText(shortDid(session.peerDid))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreen, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, reject, accept))
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
