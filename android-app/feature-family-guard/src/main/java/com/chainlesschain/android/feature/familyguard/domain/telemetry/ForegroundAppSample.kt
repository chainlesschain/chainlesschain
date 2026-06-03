package com.chainlesschain.android.feature.familyguard.domain.telemetry

/**
 * UsageStatsManager 输出的单条前台 app 样本 (FAMILY-20).
 *
 * 由 [com.chainlesschain.android.feature.familyguard.data.telemetry.
 * ForegroundAppTimer] 每分钟轮询采集 (查 `queryUsageStats(INTERVAL_DAILY, ...)`
 * 取最近 60s 窗口内的 last foreground); 然后送 [ForegroundAppAggregator]
 * 聚合为 30min run.
 */
data class ForegroundAppSample(
    val packageName: String,
    val timestampMs: Long,
)
