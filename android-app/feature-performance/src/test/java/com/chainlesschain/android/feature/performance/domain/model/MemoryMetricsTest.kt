package com.chainlesschain.android.feature.performance.domain.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * MemoryMetrics.usagePercent 单测：totalBytes=0 时不得返回 Infinity/NaN（Float 除零不抛
 * 异常而是产出 Infinity/NaN，会污染 UI 与告警阈值）。feature-performance 此前零单测。
 */
class MemoryMetricsTest {

    private fun mem(used: Long, total: Long) =
        MemoryMetrics(usedBytes = used, totalBytes = total, availableBytes = total - used)

    @Test
    fun `usage percent for a half-full heap`() {
        assertEquals(50f, mem(512, 1024).usagePercent, 1e-4f)
    }

    @Test
    fun `usage percent for a full heap`() {
        assertEquals(100f, mem(1024, 1024).usagePercent, 1e-4f)
    }

    @Test
    fun `zero total yields a finite 0 percent, not Infinity or NaN (regression)`() {
        val p = mem(100, 0).usagePercent
        assertFalse("must be finite", p.isInfinite() || p.isNaN())
        assertEquals(0f, p, 0f)
    }
}
