package com.chainlesschain.android.feature.familyguard.data.lifecycle

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.chainlesschain.android.feature.familyguard.boot.DataLifecycleReceiver
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.Calendar
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * 数据生命周期清理日调度器 (FAMILY-28). 主文档 §4.6 "每日 03:00 跑清理 Worker"。
 *
 * 用 [AlarmManager.setInexactRepeating] + RTC_WAKEUP + [AlarmManager.INTERVAL_DAY] 触发
 * [DataLifecycleReceiver] → [DataLifecycleCleaner]。与 KeepAliveScheduler 同理避开
 * Android 12+ SCHEDULE_EXACT_ALARM 权限 (清理可接受 ±小时偏差, doze 下顺延也无害,
 * 因 cleaner 幂等)。由 BootReceiver 在开机 / 保活路径调 [schedule]。
 */
@Singleton
class DataLifecycleScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    fun schedule() {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: run {
            Timber.w("AlarmManager unavailable; DataLifecycleScheduler cannot schedule")
            return
        }
        alarmManager.setInexactRepeating(
            AlarmManager.RTC_WAKEUP,
            nextRunAtMillis(),
            AlarmManager.INTERVAL_DAY,
            pendingIntent(),
        )
        Timber.i("DataLifecycleScheduler.schedule next=%d hour=%d", nextRunAtMillis(), RUN_HOUR)
    }

    fun cancel() {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        alarmManager.cancel(pendingIntent())
        Timber.i("DataLifecycleScheduler.cancel")
    }

    /** 下一个本地 [RUN_HOUR]:00; 若今日该点已过则取明日。 */
    private fun nextRunAtMillis(): Long {
        val now = Calendar.getInstance()
        val next = (now.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, RUN_HOUR)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (next.timeInMillis <= now.timeInMillis) {
            next.add(Calendar.DAY_OF_YEAR, 1)
        }
        return next.timeInMillis
    }

    private fun pendingIntent(): PendingIntent {
        val intent = Intent(context, DataLifecycleReceiver::class.java).apply {
            action = ACTION_CLEANUP
        }
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    companion object {
        /** 主文档 §4.6: 每日 03:00。 */
        const val RUN_HOUR = 3
        const val ACTION_CLEANUP = "com.chainlesschain.android.familyguard.DATA_LIFECYCLE_CLEANUP"
        private const val REQUEST_CODE = 9203
    }
}
