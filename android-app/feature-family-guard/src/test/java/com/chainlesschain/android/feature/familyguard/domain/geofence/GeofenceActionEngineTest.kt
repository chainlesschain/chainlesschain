package com.chainlesschain.android.feature.familyguard.domain.geofence

import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import com.chainlesschain.android.feature.familyguard.domain.model.ExpectedArrival
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceAction
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceBoundary
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceTrigger
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FAMILY-54 验收: GeofenceActionEngine 纯函数映射 + 迟到判定 + 动作解析 + dedupKey。
 * 固定时区 Asia/Shanghai (UTC+8, 无 DST) → 墙钟比对确定性。
 */
class GeofenceActionEngineTest {

    private val zone = ZoneId.of("Asia/Shanghai")
    private val engine = GeofenceActionEngine(zone)
    private val child = "did:child:1"

    private fun ms(date: String, time: String): Long =
        LocalDateTime.parse("${date}T$time").atZone(zone).toInstant().toEpochMilli()

    private fun geofence(
        kind: String = "school",
        onEnter: String = "notify_parent",
        onExit: String = "silent",
        onLate: String = "notify_parent",
        expectedArrival: String? = null,
        active: Boolean = true,
    ) = GeofenceEntity(
        id = "g1",
        familyGroupId = "grp",
        name = "实验小学",
        kind = kind,
        latitude = 31.23,
        longitude = 121.47,
        radiusM = 150,
        expectedArrival = expectedArrival,
        onEnterAction = onEnter,
        onExitAction = onExit,
        onLateAction = onLate,
        active = active,
    )

    // ─── 动作解析 ───

    @Test
    fun `parse all action variants`() {
        assertEquals(GeofenceAction.NotifyParent, GeofenceAction.parse("notify_parent"))
        assertEquals(GeofenceAction.Silent, GeofenceAction.parse("silent"))
        assertEquals(GeofenceAction.LockApp("com.tencent.mm"), GeofenceAction.parse("lock_app:com.tencent.mm"))
        assertEquals(GeofenceAction.UnlockApp("com.x"), GeofenceAction.parse("unlock_app:com.x"))
        assertEquals(GeofenceAction.NotifyParent, GeofenceAction.parse("  notify_parent  ")) // trim
    }

    @Test
    fun `parse rejects unknown empty and missing package`() {
        assertNull(GeofenceAction.parse("airplane_mode"))
        assertNull(GeofenceAction.parse(""))
        assertNull(GeofenceAction.parse(null))
        assertNull(GeofenceAction.parse("lock_app:")) // 缺包名
        assertNull(GeofenceAction.parse("unlock_app:"))
    }

    // ─── 边界映射 ───

    @Test
    fun `ENTER fires on_enter only when not late`() {
        val out = engine.resolve(geofence(), GeofenceBoundary.ENTER, child, ms("2026-06-01", "07:30"))
        assertEquals(1, out.size)
        assertEquals(GeofenceTrigger.ON_ENTER, out[0].trigger)
        assertEquals(GeofenceAction.NotifyParent, out[0].action)
    }

    @Test
    fun `EXIT fires on_exit`() {
        val out = engine.resolve(
            geofence(onExit = "lock_app:com.game"),
            GeofenceBoundary.EXIT,
            child,
            ms("2026-06-01", "16:00"),
        )
        assertEquals(1, out.size)
        assertEquals(GeofenceTrigger.ON_EXIT, out[0].trigger)
        assertEquals(GeofenceAction.LockApp("com.game"), out[0].action)
    }

    @Test
    fun `DWELL maps to nothing (reserved for FAMILY-55)`() {
        assertTrue(engine.resolve(geofence(), GeofenceBoundary.DWELL, child, ms("2026-06-01", "10:00")).isEmpty())
    }

    @Test
    fun `inactive geofence yields nothing`() {
        assertTrue(
            engine.resolve(geofence(active = false), GeofenceBoundary.ENTER, child, ms("2026-06-01", "09:00")).isEmpty(),
        )
    }

    // ─── 迟到判定 ───

    @Test
    fun `late ENTER fires both on_enter and on_late`() {
        val gf = geofence(
            onEnter = "silent",
            onLate = "notify_parent",
            expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""",
        )
        val out = engine.resolve(gf, GeofenceBoundary.ENTER, child, ms("2026-06-01", "08:30")) // 晚于 08:10
        assertEquals(2, out.size)
        assertEquals(setOf(GeofenceTrigger.ON_ENTER, GeofenceTrigger.ON_LATE), out.map { it.trigger }.toSet())
        val late = out.first { it.trigger == GeofenceTrigger.ON_LATE }
        assertEquals(GeofenceAction.NotifyParent, late.action)
        // on_enter=silent 仍出现在输出（供审计）
        assertEquals(GeofenceAction.Silent, out.first { it.trigger == GeofenceTrigger.ON_ENTER }.action)
    }

    @Test
    fun `arrival within grace is not late`() {
        val gf = geofence(expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""")
        val out = engine.resolve(gf, GeofenceBoundary.ENTER, child, ms("2026-06-01", "08:05")) // 08:00+10 内
        assertEquals(1, out.size)
        assertEquals(GeofenceTrigger.ON_ENTER, out[0].trigger)
    }

    @Test
    fun `late but non-applicable weekday is not late`() {
        val now = ms("2026-06-01", "09:00")
        val isoDay = Instant.ofEpochMilli(now).atZone(zone).dayOfWeek.value
        val otherDay = if (isoDay == 7) 1 else isoDay + 1
        val gf = geofence(expectedArrival = """{"days":[$otherDay],"time":"08:00","grace_minutes":0}""")
        val out = engine.resolve(gf, GeofenceBoundary.ENTER, child, now)
        assertEquals(1, out.size) // 仅 on_enter，当天非适用日不算迟到
        assertEquals(GeofenceTrigger.ON_ENTER, out[0].trigger)
    }

    @Test
    fun `no expected_arrival never late`() {
        val out = engine.resolve(geofence(expectedArrival = null), GeofenceBoundary.ENTER, child, ms("2026-06-01", "23:00"))
        assertEquals(1, out.size)
        assertEquals(GeofenceTrigger.ON_ENTER, out[0].trigger)
    }

    // ─── 应到却未到 (resolveOverdueArrival) ───

    @Test
    fun `overdue fires on_late when deadline passed and never entered today`() {
        val gf = geofence(
            onLate = "notify_parent",
            expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""",
        )
        // 截止 08:10 已过，当天从未进入 (lastEnterMs = null)
        val out = engine.resolveOverdueArrival(gf, child, lastEnterMs = null, nowMs = ms("2026-06-01", "09:00"))
        assertEquals(GeofenceTrigger.ON_LATE, out?.trigger)
        assertEquals(GeofenceAction.NotifyParent, out?.action)
        assertTrue(out!!.summary.startsWith("应到未到"))
    }

    @Test
    fun `overdue shares ON_LATE dedupKey with late-entry path`() {
        val gf = geofence(expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""")
        val now = ms("2026-06-01", "09:00")
        val overdue = engine.resolveOverdueArrival(gf, child, lastEnterMs = null, nowMs = now)
        val lateEntry = engine.resolve(gf, GeofenceBoundary.ENTER, child, now)
            .first { it.trigger == GeofenceTrigger.ON_LATE }
        // 同围栏同本地日 → 同 dedupKey，下游去重后未到+迟到进校只下发一次
        assertEquals(lateEntry.dedupKey, overdue?.dedupKey)
        assertEquals("g1:ON_LATE:2026-06-01", overdue?.dedupKey)
    }

    @Test
    fun `not overdue when already entered today`() {
        val gf = geofence(expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""")
        // 当天 07:55 已进入 → 截止虽已过也不算未到
        val out = engine.resolveOverdueArrival(
            gf, child,
            lastEnterMs = ms("2026-06-01", "07:55"),
            nowMs = ms("2026-06-01", "09:00"),
        )
        assertNull(out)
    }

    @Test
    fun `enter on a previous day does not count as entered today`() {
        val gf = geofence(expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""")
        // 昨天进过，今天截止已过仍未进 → 未到
        val out = engine.resolveOverdueArrival(
            gf, child,
            lastEnterMs = ms("2026-05-31", "07:55"),
            nowMs = ms("2026-06-01", "09:00"),
        )
        assertEquals(GeofenceTrigger.ON_LATE, out?.trigger)
    }

    @Test
    fun `not overdue before deadline`() {
        val gf = geofence(expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""")
        // 07:30 < 08:10 截止 → 还没到点，不算未到
        assertNull(engine.resolveOverdueArrival(gf, child, lastEnterMs = null, nowMs = ms("2026-06-01", "07:30")))
    }

    @Test
    fun `not overdue on non-applicable weekday`() {
        val now = ms("2026-06-01", "09:00")
        val isoDay = Instant.ofEpochMilli(now).atZone(zone).dayOfWeek.value
        val otherDay = if (isoDay == 7) 1 else isoDay + 1
        val gf = geofence(expectedArrival = """{"days":[$otherDay],"time":"08:00","grace_minutes":0}""")
        assertNull(engine.resolveOverdueArrival(gf, child, lastEnterMs = null, nowMs = now))
    }

    @Test
    fun `not overdue without expected_arrival`() {
        assertNull(
            engine.resolveOverdueArrival(geofence(expectedArrival = null), child, lastEnterMs = null, nowMs = ms("2026-06-01", "09:00")),
        )
    }

    @Test
    fun `inactive geofence is never overdue`() {
        val gf = geofence(active = false, expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""")
        assertNull(engine.resolveOverdueArrival(gf, child, lastEnterMs = null, nowMs = ms("2026-06-01", "09:00")))
    }

    @Test
    fun `overdue with unparseable on_late action is skipped`() {
        val gf = geofence(onLate = "bogus_action", expectedArrival = """{"days":[],"time":"08:00","grace_minutes":10}""")
        assertNull(engine.resolveOverdueArrival(gf, child, lastEnterMs = null, nowMs = ms("2026-06-01", "09:00")))
    }

    // ─── 解析跳过 + dedupKey ───

    @Test
    fun `unparseable action is skipped`() {
        val out = engine.resolve(geofence(onEnter = "bogus_action"), GeofenceBoundary.ENTER, child, ms("2026-06-01", "07:00"))
        assertTrue(out.isEmpty())
    }

    @Test
    fun `dedupKey is geofence trigger and local date`() {
        val now = ms("2026-06-01", "07:30")
        val out = engine.resolve(geofence(), GeofenceBoundary.ENTER, child, now)
        assertEquals("g1:ON_ENTER:2026-06-01", out[0].dedupKey)
    }

    // ─── ExpectedArrival 解析健壮性 ───

    @Test
    fun `ExpectedArrival rejects bad time and out-of-range weekday`() {
        assertNull(ExpectedArrival.parseOrNull("""{"time":"25:00"}"""))
        assertNull(ExpectedArrival.parseOrNull("""{"days":[8],"time":"08:00"}"""))
        assertNull(ExpectedArrival.parseOrNull("""{"days":[0],"time":"08:00"}"""))
        assertNull(ExpectedArrival.parseOrNull("not json"))
        assertNull(ExpectedArrival.parseOrNull(null))
        assertNull(ExpectedArrival.parseOrNull(""))
        // 合法
        val ok = ExpectedArrival.parseOrNull("""{"days":[1,2,3],"time":"08:00","grace_minutes":5}""")
        assertEquals(listOf(1, 2, 3), ok?.days)
        assertEquals(5, ok?.graceMinutes)
    }
}
