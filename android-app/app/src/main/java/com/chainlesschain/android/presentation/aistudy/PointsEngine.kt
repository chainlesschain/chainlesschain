package com.chainlesschain.android.presentation.aistudy

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * M9 奖励 / 积分引擎 (主文档 §3.9，v0.2)。
 *
 * 这一层是 M9 里**纯逻辑、可单测、零设备**的核心：
 *   - ledger 折叠 → 余额 ([PointsEngine.computeBalance])
 *   - 完成任务 → earn 计算 + 防作弊 ([PointsEngine.decideEarn])
 *   - 兑换 → spend 校验 ([PointsEngine.decideSpend])
 *   - 家长发放 → grant 校验 ([PointsEngine.decideGrant])
 *
 * **设备/UI/后端阻塞的部分留 follow-up**：reward_catalog CRUD UI、balance/history UI、
 * spend → M4 临时白名单实际下发、P2P earn/spend 同步与冲突解决、SQLCipher 持久化。
 * 这里只把"算多少分、能不能花、能不能发"做透；调用方 (VM/Repository) 负责落盘与联动。
 *
 * 设计取向同 [StudyTaskContext]：引擎纯函数 + 时间/随机由调用方注入 (eventId / now)，
 * 单日上限等聚合也由调用方按"今日"边界预聚合后传入，引擎本身时间无关、可确定性测试。
 */

/** points_event.type。earn/grant 为正，spend/revoke/expire 记为负。 */
enum class PointsEventType { EARN, SPEND, GRANT, REVOKE, EXPIRE }

/**
 * 一条积分流水 (对应 SQL `points_event`)。amount 带符号：earn/grant 正，spend/revoke/expire 负。
 */
data class PointsEvent(
    val id: String,
    val childDid: String,
    val type: PointsEventType,
    val amount: Int,
    val reason: String,
    val relatedTaskId: String? = null,
    val relatedRewardId: String? = null,
    val granterDid: String? = null,
    val timestamp: Long,
)

/** 积分余额快照 (对应 SQL `points_balance`)。由 [PointsEngine.computeBalance] 从流水折叠得到。 */
data class PointsBalance(
    val childDid: String,
    val balance: Int,
    val lifetimeEarned: Int,
    val lifetimeSpent: Int,
    val updatedAt: Long,
)

/** reward_catalog.deliverable 的种类 (主文档 §3.9 表)。 */
enum class DeliverableKind {
    /** 额外屏幕时间 N 分钟 → M4 临时白名单。 */
    SCREEN_TIME_MIN,

    /** 解锁某 app N 小时 → M4 临时白名单。 */
    APP_UNLOCK,

    /** 推迟就寝 N 分钟 → M4 时间窗口扩展。 */
    DELAYED_BEDTIME_MIN,

    /** 全家活动 → 通知家长执行。 */
    FAMILY_ACTIVITY,

    /** 实物兑换 → 通知家长。 */
    REAL_WORLD_VOUCHER,

    /** 零花钱 → 通知家长。 */
    CASH,
}

/** deliverable 结构化封装 (SQL 里是 JSON `{kind, value, target_apps}`)。 */
data class Deliverable(
    val kind: DeliverableKind,
    /** 分钟数 / 小时数 / 金额，按 kind 解释；FAMILY_ACTIVITY 等可为 0。 */
    val value: Int = 0,
    /** APP_UNLOCK 等针对的目标 app 包名。 */
    val targetApps: List<String> = emptyList(),
)

/** 一条兑换目录项 (对应 SQL `reward_catalog`)。 */
data class RewardCatalogItem(
    val id: String,
    val familyGroupId: String,
    val name: String,
    val description: String = "",
    val cost: Int,
    val deliverable: Deliverable,
    /** 单日兑换上限；0 = 无限。 */
    val maxPerDay: Int = 0,
    val active: Boolean = true,
    val createdBy: String,
    val createdAt: Long,
)

/**
 * earn / 防作弊 / grant 规则配置 (主文档 §3.9，家长可改)。默认值取自设计表。
 */
data class EarnRules(
    /** 数学作业全对。 */
    val homeworkFullMark: Int = 30,
    /** 数学作业 80%+。 */
    val homeworkHigh: Int = 20,
    /** 数学作业 60-80%。 */
    val homeworkMid: Int = 10,
    /** 英语作文。 */
    val essay: Int = 25,
    /** 跑步每 1km。 */
    val runningPerKm: Int = 5,
    /** 错题本复习满 5 题。 */
    val mistakeReview5: Int = 8,
    /** 主动按时完成所有任务，额外。 */
    val allTasksOnTimeBonus: Int = 10,
    /** 连续 7 天准时完成 streak bonus。 */
    val streak7Bonus: Int = 50,
    /** 单日 earn 上限。 */
    val dailyEarnCap: Int = 200,
    /** 满分但疑似反复改答案的阈值：answer-seeking 次数 ≥ 此值则按 50% 计。 */
    val answerSeekingHalveThreshold: Int = 3,
    /** 家长 grant 单笔上限。 */
    val grantPerEvent: Int = 100,
    /** 家长 grant 单日总上限。 */
    val grantDailyCap: Int = 300,
)

/** 一次"完成"事件，喂给 earn 引擎。 */
sealed interface Completion {
    val taskId: String

    /**
     * 作业批改完成。[scorePct] 0-100；[answerSeekingAttempts] 来自 [TaskAiCall] 中
     * [AiCallKind.ANSWER_SEEKING] 的计数 (防作弊)。
     */
    data class Homework(
        override val taskId: String,
        val scorePct: Int,
        val answerSeekingAttempts: Int = 0,
    ) : Completion

    /** 英语作文。 */
    data class Essay(override val taskId: String) : Completion

    /** 跑步 [km] 公里 (取整)。 */
    data class Running(override val taskId: String, val km: Int) : Completion

    /** 错题本复习，[count] 道。满 5 题给分 (不足不给)。 */
    data class MistakeReview(override val taskId: String, val count: Int) : Completion

    /**
     * 按布置时的面值发放 (family_task.rewardPoints)：非作业类任务 (chore/reading/...)，
     * 以及作业批改失败无可解析分数时的兜底 (M5→M9 联动, [points] ≤ 0 不发)。
     */
    data class Fixed(override val taskId: String, val points: Int) : Completion
}

/** earn 计算的上下文聚合 (调用方按"今日 + 该任务"预聚合后传入)。 */
data class EarnContext(
    /** 该 task 是否已 earn 过 (同 task 不可重复)。 */
    val taskAlreadyEarned: Boolean = false,
    /** 今日已 earn 累计 (用于单日上限)。 */
    val earnedToday: Int = 0,
)

/** earn 决策结果。 */
data class EarnDecision(
    /** 实际入账分值；被拒为 0。 */
    val approvedAmount: Int,
    /** 防作弊/上限调整前的原始分值。 */
    val rawAmount: Int,
    /** 入账流水；被拒为 null。 */
    val event: PointsEvent?,
    /** 调整/拒绝说明 (家长可见审计)。 */
    val notes: List<String>,
) {
    val rejected: Boolean get() = event == null
}

/** spend 决策结果。 */
data class SpendDecision(
    val approved: Boolean,
    val event: PointsEvent?,
    val reason: String,
)

/** grant 决策结果。 */
data class GrantDecision(
    val approvedAmount: Int,
    val event: PointsEvent?,
    val notes: List<String>,
) {
    val rejected: Boolean get() = event == null
}

object PointsEngine {

    /** 从流水折叠出余额 (纯函数)。amount 已带符号，直接求和即为当前余额。 */
    fun computeBalance(childDid: String, events: List<PointsEvent>, updatedAt: Long): PointsBalance {
        val mine = events.filter { it.childDid == childDid }
        val balance = mine.sumOf { it.amount }
        val earned = mine.filter { it.amount > 0 }.sumOf { it.amount }
        val spent = -mine.filter { it.amount < 0 }.sumOf { it.amount } // 正数表示"花了多少"
        return PointsBalance(
            childDid = childDid,
            balance = balance,
            lifetimeEarned = earned,
            lifetimeSpent = spent,
            updatedAt = updatedAt,
        )
    }

    /** 作业分值 → 基础积分 (主文档 §3.9 earn 表)。 */
    fun homeworkPoints(scorePct: Int, rules: EarnRules): Int = when {
        scorePct >= 100 -> rules.homeworkFullMark
        scorePct >= 80 -> rules.homeworkHigh
        scorePct in 60..79 -> rules.homeworkMid
        else -> 0
    }

    /** 某次完成的原始分值 (未含防作弊/上限)。 */
    fun rawPoints(completion: Completion, rules: EarnRules): Int = when (completion) {
        is Completion.Homework -> homeworkPoints(completion.scorePct, rules)
        is Completion.Essay -> rules.essay
        is Completion.Running -> maxOf(0, completion.km) * rules.runningPerKm
        is Completion.MistakeReview -> if (completion.count >= 5) rules.mistakeReview5 else 0
        is Completion.Fixed -> maxOf(0, completion.points)
    }

    /**
     * earn 全决策：原始分 → 防作弊调整 → 同 task 去重 → 单日上限截断。
     *
     * 防作弊 (§3.9)：
     *   - 同 task 已 earn → 拒绝 (0)。
     *   - 作业满分但 answer-seeking ≥ 阈值 → 仅算 50%。
     *   - 命中单日上限 → 截断到剩余额度 (可能为 0)。
     */
    fun decideEarn(
        childDid: String,
        completion: Completion,
        reason: String,
        context: EarnContext,
        eventId: String,
        now: Long,
        rules: EarnRules = EarnRules(),
    ): EarnDecision {
        val raw = rawPoints(completion, rules)
        val notes = mutableListOf<String>()

        if (context.taskAlreadyEarned) {
            return EarnDecision(0, raw, null, listOf("该任务已发放过积分，不重复计"))
        }
        if (raw <= 0) {
            return EarnDecision(0, raw, null, listOf("未达发放门槛，本次 0 分"))
        }

        var amount = raw
        // 满分但反复改答案 → 50%
        if (completion is Completion.Homework &&
            completion.scorePct >= 100 &&
            completion.answerSeekingAttempts >= rules.answerSeekingHalveThreshold
        ) {
            amount = raw / 2
            notes += "满分但疑似反复索要答案 ${completion.answerSeekingAttempts} 次，按 50% 计 ($amount)"
        }

        // 单日上限截断
        val remainingToday = (rules.dailyEarnCap - context.earnedToday).coerceAtLeast(0)
        if (amount > remainingToday) {
            notes += "命中单日上限 ${rules.dailyEarnCap}，本次截断至 $remainingToday"
            amount = remainingToday
        }
        if (amount <= 0) {
            return EarnDecision(0, raw, null, notes + "今日已达上限，本次 0 分")
        }

        val event = PointsEvent(
            id = eventId,
            childDid = childDid,
            type = PointsEventType.EARN,
            amount = amount,
            reason = reason,
            relatedTaskId = completion.taskId,
            timestamp = now,
        )
        return EarnDecision(approvedAmount = amount, rawAmount = raw, event = event, notes = notes)
    }

    /**
     * spend 校验：目录项 active + 余额足够 + 未超单日兑换上限。
     */
    fun decideSpend(
        childDid: String,
        item: RewardCatalogItem,
        balance: Int,
        redeemedTodayForItem: Int,
        eventId: String,
        now: Long,
    ): SpendDecision {
        if (!item.active) return SpendDecision(false, null, "该奖励已下架")
        if (balance < item.cost) {
            return SpendDecision(false, null, "积分不足 (需 ${item.cost}，余 $balance)")
        }
        if (item.maxPerDay > 0 && redeemedTodayForItem >= item.maxPerDay) {
            return SpendDecision(false, null, "今日「${item.name}」已达兑换上限 ${item.maxPerDay} 次")
        }
        val event = PointsEvent(
            id = eventId,
            childDid = childDid,
            type = PointsEventType.SPEND,
            amount = -item.cost,
            reason = "兑换「${item.name}」",
            relatedRewardId = item.id,
            timestamp = now,
        )
        return SpendDecision(true, event, "兑换成功")
    }

    /**
     * 家长 grant 校验：单笔 ≤ grantPerEvent，且 + 当日已 grant 不超 grantDailyCap。
     * 超单笔直接拒；触日上限则截断到剩余额度。
     */
    fun decideGrant(
        childDid: String,
        amount: Int,
        reason: String,
        granterDid: String,
        grantedTodayByGuardian: Int,
        eventId: String,
        now: Long,
        rules: EarnRules = EarnRules(),
    ): GrantDecision {
        if (amount <= 0) return GrantDecision(0, null, listOf("发放分值需为正"))
        val notes = mutableListOf<String>()
        if (amount > rules.grantPerEvent) {
            return GrantDecision(0, null, listOf("单笔发放上限 ${rules.grantPerEvent}，本次 $amount 被拒"))
        }
        val remaining = (rules.grantDailyCap - grantedTodayByGuardian).coerceAtLeast(0)
        if (remaining <= 0) {
            return GrantDecision(0, null, listOf("今日发放已达上限 ${rules.grantDailyCap}"))
        }
        var granted = amount
        if (granted > remaining) {
            notes += "命中单日发放上限 ${rules.grantDailyCap}，截断至 $remaining"
            granted = remaining
        }
        val event = PointsEvent(
            id = eventId,
            childDid = childDid,
            type = PointsEventType.GRANT,
            amount = granted,
            reason = reason,
            granterDid = granterDid,
            timestamp = now,
        )
        return GrantDecision(granted, event, notes)
    }

    /**
     * streak bonus：连续准时完成天数达到 7 的整数倍时给一次 bonus。
     * [consecutiveOnTimeDays] 由调用方按日历日预聚合。返回应发 bonus 分 (0 表示本次不发)。
     */
    fun streakBonus(consecutiveOnTimeDays: Int, rules: EarnRules): Int =
        if (consecutiveOnTimeDays > 0 && consecutiveOnTimeDays % 7 == 0) rules.streak7Bonus else 0
}

/**
 * 积分账本 seam。aistudy 侧 VM / Repository 借此读余额、追加流水。
 *
 * suspend + Flow 接口：生产绑 [RoomPointsLedger] (family_guard.db points_event 表,
 * SQLCipher 加密持久)；[InMemoryPointsLedger] 留测试/演示。P2P earn/spend 同步与
 * 冲突解决仍是 follow-up。
 */
interface PointsLedger {
    val events: Flow<List<PointsEvent>>

    suspend fun balanceOf(childDid: String, now: Long): PointsBalance

    /** 追加一条流水 (来自 decide* 的 event)。重复 id (P2P 重放) 静默忽略。 */
    suspend fun append(event: PointsEvent)

    /** 该 task 是否已 earn 过 (防重复)。 */
    suspend fun hasEarnedForTask(childDid: String, taskId: String): Boolean

    /** 某日 [dayStart, dayEnd) 区间内某 child 的 earn 累计。 */
    suspend fun earnedBetween(childDid: String, dayStart: Long, dayEnd: Long): Int

    /** 某日区间内某 guardian 对某 child 的 grant 累计。 */
    suspend fun grantedBetween(granterDid: String, childDid: String, dayStart: Long, dayEnd: Long): Int

    /** 某日区间内某 reward 的兑换次数。 */
    suspend fun redeemCountBetween(childDid: String, rewardId: String, dayStart: Long, dayEnd: Long): Int
}

@Singleton
class InMemoryPointsLedger @Inject constructor() : PointsLedger {
    private val _events = MutableStateFlow<List<PointsEvent>>(emptyList())
    override val events: StateFlow<List<PointsEvent>> = _events.asStateFlow()

    override suspend fun balanceOf(childDid: String, now: Long): PointsBalance =
        PointsEngine.computeBalance(childDid, _events.value, now)

    override suspend fun append(event: PointsEvent) {
        _events.update { existing ->
            if (existing.any { it.id == event.id }) existing else existing + event
        }
    }

    override suspend fun hasEarnedForTask(childDid: String, taskId: String): Boolean =
        _events.value.any {
            it.childDid == childDid &&
                it.type == PointsEventType.EARN &&
                it.relatedTaskId == taskId
        }

    override suspend fun earnedBetween(childDid: String, dayStart: Long, dayEnd: Long): Int =
        _events.value
            .filter {
                it.childDid == childDid && it.type == PointsEventType.EARN &&
                    it.timestamp >= dayStart && it.timestamp < dayEnd
            }
            .sumOf { it.amount }

    override suspend fun grantedBetween(granterDid: String, childDid: String, dayStart: Long, dayEnd: Long): Int =
        _events.value
            .filter {
                it.granterDid == granterDid && it.childDid == childDid &&
                    it.type == PointsEventType.GRANT &&
                    it.timestamp >= dayStart && it.timestamp < dayEnd
            }
            .sumOf { it.amount }

    override suspend fun redeemCountBetween(childDid: String, rewardId: String, dayStart: Long, dayEnd: Long): Int =
        _events.value.count {
            it.childDid == childDid && it.type == PointsEventType.SPEND &&
                it.relatedRewardId == rewardId &&
                it.timestamp >= dayStart && it.timestamp < dayEnd
        }
}
