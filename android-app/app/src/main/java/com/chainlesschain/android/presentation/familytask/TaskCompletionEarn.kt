package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogCodec
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskType
import com.chainlesschain.android.presentation.aistudy.AiCallKind
import com.chainlesschain.android.presentation.aistudy.Completion
import com.chainlesschain.android.presentation.aistudy.EarnContext
import com.chainlesschain.android.presentation.aistudy.EarnDecision
import com.chainlesschain.android.presentation.aistudy.EarnRules
import com.chainlesschain.android.presentation.aistudy.PointsEngine
import com.chainlesschain.android.presentation.aistudy.PointsLedger
import com.chainlesschain.android.presentation.aistudy.TaskAiCall

/**
 * M5 → M9 联动：任务完成 (DONE) 时自动发积分 (主文档 §3.9 "earn 由 M5 任务完成自动触发")。
 *
 * 纯逻辑、可单测、零设备：分数从 [FamilyTask.aiGrade] 文案解析；answer-seeking 计数合并
 * 持久 ai_call_log 与 StudyTaskContext 内存 log；决策走 [PointsEngine.decideEarn]
 * (同 task 去重 / 满分防作弊 / 单日上限)。时间与 eventId 由调用方 (VM) 注入。
 */
object TaskCompletionEarn {

    private const val DAY_MS = 86_400_000L
    private const val ANSWER_SEEKING_KIND = "answer_seeking"

    /** [FamilyTaskViewModel.formatGrade] 写入的 "NN 分 — 评语" 前缀。 */
    private val SCORE_PREFIX = Regex("""^\s*(\d{1,3})\s*分""")

    /** 从 "NN 分 — 评语" 格式的 [FamilyTask.aiGrade] 解析分数；批改失败只有评语时返回 null。 */
    fun parseScorePct(aiGrade: String?): Int? = aiGrade
        ?.let { SCORE_PREFIX.find(it)?.groupValues?.get(1)?.toIntOrNull() }
        ?.coerceIn(0, 100)

    /** answer-seeking 总次数 = 持久 ai_call_log + StudyTaskContext 内存 log (未落盘部分)。 */
    fun answerSeekingCount(persistedLog: String?, contextCalls: List<TaskAiCall>): Int =
        AiCallLogCodec.decode(persistedLog).count { it.kind == ANSWER_SEEKING_KIND } +
            contextCalls.count { it.kind == AiCallKind.ANSWER_SEEKING }

    /**
     * 任务 → [Completion] 映射：HOMEWORK 走批改分档 (§3.9 earn 表)；批改失败解析不到分数、
     * 以及其余类型 (chore/reading/...) 按布置时的 [FamilyTask.rewardPoints] 面值发放。
     * rewardPoints ≤ 0 时返回 null (该任务不参与积分)。
     */
    fun completionFor(task: FamilyTask, answerSeekingAttempts: Int): Completion? {
        if (task.type == FamilyTaskType.HOMEWORK) {
            val score = parseScorePct(task.aiGrade)
            if (score != null) return Completion.Homework(task.id, score, answerSeekingAttempts)
        }
        return task.rewardPoints.takeIf { it > 0 }?.let { Completion.Fixed(task.id, it) }
    }

    /** 家长可读的入账理由 (进流水审计)。 */
    fun earnReason(task: FamilyTask, completion: Completion): String = when (completion) {
        is Completion.Homework -> "完成作业「${task.title}」（${completion.scorePct} 分）"
        else -> "完成任务「${task.title}」"
    }

    /**
     * 完成时全流程：映射 Completion → 查账本聚合 (同 task 去重 / 今日累计) → decideEarn
     * → 批准则入账。返回 null = 该任务不参与积分。
     */
    fun earnOnDone(
        task: FamilyTask,
        contextCalls: List<TaskAiCall>,
        ledger: PointsLedger,
        eventId: String,
        now: Long,
        rules: EarnRules = EarnRules(),
    ): EarnDecision? {
        val completion = completionFor(task, answerSeekingCount(task.aiCallLog, contextCalls))
            ?: return null
        val dayStart = now - (now % DAY_MS)
        val decision = PointsEngine.decideEarn(
            childDid = task.childDid,
            completion = completion,
            reason = earnReason(task, completion),
            context = EarnContext(
                taskAlreadyEarned = ledger.hasEarnedForTask(task.childDid, task.id),
                earnedToday = ledger.earnedBetween(task.childDid, dayStart, dayStart + DAY_MS),
            ),
            eventId = eventId,
            now = now,
            rules = rules,
        )
        decision.event?.let(ledger::append)
        return decision
    }
}
