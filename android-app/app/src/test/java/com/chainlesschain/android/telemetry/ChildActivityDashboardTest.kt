package com.chainlesschain.android.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-67 纯逻辑层验收：ChildActivityDashboard 把家长端收到的孩子 telemetry 聚合成
 * "每 app 用了多久 / top app / 总屏幕时长 / 来源&分级计数"的可读摘要。
 */
class ChildActivityDashboardTest {

    private val kid = "did:chain:kid"

    private fun fg(pkg: String, durationMs: Long, ts: Long, child: String = kid) = TelemetryEvent(
        childDid = child,
        source = TelemetrySourceType.FOREGROUND_APP,
        kind = "run",
        payload = ForegroundAppPayload.encode(pkg, durationMs),
        timestampMs = ts,
        durationMs = durationMs,
        level = TelemetryLevel.L1,
    )

    private fun pdh(kind: String, ts: Long, level: TelemetryLevel = TelemetryLevel.L2) = TelemetryEvent(
        childDid = kid,
        source = TelemetrySourceType.PDH_COLLECTOR,
        kind = kind,
        payload = "{}",
        timestampMs = ts,
        durationMs = 0L,
        level = level,
    )

    @Test
    fun `aggregates per-app foreground time and sessions, sorted desc`() {
        val events = listOf(
            fg("com.game", 60_000L, 100L),
            fg("com.game", 30_000L, 200L), // 两段 → 合并 90s / 2 sessions
            fg("com.bilibili", 45_000L, 300L),
        )
        val s = ChildActivityDashboard.summarize(kid, events, windowStartMs = 0L, windowEndMs = 1000L)

        assertEquals(2, s.appUsage.size)
        assertEquals("com.game", s.appUsage[0].packageName) // 90s 排第一
        assertEquals(90_000L, s.appUsage[0].totalMs)
        assertEquals(2, s.appUsage[0].sessions)
        assertEquals("com.bilibili", s.appUsage[1].packageName)
        assertEquals(45_000L, s.appUsage[1].totalMs)
        assertEquals(135_000L, s.totalForegroundMs)
    }

    @Test
    fun `window excludes out-of-range and other children`() {
        val events = listOf(
            fg("com.game", 10_000L, 50L), // < start → 排除
            fg("com.game", 20_000L, 150L), // 在窗内
            fg("com.game", 30_000L, 500L), // == end → 排除 (右开)
            fg("com.game", 99_000L, 200L, child = "did:chain:other"), // 别的孩子 → 排除
        )
        val s = ChildActivityDashboard.summarize(kid, events, windowStartMs = 100L, windowEndMs = 500L)

        assertEquals(20_000L, s.totalForegroundMs)
        assertEquals(1, s.totalEvents)
    }

    @Test
    fun `topApps respects topN`() {
        val events = (1..6).map { fg("com.app$it", it * 1000L, it * 10L) }
        val s = ChildActivityDashboard.summarize(kid, events, 0L, 1000L, topN = 3)

        assertEquals(6, s.appUsage.size)
        assertEquals(3, s.topApps.size)
        assertEquals("com.app6", s.topApps[0].packageName) // 6000ms 最大
        assertEquals("com.app4", s.topApps[2].packageName)
    }

    @Test
    fun `counts events by source and level`() {
        val events = listOf(
            fg("com.game", 1000L, 10L), // FOREGROUND_APP / L1
            fg("com.bilibili", 2000L, 20L), // FOREGROUND_APP / L1
            pdh("message", 30L, TelemetryLevel.L2), // PDH / L2
        )
        val s = ChildActivityDashboard.summarize(kid, events, 0L, 1000L)

        assertEquals(2, s.eventsBySource[TelemetrySourceType.FOREGROUND_APP])
        assertEquals(1, s.eventsBySource[TelemetrySourceType.PDH_COLLECTOR])
        assertEquals(2, s.eventsByLevel[TelemetryLevel.L1])
        assertEquals(1, s.eventsByLevel[TelemetryLevel.L2])
        assertEquals(3, s.totalEvents)
    }

    @Test
    fun `non-foreground events do not contribute to app usage`() {
        val events = listOf(pdh("message", 10L), pdh("order", 20L))
        val s = ChildActivityDashboard.summarize(kid, events, 0L, 1000L)

        assertTrue(s.appUsage.isEmpty())
        assertEquals(0L, s.totalForegroundMs)
        assertEquals(2, s.totalEvents) // 仍计入总数与来源分布
    }

    @Test
    fun `undecodable foreground payload is skipped`() {
        val good = fg("com.game", 5000L, 10L)
        val garbage = good.copy(payload = "not-json", timestampMs = 20L)
        val s = ChildActivityDashboard.summarize(kid, listOf(good, garbage), 0L, 1000L)

        assertEquals(1, s.appUsage.size)
        assertEquals(5000L, s.totalForegroundMs)
        assertEquals(2, s.totalEvents) // 坏 payload 仍计入事件计数，只是不计入 app 用量
    }

    @Test
    fun `empty input yields empty summary`() {
        val s = ChildActivityDashboard.summarize(kid, emptyList(), 0L, 1000L)
        assertEquals(0, s.totalEvents)
        assertEquals(0L, s.totalForegroundMs)
        assertTrue(s.appUsage.isEmpty())
        assertTrue(s.topApps.isEmpty())
    }
}
