package com.chainlesschain.android.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType

/**
 * 家长端「孩子活动」看板聚合（FAMILY-67 监管仪表板的**纯逻辑层**，主文档 §3.2/§3.6）。
 *
 * 给定家长端已接收（[TelemetryIngest.decode]）并落库的孩子 [TelemetryEvent] 列表 + 时间窗，
 * 产出家长可读摘要：每 app 前台时长 / top-N app / 总屏幕时长 / 按来源&分级的事件计数。
 * 这是"家长看到孩子在跑哪些 app、用了多久"的展示逻辑——此前 dashboard UI 缺纯逻辑底座。
 *
 * **纯函数、零设备**：dashboard UI（Compose）只渲染本摘要；真机采集 + 同步传输是设备阻塞
 * 的另一侧（已分别接通 / 接通中）。隐私取向：仅聚合"哪个 app、用了多久"（L1 粒度），不触碰
 * L2 内容原文；[eventsByLevel] 让家长端可透明展示"当前能看到的粒度"。
 */
data class AppUsage(
    val packageName: String,
    /** 窗口内该 app 前台累计时长（ms，已夹非负）。 */
    val totalMs: Long,
    /** 该 app 的前台运行段数（FOREGROUND_APP 'run' 事件计数）。 */
    val sessions: Int,
)

data class ChildActivitySummary(
    val childDid: String,
    val windowStartMs: Long,
    val windowEndMs: Long,
    /** 窗口内前台总时长（所有 app 求和）。 */
    val totalForegroundMs: Long,
    /** 每 app 用量，按时长降序（并列按包名升序，确定性稳定排序）。 */
    val appUsage: List<AppUsage>,
    /** 前 N 个 app（= [appUsage] 取前 topN）。 */
    val topApps: List<AppUsage>,
    /** 窗口内事件数按来源分类。 */
    val eventsBySource: Map<TelemetrySourceType, Int>,
    /** 窗口内事件数按分级（家长可见性透明度：当前多为 L1）。 */
    val eventsByLevel: Map<TelemetryLevel, Int>,
    /** 窗口内事件总数（[childDid] 过滤后）。 */
    val totalEvents: Int,
)

object ChildActivityDashboard {

    /**
     * 聚合某孩子在 [windowStartMs, windowEndMs) 内的活动摘要。
     *
     * @param events 家长端已落库的孩子 telemetry（可含多 child，本函数按 [childDid] 过滤）。
     * @param topN top app 取前几（默认 5；< 0 视为 0）。
     */
    fun summarize(
        childDid: String,
        events: List<TelemetryEvent>,
        windowStartMs: Long,
        windowEndMs: Long,
        topN: Int = 5,
    ): ChildActivitySummary {
        val inWindow = events.filter {
            it.childDid == childDid && it.timestampMs >= windowStartMs && it.timestampMs < windowEndMs
        }

        // 每 app 用量：仅前台 app 事件，payload 解出包名；非前台 payload / 解析失败跳过。
        val totals = LinkedHashMap<String, Long>()
        val sessions = LinkedHashMap<String, Int>()
        inWindow.asSequence()
            .filter { it.source == TelemetrySourceType.FOREGROUND_APP }
            .forEach { e ->
                val pkg = ForegroundAppPayload.decodePackageOrNull(e.payload) ?: return@forEach
                totals[pkg] = (totals[pkg] ?: 0L) + e.durationMs.coerceAtLeast(0L)
                sessions[pkg] = (sessions[pkg] ?: 0) + 1
            }
        val appUsage = totals.keys
            .map { AppUsage(packageName = it, totalMs = totals.getValue(it), sessions = sessions.getValue(it)) }
            .sortedWith(compareByDescending<AppUsage> { it.totalMs }.thenBy { it.packageName })

        return ChildActivitySummary(
            childDid = childDid,
            windowStartMs = windowStartMs,
            windowEndMs = windowEndMs,
            totalForegroundMs = appUsage.sumOf { it.totalMs },
            appUsage = appUsage,
            topApps = appUsage.take(topN.coerceAtLeast(0)),
            eventsBySource = inWindow.groupingBy { it.source }.eachCount(),
            eventsByLevel = inWindow.groupingBy { it.level }.eachCount(),
            totalEvents = inWindow.size,
        )
    }
}
