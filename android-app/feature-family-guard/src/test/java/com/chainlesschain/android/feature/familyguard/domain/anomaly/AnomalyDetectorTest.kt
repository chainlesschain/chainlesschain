package com.chainlesschain.android.feature.familyguard.domain.anomaly

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppPayload
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-27 验收: [AnomalyDetector] 5 条 v0 规则全覆盖 + 边界 + 去重键稳定。
 * 时区固定 UTC; 参考日 2026-06-03 周三。
 */
class AnomalyDetectorTest {

    private val kid = "did:chain:kid"
    private val zone = ZoneId.of("UTC")
    private val detector = AnomalyDetector(zone)
    private val config = AnomalyConfig()
    private val game = "com.tencent.tmgp.sgame" // 在 DEFAULT_GAME_PACKAGES 内

    /** now = 06-04 00:00, 让所有 06-03 事件落在判定日内。 */
    private val now = at("2026-06-04", 0, 0)

    private fun at(date: String, hh: Int, mm: Int): Long {
        val (y, mo, d) = date.split("-").map { it.toInt() }
        return LocalDateTime.of(y, mo, d, hh, mm).atZone(zone).toInstant().toEpochMilli()
    }

    private fun fgRun(pkg: String, date: String, hh: Int, mm: Int, durMin: Int): ChildEventEntity {
        val durMs = durMin * 60_000L
        return ChildEventEntity(
            childDid = kid,
            source = "foreground_app",
            kind = "run",
            payload = ForegroundAppPayload.encode(pkg, durMs),
            timestamp = at(date, hh, mm),
            durationMs = durMs,
            level = "L1",
        )
    }

    private fun recharge(date: String, hh: Int, mm: Int): ChildEventEntity = ChildEventEntity(
        childDid = kid,
        source = "pdh",
        kind = "recharge",
        payload = "{}",
        timestamp = at(date, hh, mm),
        durationMs = 0L,
        level = "L1",
    )

    private fun detect(
        events: List<ChildEventEntity>,
        prior: Set<String> = emptySet(),
        cfg: AnomalyConfig = config,
    ) = detector.detect(kid, events, prior, now, cfg)

    private fun List<DetectedAnomaly>.ofType(t: AnomalyType) = filter { it.type == t }

    // ─── empty ───

    @Test
    fun `no events yields no anomalies`() {
        assertTrue(detect(emptyList()).isEmpty())
    }

    // ─── Rule 1: single-app overuse ───

    @Test
    fun `single app continuous over 90min triggers`() {
        // 4 段背靠背 30min = 120min > 90, 白名单抑制首见噪声。
        val events = listOf(
            fgRun("com.app.x", "2026-06-03", 10, 0, 30),
            fgRun("com.app.x", "2026-06-03", 10, 30, 30),
            fgRun("com.app.x", "2026-06-03", 11, 0, 30),
            fgRun("com.app.x", "2026-06-03", 11, 30, 30),
        )
        val r = detect(events, cfg = config.copy(knownApps = setOf("com.app.x")))
            .ofType(AnomalyType.SINGLE_APP_OVERUSE)
        assertEquals(1, r.size)
        assertEquals(AnomalySeverity.WARNING, r.first().severity)
    }

    @Test
    fun `single app under threshold does not trigger`() {
        val events = listOf(
            fgRun("com.app.x", "2026-06-03", 10, 0, 30),
            fgRun("com.app.x", "2026-06-03", 10, 30, 30),
        ) // 60min < 90
        assertTrue(detect(events).ofType(AnomalyType.SINGLE_APP_OVERUSE).isEmpty())
    }

    @Test
    fun `large gap splits sessions so neither exceeds threshold`() {
        // 两段各 60min, 间隔 30min (> 5min default) → 不合并 → 各 60min < 90。
        val events = listOf(
            fgRun("com.app.x", "2026-06-03", 10, 0, 30),
            fgRun("com.app.x", "2026-06-03", 10, 30, 30),
            fgRun("com.app.x", "2026-06-03", 11, 30, 30),
            fgRun("com.app.x", "2026-06-03", 12, 0, 30),
        )
        assertTrue(detect(events).ofType(AnomalyType.SINGLE_APP_OVERUSE).isEmpty())
    }

    // ─── Rule 2: late-night screen ───

    @Test
    fun `late night screen triggers`() {
        val r = detect(listOf(fgRun("com.app.x", "2026-06-03", 2, 0, 10)))
            .ofType(AnomalyType.LATE_NIGHT_SCREEN)
        assertEquals(1, r.size)
        assertEquals(AnomalySeverity.CRITICAL, r.first().severity)
    }

    @Test
    fun `daytime screen does not trigger late night`() {
        val r = detect(listOf(fgRun("com.app.x", "2026-06-03", 14, 0, 10)))
            .ofType(AnomalyType.LATE_NIGHT_SCREEN)
        assertTrue(r.isEmpty())
    }

    // ─── Rule 3: daily game overuse ───

    @Test
    fun `daily game over 3h triggers`() {
        // 7 段 30min 游戏 = 210min > 180。
        val events = (0 until 7).map { i -> fgRun(game, "2026-06-03", 10 + i, 0, 30) }
        val r = detect(events).ofType(AnomalyType.DAILY_GAME_OVERUSE)
        assertEquals(1, r.size)
    }

    @Test
    fun `non-game heavy usage does not trigger game rule`() {
        val events = (0 until 7).map { i -> fgRun("com.app.x", "2026-06-03", 10 + i, 0, 30) }
        assertTrue(detect(events).ofType(AnomalyType.DAILY_GAME_OVERUSE).isEmpty())
    }

    // ─── Rule 4: unknown app first seen ───

    @Test
    fun `unknown app first seen triggers`() {
        val r = detect(listOf(fgRun("com.brand.newgame", "2026-06-03", 14, 0, 5)))
            .ofType(AnomalyType.UNKNOWN_APP_FIRST_SEEN)
        assertEquals(1, r.size)
        assertEquals(AnomalySeverity.INFO, r.first().severity)
    }

    @Test
    fun `app seen in prior history is not first seen`() {
        val r = detect(
            listOf(fgRun("com.brand.newgame", "2026-06-03", 14, 0, 5)),
            prior = setOf("com.brand.newgame"),
        ).ofType(AnomalyType.UNKNOWN_APP_FIRST_SEEN)
        assertTrue(r.isEmpty())
    }

    @Test
    fun `known whitelisted app is not first seen`() {
        val r = detect(
            listOf(fgRun("com.android.launcher", "2026-06-03", 14, 0, 5)),
            cfg = config.copy(knownApps = setOf("com.android.launcher")),
        ).ofType(AnomalyType.UNKNOWN_APP_FIRST_SEEN)
        assertTrue(r.isEmpty())
    }

    // ─── Rule 5: recharge intent spike ───

    @Test
    fun `recharge spike at threshold triggers`() {
        val events = listOf(
            recharge("2026-06-03", 10, 0),
            recharge("2026-06-03", 11, 0),
            recharge("2026-06-03", 12, 0),
        ) // 3 >= threshold 3
        val r = detect(events).ofType(AnomalyType.RECHARGE_INTENT_SPIKE)
        assertEquals(1, r.size)
        assertEquals(AnomalySeverity.CRITICAL, r.first().severity)
    }

    @Test
    fun `recharge below threshold does not trigger`() {
        val events = listOf(recharge("2026-06-03", 10, 0), recharge("2026-06-03", 11, 0))
        assertTrue(detect(events).ofType(AnomalyType.RECHARGE_INTENT_SPIKE).isEmpty())
    }

    // ─── dedup key + multi-rule ───

    @Test
    fun `dedup key stable for same app same day`() {
        val day1 = listOf(
            fgRun("com.app.x", "2026-06-03", 10, 0, 30),
            fgRun("com.app.x", "2026-06-03", 10, 30, 30),
            fgRun("com.app.x", "2026-06-03", 11, 0, 30),
            fgRun("com.app.x", "2026-06-03", 11, 30, 30),
        )
        val cfg = config.copy(knownApps = setOf("com.app.x"))
        val k1 = detect(day1, cfg = cfg).ofType(AnomalyType.SINGLE_APP_OVERUSE).first().dedupKey
        val k2 = detect(day1, cfg = cfg).ofType(AnomalyType.SINGLE_APP_OVERUSE).first().dedupKey
        assertEquals(k1, k2)
        assertEquals("single_app_overuse:com.app.x:2026-06-03", k1)
    }

    @Test
    fun `multiple rules fire together`() {
        // 凌晨游戏 210min + 充值 3 次 → late-night + daily-game + recharge (+ 游戏包非白名单 → 首见)
        val events = (0 until 7).map { i -> fgRun(game, "2026-06-03", i, 0, 30) } +
            listOf(
                recharge("2026-06-03", 1, 0),
                recharge("2026-06-03", 2, 0),
                recharge("2026-06-03", 3, 0),
            )
        val r = detect(events)
        assertTrue(r.any { it.type == AnomalyType.LATE_NIGHT_SCREEN })
        assertTrue(r.any { it.type == AnomalyType.DAILY_GAME_OVERUSE })
        assertTrue(r.any { it.type == AnomalyType.RECHARGE_INTENT_SPIKE })
    }
}
