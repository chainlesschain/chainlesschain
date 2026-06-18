package com.chainlesschain.android.call

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/** FAMILY-67 通话通知/Intent 常量 + 渠道（P3）。 */
object CallNotifications {
    const val CHANNEL_ID = "call_incoming"
    const val NOTIFICATION_ID = 9101

    const val ACTION_ACCEPT = "com.chainlesschain.android.call.ACCEPT"
    const val ACTION_REJECT = "com.chainlesschain.android.call.REJECT"
    const val ACTION_HANGUP = "com.chainlesschain.android.call.HANGUP"

    /** 高优先级渠道（来电响铃/全屏 intent）。 */
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = context.getSystemService(NotificationManager::class.java) ?: return
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(
            CHANNEL_ID,
            "通话",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "好友 P2P 语音/视频通话来电与通话中通知"
            setShowBadge(false)
            enableVibration(true)
            setBypassDnd(true)
        }
        mgr.createNotificationChannel(ch)
    }
}
