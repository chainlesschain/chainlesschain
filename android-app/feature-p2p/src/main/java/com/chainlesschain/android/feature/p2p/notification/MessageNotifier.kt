package com.chainlesschain.android.feature.p2p.notification

import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.os.Process
import androidx.core.app.NotificationCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-67 好友消息通知。被叫端收到 P2P 消息（[com.chainlesschain.android.feature.p2p.repository.
 * P2PMessageRepository.saveMessageFromSync]）时弹通知，提示有新消息。
 *
 * 仅在 app **不在前台**时弹（前台时用户正在用、由聊天页实时展示，不打扰）。点击打开 app。
 * 每个对端独立通知（id=peerId.hashCode），多人来消息可堆叠。
 */
@Singleton
class MessageNotifier @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val nm: NotificationManager? = context.getSystemService(NotificationManager::class.java)

    fun notifyIncoming(peerId: String, content: String) {
        if (isAppForeground()) return // 前台不打扰
        ensureChannel()
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.apply { putExtra(EXTRA_OPEN_CHAT_PEER, peerId) }
        val pi = PendingIntent.getActivity(
            context, peerId.hashCode(),
            launch ?: return,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val preview = content.take(80).ifBlank { "[新消息]" }
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("好友消息 · ${shortDid(peerId)}")
            .setContentText(preview)
            .setStyle(NotificationCompat.BigTextStyle().bigText(preview))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        runCatching { nm?.notify(NOTIF_BASE + (peerId.hashCode() and 0xFFFF), notif) }
            .onFailure { Timber.w(it, "[MessageNotifier] notify failed") }
    }

    private fun isAppForeground(): Boolean = runCatching {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        am.runningAppProcesses?.firstOrNull { it.pid == Process.myPid() }?.importance ==
            ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }.getOrDefault(false)

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = nm ?: return
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "好友消息", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "好友 P2P 加密消息新消息提醒"
            },
        )
    }

    private fun shortDid(did: String): String =
        if (did.length <= 18) did else did.take(12) + "…" + did.takeLast(4)

    companion object {
        const val CHANNEL_ID = "p2p_messages"
        const val NOTIF_BASE = 9200
        const val EXTRA_OPEN_CHAT_PEER = "open_chat_peer"
    }
}
