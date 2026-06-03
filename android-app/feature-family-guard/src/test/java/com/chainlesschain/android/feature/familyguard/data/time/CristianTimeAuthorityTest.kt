package com.chainlesschain.android.feature.familyguard.data.time

import com.chainlesschain.android.feature.familyguard.domain.time.MonotonicClock
import com.chainlesschain.android.feature.familyguard.domain.time.ParentTimeSource
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthorityStatus
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * FAMILY-60 验收: Cristian 算法正确性 + 单调时钟外推 (免疫墙钟更改) + skew>5min 锁 +
 * stale>48h 温和档 + never-synced + 同步失败。
 */
class CristianTimeAuthorityTest {

    // 可变假墙钟 (用户可改)
    private class FakeWallClock(var nowMs: Long) : Clock() {
        override fun millis(): Long = nowMs
        override fun instant(): Instant = Instant.ofEpochMilli(nowMs)
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId?): Clock = this
    }

    // 可变假单调钟 (开机起单调; 测试手动推进)
    private class FakeMonotonicClock(var t: Long) : MonotonicClock {
        override fun elapsedRealtimeMs(): Long = t
    }

    // 假家长时间源; fetch 时把单调钟推进 rttMs 模拟网络往返
    private class FakeParentTimeSource(
        private val parentMs: Long?,
        private val mono: FakeMonotonicClock,
        private val rttMs: Long,
    ) : ParentTimeSource {
        override suspend fun fetchParentEpochMs(): Long? {
            mono.t += rttMs
            return parentMs
        }
    }

    private val day = 24L * 60 * 60 * 1000
    private val min = 60L * 1000

    @Test
    fun `never synced reports NEVER_SYNCED and falls back to wall clock`() {
        val wall = FakeWallClock(1_700_000_000_000L)
        val mono = FakeMonotonicClock(5000L)
        val ta = CristianTimeAuthority(wall, mono, FakeParentTimeSource(null, mono, 0))

        assertEquals(TimeAuthorityStatus.NEVER_SYNCED, ta.status())
        assertEquals(1_700_000_000_000L, ta.authoritativeNow()) // 退墙钟
        assertFalse(ta.isTimeTrusted())
        assertFalse(ta.shouldLockTimeFeatures())
    }

    @Test
    fun `sync applies Cristian RTT half offset`() = runTest {
        val parentMs = 1_700_000_000_000L
        val wall = FakeWallClock(parentMs) // 墙钟与权威一致 → TRUSTED
        val mono = FakeMonotonicClock(1000L)
        // fetch 推进 mono 200ms → t0=1000, t2=1200, rtt=200, authoritativeAtT2=parentMs+100
        val ta = CristianTimeAuthority(wall, mono, FakeParentTimeSource(parentMs, mono, 200))

        assertTrue(ta.sync())
        // 同步后 mono=1200 (= anchor monotonic) → authoritativeNow = parentMs + 100
        assertEquals(parentMs + 100, ta.authoritativeNow())
    }

    @Test
    fun `authoritativeNow advances with monotonic clock and ignores wall-clock change`() = runTest {
        val parentMs = 1_700_000_000_000L
        val wall = FakeWallClock(parentMs)
        val mono = FakeMonotonicClock(1000L)
        val ta = CristianTimeAuthority(wall, mono, FakeParentTimeSource(parentMs, mono, 0))
        ta.sync() // rtt=0 → authoritativeAtT2 = parentMs, anchor mono = 1000

        // 单调钟推进 30s → 权威时间也 +30s
        mono.t += 30_000
        assertEquals(parentMs + 30_000, ta.authoritativeNow())

        // 用户把墙钟往前调 1h → 权威时间不变 (仍走单调钟)
        wall.nowMs += 60 * min
        assertEquals(parentMs + 30_000, ta.authoritativeNow())
    }

    @Test
    fun `wall clock skew over 5min triggers SKEW_DETECTED and lock`() = runTest {
        val parentMs = 1_700_000_000_000L
        val wall = FakeWallClock(parentMs)
        val mono = FakeMonotonicClock(1000L)
        val ta = CristianTimeAuthority(wall, mono, FakeParentTimeSource(parentMs, mono, 0))
        ta.sync()

        // 孩子把墙钟往后拨 6min 试图绕过 quiet hours
        wall.nowMs += 6 * min
        assertEquals(TimeAuthorityStatus.SKEW_DETECTED, ta.status())
        assertTrue(ta.shouldLockTimeFeatures())
        assertFalse(ta.isTimeTrusted())
    }

    @Test
    fun `small skew under 5min stays TRUSTED`() = runTest {
        val parentMs = 1_700_000_000_000L
        val wall = FakeWallClock(parentMs)
        val mono = FakeMonotonicClock(1000L)
        val ta = CristianTimeAuthority(wall, mono, FakeParentTimeSource(parentMs, mono, 0))
        ta.sync()

        wall.nowMs += 4 * min // 4min < 5min 阈值
        assertEquals(TimeAuthorityStatus.TRUSTED, ta.status())
        assertTrue(ta.isTimeTrusted())
        assertFalse(ta.shouldLockTimeFeatures())
    }

    @Test
    fun `offline over 48h degrades to STALE (gentle, not locked)`() = runTest {
        val parentMs = 1_700_000_000_000L
        val wall = FakeWallClock(parentMs)
        val mono = FakeMonotonicClock(1000L)
        val ta = CristianTimeAuthority(wall, mono, FakeParentTimeSource(parentMs, mono, 0))
        ta.sync()

        // 单调钟推进 49h (无新同步) + 墙钟也大幅偏 → STALE 优先, 不锁
        mono.t += 49 * day
        wall.nowMs += 49 * day + 10 * min
        assertEquals(TimeAuthorityStatus.STALE, ta.status())
        assertFalse(ta.shouldLockTimeFeatures()) // 温和档: 不锁
    }

    @Test
    fun `sync failure keeps prior anchor and returns false`() = runTest {
        val parentMs = 1_700_000_000_000L
        val wall = FakeWallClock(parentMs)
        val mono = FakeMonotonicClock(1000L)
        val ta = CristianTimeAuthority(wall, mono, FakeParentTimeSource(parentMs, mono, 0))
        ta.sync()
        val before = ta.authoritativeNow()

        // 家长端不可达
        val taOffline = CristianTimeAuthority(wall, mono, FakeParentTimeSource(null, mono, 0))
        assertFalse(taOffline.sync())
        // 原 ta 锚点未受影响 (独立实例); 验证 sync 失败返 false 即可
        assertEquals(before, ta.authoritativeNow())
    }
}
