package com.chainlesschain.android.presentation.parentedu

import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.presentation.aistudy.GuardianMetrics

/**
 * M10 真实数据聚合：把 M5 family_task 30 天窗口史折算成 [GuardianMetrics]
 * (主文档 §3.10 "metrics 由 telemetry 聚合" 的任务侧子集)。
 *
 * 纯函数、时间由调用方注入。**采集缺口走显式 seam 不造假**：
 *   - cancellationRate / taskDeferralRate — 可由任务史真实导出 (本对象)。
 *   - forceStopCount / urgentCallCount — 需 M4 执行层/通话层计数，[TelemetryCounts]
 *     由调用方注入 (未接前默认 0)。
 *   - rejectionRate — 需家长审批日志 (schema 缺口)，同样注入。
 */
object GuardianMetricsAggregator {

    const val DEFAULT_WINDOW_MS: Long = 30L * 24 * 60 * 60 * 1000

    /** 设备/执行层计数 seam (M4 force-stop / D epic 强接通)。未接线前默认 0。 */
    data class TelemetryCounts(
        val forceStopCount: Int = 0,
        val urgentCallCount: Int = 0,
        /** 审批拒绝率 0..1 (家长审批日志缺口 seam)。 */
        val rejectionRate: Double = 0.0,
    )

    /**
     * 聚合窗口内任务史 → [GuardianMetrics]。
     *
     * - cancellationRate = 窗口内 CANCELLED / 全部任务 (家长取消/驳回的比例)。
     * - taskDeferralRate = 有截止时间的任务中，已过期仍未完成 (非 DONE/CANCELLED) 的比例。
     * - 空窗口 → 全 0 (报告呈现"暂无数据"语义而非满分/零分假信号由 UI 层决定)。
     */
    fun aggregate(
        tasks: List<FamilyTask>,
        now: Long,
        windowMs: Long = DEFAULT_WINDOW_MS,
        telemetry: TelemetryCounts = TelemetryCounts(),
    ): GuardianMetrics {
        val windowStart = now - windowMs
        val windowed = tasks.filter { it.createdAtMs >= windowStart && it.createdAtMs <= now }

        val cancellationRate =
            if (windowed.isEmpty()) {
                0.0
            } else {
                windowed.count { it.status == FamilyTaskStatus.CANCELLED }.toDouble() / windowed.size
            }

        val withDue = windowed.filter { it.dueAtMs != null }
        val deferralRate =
            if (withDue.isEmpty()) {
                0.0
            } else {
                withDue.count { it.isOverdueIncomplete(now) }.toDouble() / withDue.size
            }

        return GuardianMetrics(
            rejectionRate = telemetry.rejectionRate.coerceIn(0.0, 1.0),
            cancellationRate = cancellationRate,
            forceStopCount = telemetry.forceStopCount.coerceAtLeast(0),
            urgentCallCount = telemetry.urgentCallCount.coerceAtLeast(0),
            taskDeferralRate = deferralRate,
        )
    }

    private fun FamilyTask.isOverdueIncomplete(now: Long): Boolean {
        val due = dueAtMs ?: return false
        return now > due &&
            status != FamilyTaskStatus.DONE &&
            status != FamilyTaskStatus.CANCELLED
    }
}
