package com.chainlesschain.android.presentation.parentedu

import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import org.junit.Assert.assertEquals
import org.junit.Test

/** M10 任务史 → GuardianMetrics 纯聚合 ([GuardianMetricsAggregator])。 */
class GuardianMetricsAggregatorTest {

    private val now = 100L * 24 * 60 * 60 * 1000 // 第 100 天

    private fun task(
        id: String,
        status: FamilyTaskStatus = FamilyTaskStatus.DONE,
        createdAt: Long = now - 1_000L,
        dueAt: Long? = null,
    ) = FamilyTask(
        id = id,
        familyGroupId = "g1",
        assignerDid = "did:chain:parent",
        childDid = "did:chain:child",
        title = "t",
        status = status,
        dueAtMs = dueAt,
        createdAtMs = createdAt,
        updatedAtMs = createdAt,
    )

    @Test
    fun `empty history yields all-zero task metrics`() {
        val m = GuardianMetricsAggregator.aggregate(emptyList(), now)
        assertEquals(0.0, m.cancellationRate, 1e-9)
        assertEquals(0.0, m.taskDeferralRate, 1e-9)
        assertEquals(0, m.forceStopCount)
    }

    @Test
    fun `cancellation rate is cancelled over all tasks in window`() {
        val m = GuardianMetricsAggregator.aggregate(
            listOf(
                task("a", FamilyTaskStatus.DONE),
                task("b", FamilyTaskStatus.CANCELLED),
                task("c", FamilyTaskStatus.IN_PROGRESS),
                task("d", FamilyTaskStatus.CANCELLED),
            ),
            now,
        )
        assertEquals(0.5, m.cancellationRate, 1e-9)
    }

    @Test
    fun `tasks outside the 30-day window are ignored`() {
        val outside = now - GuardianMetricsAggregator.DEFAULT_WINDOW_MS - 1_000L
        val m = GuardianMetricsAggregator.aggregate(
            listOf(
                task("old-cancelled", FamilyTaskStatus.CANCELLED, createdAt = outside),
                task("recent-done", FamilyTaskStatus.DONE),
            ),
            now,
        )
        assertEquals(0.0, m.cancellationRate, 1e-9)
    }

    @Test
    fun `deferral rate counts overdue incomplete among tasks with due dates`() {
        val m = GuardianMetricsAggregator.aggregate(
            listOf(
                // 过期未完成 → 计延期
                task("late", FamilyTaskStatus.IN_PROGRESS, dueAt = now - 1L),
                // 过期但已完成 → 不计
                task("done-late", FamilyTaskStatus.DONE, dueAt = now - 1L),
                // 过期但已取消 → 不计 (取消已进 cancellationRate, 不双罚)
                task("cancelled-late", FamilyTaskStatus.CANCELLED, dueAt = now - 1L),
                // 未到期 → 不计
                task("not-due", FamilyTaskStatus.IN_PROGRESS, dueAt = now + 1_000L),
                // 无截止 → 不进分母
                task("no-due", FamilyTaskStatus.IN_PROGRESS),
            ),
            now,
        )
        assertEquals(0.25, m.taskDeferralRate, 1e-9)
    }

    @Test
    fun `telemetry seam passes through and clamps`() {
        val m = GuardianMetricsAggregator.aggregate(
            listOf(task("a")),
            now,
            telemetry = GuardianMetricsAggregator.TelemetryCounts(
                forceStopCount = 12,
                urgentCallCount = -3,
                rejectionRate = 1.7,
            ),
        )
        assertEquals(12, m.forceStopCount)
        assertEquals(0, m.urgentCallCount) // 负值钳到 0
        assertEquals(1.0, m.rejectionRate, 1e-9) // 超界钳到 1
    }
}
