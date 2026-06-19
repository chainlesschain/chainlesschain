package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundUsageAggregatorTest {

    private fun run(pkg: String, durationMs: Long, source: String = "foreground_app", kind: String = "run") =
        ChildEventEntity(
            childDid = "did:child", source = source, kind = kind,
            payload = """{"package":"$pkg","duration_ms":$durationMs}""",
            timestamp = 1L, durationMs = durationMs, level = "L1",
        )

    @Test
    fun `aggregates duration by package and maps known app names`() {
        val s = ForegroundUsageAggregator.summarize(
            listOf(
                run("com.tencent.mm", 20 * 60_000L),
                run("com.tencent.mm", 25 * 60_000L), // 同 app 累加 → 45min
                run("com.tencent.tmgp.sgame", 30 * 60_000L),
            ),
        )
        assertEquals(75, s.totalMinutes)
        assertEquals("微信", s.topApps[0].label)
        assertEquals(45, s.topApps[0].minutes)
        assertEquals("王者荣耀", s.topApps[1].label)
        assertEquals(30, s.topApps[1].minutes)
    }

    @Test
    fun `topN limits and sorts by minutes desc`() {
        val s = ForegroundUsageAggregator.summarize(
            listOf(
                run("a.b.c", 10 * 60_000L),
                run("d.e.f", 40 * 60_000L),
                run("g.h.i", 20 * 60_000L),
                run("j.k.l", 5 * 60_000L),
            ),
            topN = 2,
        )
        assertEquals(2, s.topApps.size)
        assertEquals(40, s.topApps[0].minutes)
        assertEquals(20, s.topApps[1].minutes)
        assertEquals(75, s.totalMinutes) // 总时长含所有 app，不只 topN
    }

    @Test
    fun `unknown package falls back to last segment`() {
        val s = ForegroundUsageAggregator.summarize(listOf(run("com.foo.barapp", 10 * 60_000L)))
        assertEquals("barapp", s.topApps[0].label)
    }

    @Test
    fun `ignores non-foreground-app events`() {
        val s = ForegroundUsageAggregator.summarize(
            listOf(
                run("com.tencent.mm", 30 * 60_000L),
                run("com.x.y", 60 * 60_000L, source = "pdh_wechat", kind = "message"), // 非前台 run
                run("com.z.w", 60 * 60_000L, kind = "other"),
            ),
        )
        assertEquals(30, s.totalMinutes)
        assertEquals(1, s.topApps.size)
    }

    @Test
    fun `empty or sub-minute runs produce empty or zero`() {
        assertEquals(0, ForegroundUsageAggregator.summarize(emptyList()).totalMinutes)
        assertTrue(ForegroundUsageAggregator.summarize(emptyList()).topApps.isEmpty())
        // 30 秒 < 1 分钟 → 0 分钟，topApps 过滤掉 0
        val s = ForegroundUsageAggregator.summarize(listOf(run("a.b.c", 30_000L)))
        assertEquals(0, s.totalMinutes)
        assertTrue(s.topApps.isEmpty())
    }

    @Test
    fun `malformed payload (no package) is skipped`() {
        val e = ChildEventEntity(
            childDid = "did:child", source = "foreground_app", kind = "run",
            payload = "{not json}", timestamp = 1L, durationMs = 60_000L, level = "L1",
        )
        assertEquals(0, ForegroundUsageAggregator.summarize(listOf(e)).totalMinutes)
    }
}
