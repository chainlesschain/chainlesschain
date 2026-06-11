package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import org.junit.Assert.assertEquals
import org.junit.Test

/** §3.9 streak 喂数侧 ([StreakCalculator]): 连续准时天数口径。 */
class StreakCalculatorTest {

    private val dayMs = 86_400_000L
    private val now = 100 * dayMs + 12 * 60 * 60 * 1000 // 第 100 天中午

    private fun done(daysAgo: Int, dueAt: Long? = null, status: FamilyTaskStatus = FamilyTaskStatus.DONE) =
        FamilyTask(
            id = "t-$daysAgo-${dueAt ?: 0}",
            familyGroupId = "g1",
            assignerDid = "p",
            childDid = "c",
            title = "t",
            status = status,
            dueAtMs = dueAt,
            createdAtMs = now - daysAgo * dayMs - 1_000L,
            updatedAtMs = now - daysAgo * dayMs,
        )

    @Test
    fun `counts consecutive on-time days ending today`() {
        val tasks = listOf(done(0), done(1), done(2))
        assertEquals(3, StreakCalculator.consecutiveOnTimeDays(tasks, now))
    }

    @Test
    fun `gap breaks the streak`() {
        val tasks = listOf(done(0), done(2), done(3)) // 昨天空
        assertEquals(1, StreakCalculator.consecutiveOnTimeDays(tasks, now))
    }

    @Test
    fun `no completion today means zero regardless of history`() {
        val tasks = listOf(done(1), done(2), done(3))
        assertEquals(0, StreakCalculator.consecutiveOnTimeDays(tasks, now))
    }

    @Test
    fun `overdue completion does not count as on-time`() {
        val overdueToday = done(0, dueAt = now - dayMs) // 截止在昨天, 今天才完成
        val onTimeYesterday = done(1)
        assertEquals(0, StreakCalculator.consecutiveOnTimeDays(listOf(overdueToday, onTimeYesterday), now))
    }

    @Test
    fun `non-done tasks and same-day duplicates do not inflate`() {
        val tasks = listOf(
            done(0), done(0), // 同日两个 → 仍只算一天
            done(1, status = FamilyTaskStatus.CANCELLED), // 取消不算
        )
        assertEquals(1, StreakCalculator.consecutiveOnTimeDays(tasks, now))
    }

    @Test
    fun `seven day streak feeds the engine bonus`() {
        val tasks = (0..6).map { done(it) }
        val days = StreakCalculator.consecutiveOnTimeDays(tasks, now)
        assertEquals(7, days)
    }
}
