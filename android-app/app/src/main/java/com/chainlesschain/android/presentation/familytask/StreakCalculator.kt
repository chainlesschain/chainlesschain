package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus

/**
 * §3.9 streak bonus 的**连续准时天数**纯聚合 (PointsEngine.streakBonus 的喂数侧,
 * 该引擎函数落地以来 dormant 无调用方)。
 *
 * 口径: 某日"准时完成" = 该日 (按 UTC 日界, 设备本地时区精化是真机 follow-up)
 * 有 ≥1 个 DONE 任务, 且该任务无截止或完成时刻 ≤ 截止。streak = 以**今天**结尾的
 * 连续准时日数 (今天没完成 → 0, 不看历史)。时间注入, 确定性可测。
 */
object StreakCalculator {

    private const val DAY_MS = 86_400_000L

    fun consecutiveOnTimeDays(tasks: List<FamilyTask>, now: Long): Int {
        val onTimeDays = tasks
            .filter { it.status == FamilyTaskStatus.DONE }
            .filter { it.dueAtMs == null || it.updatedAtMs <= it.dueAtMs!! }
            .map { it.updatedAtMs / DAY_MS }
            .toSet()

        var streak = 0
        var day = now / DAY_MS
        while (day in onTimeDays) {
            streak++
            day--
        }
        return streak
    }
}
