package com.chainlesschain.android.feature.familyguard.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyGuardState
import com.chainlesschain.android.feature.familyguard.domain.model.NotificationChannels

/**
 * 纯渲染层 (FAMILY-05): 把 [FamilyGuardState] 映射成 [Notification], 不持有任何
 * Android 服务生命周期; 让单测可注入 Context 拼装 channel 然后断言通知 extras。
 *
 * Channel 注册幂等; [ensureChannelsCreated] 多次调用安全 (生产代码每次 startForeground
 * 之前都调一次, 保证手动清除通知后下次启动仍有 channel)。
 */
object FamilyGuardNotificationFactory {

    const val NOTIFICATION_ID = 9101 // 与 LocationForegroundService 9001 不冲突

    /**
     * Build a [Notification] for the given [state]. Always uses [state.channelId] —
     * 切换 state 需要先 cancel 旧通知 (因为 channel 是不可变 metadata) 再 re-post,
     * 这一步在 Service 层 ([FamilyGuardForegroundService.startForegroundForState]) 处理。
     */
    fun build(
        context: Context,
        state: FamilyGuardState,
        contentIntent: PendingIntent?,
    ): Notification {
        ensureChannelsCreated(context)
        val builder = NotificationCompat.Builder(context, state.channelId)
            .setContentTitle("家庭守护")
            .setContentText(state.displayText())
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            // 用户不可滑掉; Android 14+ 仍允许侧滑但本服务自启拉活 (FAMILY-19) 会重新 post。
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .also { b -> contentIntent?.let { b.setContentIntent(it) } }

        when (state) {
            FamilyGuardState.IDLE,
            FamilyGuardState.MONITORING -> builder
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setSilent(true)

            FamilyGuardState.OBSERVING -> builder
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setColor(Color.parseColor("#FF1744")) // material red A400
                .setColorized(true)
                .setCategory(NotificationCompat.CATEGORY_STATUS)

            FamilyGuardState.URGENT -> builder
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setColor(Color.parseColor("#D50000")) // material red A700
                .setColorized(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        }

        return builder.build()
    }

    /**
     * 注册 LOW + HIGH 两个 channel; 幂等。Android 8+ 才有 channel 概念,
     * minSdk=28 所以无需 SDK 检查 (但保留 Build.VERSION 守卫便于将来 minSdk 降级)。
     */
    fun ensureChannelsCreated(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = context.getSystemService(NotificationManager::class.java) ?: return

        if (mgr.getNotificationChannel(NotificationChannels.STATUS_LOW) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    NotificationChannels.STATUS_LOW,
                    "家庭守护状态",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "持久显示家庭守护是否在运行 (待机 / 监管中)"
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                },
            )
        }
        if (mgr.getNotificationChannel(NotificationChannels.ALERT_HIGH) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    NotificationChannels.ALERT_HIGH,
                    "家庭守护警示",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "旁观中 / 紧急联络中, 即使勿扰模式也要可见"
                    setShowBadge(true)
                    setBypassDnd(true)
                    enableLights(true)
                    enableVibration(true)
                },
            )
        }
    }

    /**
     * 切 state 前需要 cancel 旧通知避免 channel mis-match (Android 14 严格);
     * Service 层调用入口。
     */
    fun cancelExisting(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        context.getSystemService(NotificationManager::class.java)
            ?.cancel(NOTIFICATION_ID)
    }

    /**
     * Service 层标准 PendingIntent (点通知回主 app); :feature-family-guard 不直接
     * import :app 的 MainActivity, 因此让调用方传入。
     */
    fun openAppIntent(
        context: Context,
        target: Class<*>,
    ): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, target).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        },
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}
