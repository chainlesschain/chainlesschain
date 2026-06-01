package com.chainlesschain.android.feature.familyguard.data.telemetry

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppQuery
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [ForegroundAppQuery] 默认实装: 走 Android `UsageStatsManager` (FAMILY-20).
 *
 * 权限: PACKAGE_USAGE_STATS 是 appop 特殊权限 (manifest 声明 + 用户在系统设置
 * "使用情况访问" 手动开)。用 [AppOpsManager] 查实际授予态而非 manifest 声明态。
 */
@Singleton
class UsageStatsForegroundAppQuery @Inject constructor(
    @ApplicationContext private val context: Context,
) : ForegroundAppQuery {

    override fun isAccessGranted(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        } else {
            @Suppress("DEPRECATION") // checkOpNoThrow 在 API < Q 是唯一入口
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    // MOVE_TO_FOREGROUND 在 API 29 起 deprecated 改名 ACTIVITY_RESUMED, 但两者同值 (1)
    // 且 MOVE_TO_FOREGROUND 在所有 API level 都可用; 沿用它覆盖低版本, 抑制 deprecation。
    @Suppress("DEPRECATION")
    override fun currentForegroundPackage(sinceMs: Long, nowMs: Long): String? {
        if (!isAccessGranted()) return null
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
        val events = usm.queryEvents(sinceMs, nowMs)
        var lastForeground: String? = null
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                lastForeground = event.packageName
            }
        }
        return lastForeground
    }
}
