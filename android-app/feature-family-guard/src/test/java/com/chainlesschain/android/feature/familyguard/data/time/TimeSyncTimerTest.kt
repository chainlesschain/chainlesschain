package com.chainlesschain.android.feature.familyguard.data.time

import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthorityStatus
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * FAMILY-60 验收: [TimeSyncTimer] 单次同步委托 [TimeAuthority.sync]。
 * 周期 while-delay 循环不直测 (生产协程, 避 [[android_runtest_production_scope_hang]]);
 * 单次 [TimeSyncTimer.syncOnce] 即覆盖业务。
 */
class TimeSyncTimerTest {

    private class FakeTimeAuthority(private val result: Boolean) : TimeAuthority {
        var syncCalls = 0
        override fun authoritativeNow(): Long = 0L
        override fun status(): TimeAuthorityStatus = TimeAuthorityStatus.NEVER_SYNCED
        override fun isTimeTrusted(): Boolean = false
        override fun shouldLockTimeFeatures(): Boolean = false
        override suspend fun sync(): Boolean {
            syncCalls++
            return result
        }
    }

    @Test
    fun `syncOnce delegates to TimeAuthority sync and returns true`() = runTest {
        val ta = FakeTimeAuthority(result = true)
        val timer = TimeSyncTimer(ta)
        assertTrue(timer.syncOnce())
        assertEquals(1, ta.syncCalls)
    }

    @Test
    fun `syncOnce returns false when parent unreachable`() = runTest {
        val ta = FakeTimeAuthority(result = false)
        val timer = TimeSyncTimer(ta)
        assertFalse(timer.syncOnce())
        assertEquals(1, ta.syncCalls)
    }

    @Test
    fun `stop before start is a no-op`() {
        val ta = FakeTimeAuthority(result = true)
        val timer = TimeSyncTimer(ta)
        timer.stop() // 不抛
        assertEquals(0, ta.syncCalls)
    }
}
