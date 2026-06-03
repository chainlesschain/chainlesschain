package com.chainlesschain.android.feature.familyguard.boot

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * AlarmManager 保活定时器 (FAMILY-19).
 *
 * 主文档 §3.1 v0.2 + spike 3 §5.1 多重保活栈第 2 层. 每 [INTERVAL_MS] 触发一次
 * KeepAliveReceiver, 后者:
 *   1. 拉起 FamilyGuardForegroundService (若被系统杀)
 *   2. 调 StartupReconciler.reconcile() 处理过期 unbind / 恢复 freeze
 *
 * 用 inexact repeating 避开 Android 12+ SCHEDULE_EXACT_ALARM 权限; 业务可
 * 接受 ±10min 偏差 (Worker 频率即半小时一次, 不要求精准)。
 *
 * setInexactRepeating 是 deprecated API 但仍是兼容性最广的方案; WorkManager
 * Periodic 在 Doze 下也会有延迟, 二者效果相当 (见 [[android_wechat_collector_phase_12_10]]
 * 自启拉活模式参考)。
 */
@Singleton
class KeepAliveScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    fun schedule() {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: run {
            Timber.w("AlarmManager not available; KeepAliveScheduler cannot schedule")
            return
        }
        val triggerAtMillis = SystemClock.elapsedRealtime() + INTERVAL_MS
        alarmManager.setInexactRepeating(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            triggerAtMillis,
            INTERVAL_MS,
            pendingIntent(),
        )
        Timber.i("KeepAliveScheduler.schedule next=$triggerAtMillis interval=$INTERVAL_MS")
    }

    fun cancel() {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        alarmManager.cancel(pendingIntent())
        Timber.i("KeepAliveScheduler.cancel")
    }

    private fun pendingIntent(): PendingIntent {
        val intent = Intent(context, KeepAliveReceiver::class.java).apply {
            action = ACTION_KEEP_ALIVE
        }
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    companion object {
        /** 30 min — 主文档 §3.1 推荐节奏; doze 下可能延后到 60min. */
        const val INTERVAL_MS: Long = 30L * 60L * 1000L
        const val ACTION_KEEP_ALIVE = "com.chainlesschain.android.familyguard.KEEP_ALIVE"
        private const val REQUEST_CODE = 9201
    }
}
