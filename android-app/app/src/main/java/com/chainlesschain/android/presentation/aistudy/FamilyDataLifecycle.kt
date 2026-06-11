package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.familyguard.data.dao.GuardrailEventDao
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import timber.log.Timber
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §4.6 数据生命周期清理协调器 (AI 陪学子集, 主文档表):
 *
 *   - 任务历史 1y (终态 done/cancelled 过期删 — [FamilyTaskRepository.deleteTerminalOlderThan],
 *     此前 dormant 无调用方)
 *   - 护栏事件 30d (内容类 L2 口径 — [GuardrailEventDao.deleteOlderThan], 同 dormant)
 *   - 陪伴对话 30d (TEE vault 内自动删 — [CompanionVault.pruneOlderThan])
 *
 * 错题本/积分历史 = 永久仅用户主动删, 不在此清理。**24h 节流** (进程内): 由高频入口
 * (家庭任务屏) 触发, 幂等 best-effort, 单项失败不影响其余。WorkManager 定时调度是
 * 设备 follow-up; 本协调器即其 worker 的执行体。
 */
@Singleton
class FamilyDataLifecycle @Inject constructor(
    private val taskRepository: FamilyTaskRepository,
    private val guardrailEventDao: GuardrailEventDao,
    private val companionVault: CompanionVault,
) {

    private val lastRunMs = AtomicLong(0L)

    /** 到期则跑一轮清理; 24h 内重复调用为 no-op。返回是否真跑了。 */
    suspend fun runIfDue(now: Long): Boolean {
        val last = lastRunMs.get()
        if (now - last < MIN_INTERVAL_MS) return false
        if (!lastRunMs.compareAndSet(last, now)) return false

        runCatching { taskRepository.deleteTerminalOlderThan(now - TASK_RETENTION_MS) }
            .onFailure { Timber.w(it, "lifecycle: task cleanup failed") }
        runCatching { guardrailEventDao.deleteOlderThan(now - GUARDRAIL_RETENTION_MS) }
            .onFailure { Timber.w(it, "lifecycle: guardrail cleanup failed") }
        runCatching { companionVault.pruneOlderThan(now - COMPANION_RETENTION_MS) }
            .onFailure { Timber.w(it, "lifecycle: companion prune failed") }
        return true
    }

    companion object {
        private const val DAY_MS = 86_400_000L

        /** 任务历史保留 1 年 (§4.6)。 */
        const val TASK_RETENTION_MS = 365 * DAY_MS

        /** 护栏事件保留 30 天 (§4.6 内容类 L2 口径)。 */
        const val GUARDRAIL_RETENTION_MS = 30 * DAY_MS

        /** 陪伴对话保留 30 天 (§4.6)。 */
        const val COMPANION_RETENTION_MS = 30 * DAY_MS

        /** 节流: 每 24h 至多跑一轮。 */
        const val MIN_INTERVAL_MS = DAY_MS
    }
}
