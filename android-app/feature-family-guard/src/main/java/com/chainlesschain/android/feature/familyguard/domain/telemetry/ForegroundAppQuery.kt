package com.chainlesschain.android.feature.familyguard.domain.telemetry

/**
 * 前台 app 查询抽象 (FAMILY-20 ForegroundAppTimer).
 *
 * 把 Android `UsageStatsManager` framework API 包到接口后, [ForegroundAppTimer]
 * 可对 fake 单测 (framework 类无法在 JVM 单测构造)。默认实装
 * [com.chainlesschain.android.feature.familyguard.data.telemetry.UsageStatsForegroundAppQuery]。
 */
interface ForegroundAppQuery {

    /**
     * Usage Access 特殊权限是否已授予 (Settings → 使用情况访问)。未授予时
     * [currentForegroundPackage] 永远返 null; UI 需引导用户去系统设置开启。
     */
    fun isAccessGranted(): Boolean

    /**
     * 查 `[sinceMs, nowMs]` 窗口内最后一次切到前台的 app 包名。
     *
     * @return 最近前台包名; 窗口内无前台事件 / 无权限 → null (调用方可沿用上次值)。
     */
    fun currentForegroundPackage(sinceMs: Long, nowMs: Long): String?
}
