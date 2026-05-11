package com.chainlesschain.android.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.chainlesschain.android.MainActivity
import com.chainlesschain.android.R
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 中心化通知调度。M3 D3 PushNotifier 核心。
 *
 * 流程：FCM RemoteMessage → [FcmRemoteMessageParser] → [NotificationPayload] → 本类 dispatch →
 *      [renderPayload] → NotificationManagerCompat.notify。
 *
 * 通道：[ensureChannels] 必须在每次 dispatch 前调（幂等），创建 [NotificationCategory] 4 个
 *      channel。Android 8.0+ 否则通知被静默丢。
 *
 * 点击：每条通知用 [renderPayload] 的 deepLink 构造 PendingIntent 回 MainActivity 带 data
 *      URI；MainActivity 路由层（v1.0 follow-up）按 host 派发到对应 screen。
 */
@Singleton
class NotificationCenter @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val mgrCompat by lazy { NotificationManagerCompat.from(context) }

    /** 创建 4 个 channel（幂等），dispatch 前必须调过一次。 */
    fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val sysMgr = context.getSystemService(NotificationManager::class.java) ?: return
        for (cat in NotificationCategory.values()) {
            if (sysMgr.getNotificationChannel(cat.channelId) != null) continue
            val ch = NotificationChannel(cat.channelId, cat.displayName, cat.importance).apply {
                description = cat.description
            }
            sysMgr.createNotificationChannel(ch)
        }
    }

    /** 发送通知。返回 notificationId（用 [renderPayload] 的稳定 hash）。 */
    fun dispatch(payload: NotificationPayload): Int {
        ensureChannels()
        val rendered = renderPayload(payload)
        val notif = buildNotification(rendered)

        // POST_NOTIFICATIONS 已在 Manifest 声明；Android 13+ 运行时拒绝时 mgr.notify 静默
        // no-op，不抛异常。SecurityException 仅在某些 OEM ROM 出现，用 runCatching 兜。
        runCatching { mgrCompat.notify(rendered.notificationId, notif) }
            .onFailure { Timber.w(it, "NotificationCenter.dispatch: notify failed") }
        return rendered.notificationId
    }

    private fun buildNotification(rendered: NotificationRender): android.app.Notification {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            rendered.deepLink?.let { data = Uri.parse(it) }
        }
        val pending = PendingIntent.getActivity(
            context,
            rendered.notificationId,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(context, rendered.category.channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(rendered.title)
            .setContentText(rendered.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(rendered.body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(categoryToPriority(rendered.category))
            .build()
    }

    private fun categoryToPriority(category: NotificationCategory): Int = when (category.importance) {
        NotificationManager.IMPORTANCE_HIGH -> NotificationCompat.PRIORITY_HIGH
        NotificationManager.IMPORTANCE_LOW -> NotificationCompat.PRIORITY_LOW
        NotificationManager.IMPORTANCE_MIN -> NotificationCompat.PRIORITY_MIN
        else -> NotificationCompat.PRIORITY_DEFAULT
    }
}
