package com.chainlesschain.android.feature.familyguard.domain.telemetry

/**
 * 聚合后的前台 app 运行段 (FAMILY-20). 一段 = 同 packageName 连续使用 ≤ 30min.
 *
 * 主文档 §3.2 v0.2 设计决策:
 *   "ForegroundAppTimer 改为分钟级聚合存储 (同 app 连续使用 30min 合一行),
 *    磁盘量缩 30x"
 *
 * Aggregator 写到 child_event 表时:
 *   - source = 'foreground_app'
 *   - kind   = 'run'
 *   - payload = '{"package":"<pkg>","duration_ms":<dur>}'
 *   - timestamp = startMs
 *   - duration_ms = endMs - startMs
 *   - level = 'L1'
 */
data class ForegroundAppRun(
    val packageName: String,
    val startMs: Long,
    val endMs: Long,
) {
    val durationMs: Long get() = endMs - startMs
}
