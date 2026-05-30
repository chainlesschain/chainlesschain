package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppSample
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FAMILY-20 验收: 聚合 4 边界 + flush. 全 pure 测试; 无 IO; 验证 state machine。
 */
class ForegroundAppAggregatorTest {

    private val pkgGame = "com.tencent.tmgp.sgame"
    private val pkgChat = "com.tencent.mm"

    // ─── 4 边界 ───

    @Test
    fun `first sample starts run and offer returns null`() {
        val a = ForegroundAppAggregator()
        val result = a.offer(ForegroundAppSample(pkgGame, 1000L))
        assertNull(result)
        assertTrue(a.isRunning())
    }

    @Test
    fun `same package next minute extends run (no flush)`() {
        val a = ForegroundAppAggregator()
        a.offer(ForegroundAppSample(pkgGame, 1000L))
        val result = a.offer(ForegroundAppSample(pkgGame, 61_000L)) // +60s
        assertNull(result) // 未切, 延伸
        assertTrue(a.isRunning())
    }

    @Test
    fun `different package flushes current run and starts new`() {
        val a = ForegroundAppAggregator()
        a.offer(ForegroundAppSample(pkgGame, 1000L))
        a.offer(ForegroundAppSample(pkgGame, 61_000L)) // 延伸到 61s
        val finalized = a.offer(ForegroundAppSample(pkgChat, 120_000L))
        assertNotNull(finalized)
        assertEquals(pkgGame, finalized.packageName)
        assertEquals(1000L, finalized.startMs)
        assertEquals(61_000L, finalized.endMs)
        assertEquals(60_000L, finalized.durationMs)
    }

    @Test
    fun `30min boundary forces flush even if same package`() {
        val a = ForegroundAppAggregator(maxRunMs = 30L * 60L * 1000L)
        a.offer(ForegroundAppSample(pkgGame, 0L))
        a.offer(ForegroundAppSample(pkgGame, 60_000L)) // +1min
        // 30 min == maxRunMs → 强制截断 (因 condition 是 < maxRunMs)
        val finalized = a.offer(
            ForegroundAppSample(pkgGame, 30L * 60L * 1000L),
        )
        assertNotNull(finalized)
        assertEquals(pkgGame, finalized.packageName)
        assertEquals(60_000L, finalized.endMs) // 上一次 sample
        // 新 run 已启动
        assertTrue(a.isRunning())
    }

    @Test
    fun `same package well past 30min forces flush at boundary`() {
        val a = ForegroundAppAggregator()
        a.offer(ForegroundAppSample(pkgGame, 0L))
        val finalized = a.offer(ForegroundAppSample(pkgGame, 31L * 60L * 1000L))
        assertNotNull(finalized)
        assertEquals(0L, finalized.startMs)
        assertEquals(0L, finalized.endMs) // 因 lastSample 仍是 startMs (无中间 sample)
    }

    // ─── flush ───

    @Test
    fun `explicit flush finalizes current run and clears state`() {
        val a = ForegroundAppAggregator()
        a.offer(ForegroundAppSample(pkgGame, 1000L))
        a.offer(ForegroundAppSample(pkgGame, 61_000L))
        val finalized = a.flush()
        assertNotNull(finalized)
        assertEquals(pkgGame, finalized.packageName)
        assertEquals(60_000L, finalized.durationMs)
        assertFalse(a.isRunning())
    }

    @Test
    fun `flush with no current run returns null`() {
        val a = ForegroundAppAggregator()
        assertNull(a.flush())
    }

    @Test
    fun `flush after offer returns single-sample run with 0 duration`() {
        val a = ForegroundAppAggregator()
        a.offer(ForegroundAppSample(pkgGame, 5000L))
        val finalized = a.flush()
        assertNotNull(finalized)
        assertEquals(0L, finalized.durationMs)
        assertEquals(5000L, finalized.startMs)
        assertEquals(5000L, finalized.endMs)
    }

    // ─── 时序乱序 ───

    @Test
    fun `out-of-order sample (ts before start) treats as reset and flushes`() {
        val a = ForegroundAppAggregator()
        a.offer(ForegroundAppSample(pkgGame, 10_000L))
        // 时钟回拨 → ts < startMs → withinMaxRun=false (runDuration < 0)
        val finalized = a.offer(ForegroundAppSample(pkgGame, 5_000L))
        assertNotNull(finalized)
        assertEquals(10_000L, finalized.startMs)
        assertTrue(a.isRunning())
    }

    // ─── 真实场景: 一小时混合使用 ───

    @Test
    fun `mixed-app sequence over 1h produces multiple runs`() {
        val a = ForegroundAppAggregator()
        val flushed = mutableListOf<com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun>()

        // 0-10min: game
        a.offer(ForegroundAppSample(pkgGame, 0L))
        a.offer(ForegroundAppSample(pkgGame, 5L * 60L * 1000L))
        a.offer(ForegroundAppSample(pkgGame, 10L * 60L * 1000L))
        // 10min 切微信
        a.offer(ForegroundAppSample(pkgChat, 11L * 60L * 1000L))?.let { flushed.add(it) }
        // 11-15min 微信
        a.offer(ForegroundAppSample(pkgChat, 15L * 60L * 1000L))
        // 15min 回 game
        a.offer(ForegroundAppSample(pkgGame, 16L * 60L * 1000L))?.let { flushed.add(it) }
        // game 60min
        a.offer(ForegroundAppSample(pkgGame, 60L * 60L * 1000L))?.let { flushed.add(it) }

        // 最后 flush
        a.flush()?.let { flushed.add(it) }

        // 期望: game(0-10min) + chat(11-15min) + game(16-?) + (60-? after force cut?)
        // 因 game 16->60 = 44min > 30min, 触发强制截断
        // 实际事件链: game(0-10), chat(11-15), game(16-? force cut), game(... last)
        assertTrue(flushed.size >= 3, "expect ≥ 3 runs, got ${flushed.size}: $flushed")
        assertEquals(pkgGame, flushed[0].packageName)
        assertEquals(pkgChat, flushed[1].packageName)
    }
}
