package com.chainlesschain.android.feature.familyguard.domain.quiethours

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.QuietHourWindow
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * FAMILY-24 验收: [QuietHoursEngine] 命中判断矩阵 + 级别降级 + 累计上限。
 *
 * 时区固定 UTC; 参考日 (date -d 已核): 2026-06-03 周三 / 06-05 周五 / 06-06 周六 /
 * 06-07 周日, 用于 weekdayOnly + 跨午夜 anchor-日 判定。
 */
class QuietHoursEngineTest {

    private val engine = QuietHoursEngine(ZoneId.of("UTC"))

    private fun at(date: String, hh: Int, mm: Int): Instant {
        val (y, mo, d) = date.split("-").map { it.toInt() }
        return LocalDateTime.of(y, mo, d, hh, mm).atZone(ZoneId.of("UTC")).toInstant()
    }

    private fun window(start: String, end: String, weekdayOnly: Boolean = false) =
        QuietHourWindow(start = start, end = end, weekdayOnly = weekdayOnly)

    // ─── empty / boundary ───

    @Test
    fun `empty windows never active`() {
        assertFalse(engine.isActive(emptyList(), at("2026-06-03", 13, 0)))
    }

    @Test
    fun `zero-length window never active`() {
        val w = listOf(window("08:00", "08:00"))
        assertFalse(engine.isActive(w, at("2026-06-03", 8, 0)))
    }

    // ─── same-day window ───

    @Test
    fun `same-day window active inside`() {
        val w = listOf(window("12:00", "14:00"))
        assertTrue(engine.isActive(w, at("2026-06-03", 13, 0)))
    }

    @Test
    fun `same-day window start inclusive end exclusive`() {
        val w = listOf(window("12:00", "14:00"))
        assertTrue(engine.isActive(w, at("2026-06-03", 12, 0))) // start inclusive
        assertFalse(engine.isActive(w, at("2026-06-03", 14, 0))) // end exclusive
    }

    @Test
    fun `same-day window inactive outside`() {
        val w = listOf(window("12:00", "14:00"))
        assertFalse(engine.isActive(w, at("2026-06-03", 11, 59)))
        assertFalse(engine.isActive(w, at("2026-06-03", 18, 0)))
    }

    // ─── cross-midnight ───

    @Test
    fun `cross-midnight active before midnight (today anchor)`() {
        val w = listOf(window("22:00", "06:00"))
        assertTrue(engine.isActive(w, at("2026-06-03", 23, 0)))
    }

    @Test
    fun `cross-midnight active after midnight (yesterday anchor)`() {
        val w = listOf(window("22:00", "06:00"))
        assertTrue(engine.isActive(w, at("2026-06-04", 2, 0)))
    }

    @Test
    fun `cross-midnight inactive in daytime gap`() {
        val w = listOf(window("22:00", "06:00"))
        assertFalse(engine.isActive(w, at("2026-06-04", 7, 0)))
        assertFalse(engine.isActive(w, at("2026-06-04", 12, 0)))
    }

    // ─── weekdayOnly same-day ───

    @Test
    fun `weekdayOnly active on weekday`() {
        val w = listOf(window("12:00", "14:00", weekdayOnly = true))
        assertTrue(engine.isActive(w, at("2026-06-03", 13, 0))) // Wed
    }

    @Test
    fun `weekdayOnly inactive on weekend`() {
        val w = listOf(window("12:00", "14:00", weekdayOnly = true))
        assertFalse(engine.isActive(w, at("2026-06-06", 13, 0))) // Sat
    }

    // ─── weekdayOnly cross-midnight: anchor = start day ───

    @Test
    fun `weekdayOnly cross-midnight Friday night active`() {
        val w = listOf(window("22:00", "06:00", weekdayOnly = true))
        assertTrue(engine.isActive(w, at("2026-06-05", 23, 0))) // Fri 23:00
    }

    @Test
    fun `weekdayOnly cross-midnight Saturday early morning active (anchored Friday)`() {
        val w = listOf(window("22:00", "06:00", weekdayOnly = true))
        // Sat 02:00 is the tail of Friday's window → anchor Fri = weekday → active
        assertTrue(engine.isActive(w, at("2026-06-06", 2, 0)))
    }

    @Test
    fun `weekdayOnly cross-midnight Saturday night inactive`() {
        val w = listOf(window("22:00", "06:00", weekdayOnly = true))
        assertFalse(engine.isActive(w, at("2026-06-06", 23, 0))) // Sat night, anchor Sat (weekend)
    }

    @Test
    fun `weekdayOnly cross-midnight Sunday early morning inactive (anchored Saturday)`() {
        val w = listOf(window("22:00", "06:00", weekdayOnly = true))
        // Sun 02:00 is the tail of Saturday's window → anchor Sat = weekend → inactive
        assertFalse(engine.isActive(w, at("2026-06-07", 2, 0)))
    }

    // ─── multiple windows ───

    @Test
    fun `any matching window activates`() {
        val w = listOf(window("08:00", "09:00"), window("12:00", "14:00"))
        assertTrue(engine.isActive(w, at("2026-06-03", 13, 0)))
        assertFalse(engine.isActive(w, at("2026-06-03", 10, 0)))
    }

    // ─── effectiveLevel ───

    @Test
    fun `effectiveLevel L0 stays L0 even when active`() {
        val w = listOf(window("12:00", "14:00"))
        assertEquals(
            TelemetryLevel.L0,
            engine.effectiveLevel(TelemetryLevel.L0, w, at("2026-06-03", 13, 0)),
        )
    }

    @Test
    fun `effectiveLevel caps L1 to L0 during quiet hours`() {
        val w = listOf(window("12:00", "14:00"))
        assertEquals(
            TelemetryLevel.L0,
            engine.effectiveLevel(TelemetryLevel.L1, w, at("2026-06-03", 13, 0)),
        )
    }

    @Test
    fun `effectiveLevel caps L3 to L0 during quiet hours`() {
        val w = listOf(window("22:00", "06:00"))
        assertEquals(
            TelemetryLevel.L0,
            engine.effectiveLevel(TelemetryLevel.L3, w, at("2026-06-04", 2, 0)),
        )
    }

    @Test
    fun `effectiveLevel preserves level outside quiet hours`() {
        val w = listOf(window("12:00", "14:00"))
        assertEquals(
            TelemetryLevel.L2,
            engine.effectiveLevel(TelemetryLevel.L2, w, at("2026-06-03", 18, 0)),
        )
    }

    // ─── daily cap helpers ───

    @Test
    fun `dailyTotalMinutes sums windows including cross-midnight`() {
        val w = listOf(window("12:00", "14:00"), window("22:00", "06:00")) // 120 + 480
        assertEquals(600, engine.dailyTotalMinutes(w))
    }

    @Test
    fun `exceedsDailyCap compares against cap`() {
        val w = listOf(window("22:00", "06:00")) // 480 min
        assertTrue(engine.exceedsDailyCap(w, capMinutes = 240))
        assertFalse(engine.exceedsDailyCap(w, capMinutes = 480))
    }
}
