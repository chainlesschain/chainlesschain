package com.chainlesschain.android.feature.familyguard.domain.enforce

import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import com.chainlesschain.android.feature.familyguard.domain.merger.AppBlocklistConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.AppTimeLimitConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.RuleMerger
import com.chainlesschain.android.feature.familyguard.domain.merger.TimeWindow
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

/**
 * Epic D 管控评估引擎的**纯逻辑核** (主文档 §3.4): "app X 此刻能不能用、还剩多少时间"。
 *
 * 确定性、零设备: 规则集 (调用方传 observeActiveNonExpired 结果)、今日已用时长
 * (UsageStats 预聚合)、当前时刻 (分钟) 全部注入。设备侧 (DPC/VPN 真拦截、
 * UsageStats 采集、定时重评) 是 Epic D 真机 follow-up; 这一层把判定语义做透:
 *
 *   1. 兑换的解锁例外 ([RewardTempException]) **放行一切** —— 奖励语义优先;
 *   2. app_blocklist 多家长**并集** ([RuleMerger.mergeAppBlocklist]) 命中即拦;
 *   3. app_time_limit 多家长**最严合并** ([RuleMerger.mergeAppTimeLimit]):
 *      时间窗口 (工作日/周末, 兑换的就寝推迟**延后窗口末端**, 支持跨午夜) +
 *      当日额度 (兑换的额外屏幕时间计入预算);
 *   4. 坏 config JSON 行跳过不崩 (fail-open 到下一条规则, 不 fail-open 整个判定)。
 */
object EnforcementEvaluator {

    const val RULE_APP_BLOCKLIST = "app_blocklist"
    const val RULE_APP_TIME_LIMIT = "app_time_limit"

    enum class BlockReason { NONE, BLOCKLIST, TIME_LIMIT, TIME_WINDOW }

    data class AppDecision(
        val allowed: Boolean,
        val reason: BlockReason,
        /** 当日剩余秒 (含兑换加成); 无 time_limit 规则时为 null。 */
        val remainingSec: Int?,
    )

    private val json = Json { ignoreUnknownKeys = true }

    fun evaluateApp(
        packageName: String,
        rules: List<EnforceRuleEntity>,
        usedTodaySec: Int,
        minutesOfDay: Int,
        isWeekend: Boolean,
        now: Long,
    ): AppDecision {
        // 1. 兑换解锁例外优先放行。
        if (TempExceptionEvaluator.appUnlockActive(rules, packageName, now)) {
            return AppDecision(allowed = true, reason = BlockReason.NONE, remainingSec = null)
        }
        val active = rules.filter { it.active }

        // 2. blocklist 并集。
        val blocklist = RuleMerger.mergeAppBlocklist(
            active.filter { it.ruleType == RULE_APP_BLOCKLIST }
                .mapNotNull { decode<AppBlocklistConfig>(it.config) },
        )
        if (packageName in blocklist.packages) {
            return AppDecision(allowed = false, reason = BlockReason.BLOCKLIST, remainingSec = null)
        }

        // 3. time limit 最严合并; 无规则 → 放行无额度概念。
        val limit = RuleMerger.mergeAppTimeLimit(
            active.filter { it.ruleType == RULE_APP_TIME_LIMIT && it.target == packageName }
                .mapNotNull { decode<AppTimeLimitConfig>(it.config) }
                .filter { it.packageName == packageName },
        ) ?: return AppDecision(allowed = true, reason = BlockReason.NONE, remainingSec = null)

        // 3a. 时间窗口 (就寝推迟延后窗口末端)。
        val window = if (isWeekend) limit.weekendWindow else limit.weekdayWindow
        if (window != null) {
            val delay = TempExceptionEvaluator.bedtimeDelayMinutes(rules, now)
            if (!inWindow(window, minutesOfDay, delay)) {
                return AppDecision(allowed = false, reason = BlockReason.TIME_WINDOW, remainingSec = null)
            }
        }

        // 3b. 当日额度 (兑换的额外屏幕时间计入预算)。
        val budgetSec = limit.dailyMaxSec + TempExceptionEvaluator.extraScreenTimeMinutes(rules, now) * 60
        val remaining = (budgetSec - usedTodaySec).coerceAtLeast(0)
        return if (remaining > 0) {
            AppDecision(allowed = true, reason = BlockReason.NONE, remainingSec = remaining)
        } else {
            AppDecision(allowed = false, reason = BlockReason.TIME_LIMIT, remainingSec = 0)
        }
    }

    /** [minutesOfDay] 是否在窗口内; [bedtimeDelayMinutes] 延后末端, 支持跨午夜。 */
    fun inWindow(window: TimeWindow, minutesOfDay: Int, bedtimeDelayMinutes: Int = 0): Boolean {
        val start = window.startMinutes()
        val end = (window.endMinutes() + bedtimeDelayMinutes) % TimeWindow.DAY_MINUTES
        return if (start <= end) {
            minutesOfDay in start..end
        } else {
            minutesOfDay >= start || minutesOfDay <= end
        }
    }

    private inline fun <reified T> decode(raw: String): T? =
        runCatching { json.decodeFromString<T>(raw) }.getOrNull()
}
