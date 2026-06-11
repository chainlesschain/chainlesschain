package com.chainlesschain.android.feature.familyguard.domain.enforce

import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity

/**
 * M9→M4 临时例外的**读取/评估侧**纯函数 (主文档 §3.9 → §3.4)。
 *
 * [RewardTempException] 负责"兑换 → 写 temp_exception 行"；本对象负责"给定当前
 * 规则集 + 时刻，回答管控评估问题"。Epic D 真实执行引擎 (DPC/VPN, 设备阻塞) 与
 * 家长/孩子 UI 都消费这一层；调用方从 EnforceRuleDao.observeActiveNonExpired 取
 * rules 并注入 now (引擎本身时间无关、确定性可测)。
 *
 * 语义：例外**放宽**管控 —— appUnlockActive 命中时同 target 的 blocklist/time-limit
 * 应放行；extraScreenTimeMinutes 加到当日额度；bedtimeDelayMinutes 推迟就寝窗口。
 */
object TempExceptionEvaluator {

    /** 该包名当前是否有未到期的解锁例外 (兑换的「解锁 app N 分钟」)。 */
    fun appUnlockActive(rules: List<EnforceRuleEntity>, packageName: String, now: Long): Boolean =
        activeExceptions(rules, now).any {
            it.target == packageName &&
                RewardTempException.decodeConfig(it.config)?.kind == RewardTempException.KIND_APP_UNLOCK
        }

    /**
     * 当前生效的额外屏幕时间总分钟数 (多次兑换叠加求和)。
     * 调用方把它加到 app_time_limit 的当日额度上。
     */
    fun extraScreenTimeMinutes(rules: List<EnforceRuleEntity>, now: Long): Int =
        activeExceptions(rules, now)
            .filter { it.target == RewardTempException.TARGET_SCREEN_TIME }
            .mapNotNull { RewardTempException.decodeConfig(it.config)?.valueMinutes }
            .filter { it > 0 }
            .sum()

    /**
     * 当前生效的就寝推迟分钟数。多次兑换取**最大值**不叠加 (一晚只推迟一次,
     * 防囤积兑换把就寝推到深夜; §3.9 取向)。
     */
    fun bedtimeDelayMinutes(rules: List<EnforceRuleEntity>, now: Long): Int =
        activeExceptions(rules, now)
            .filter { it.target == RewardTempException.TARGET_BEDTIME }
            .mapNotNull { RewardTempException.decodeConfig(it.config)?.valueMinutes }
            .filter { it > 0 }
            .maxOrNull() ?: 0

    /** 该包名最近一条解锁例外的剩余毫秒 (UI 倒计时用); 无生效例外返回 0。 */
    fun appUnlockRemainingMs(rules: List<EnforceRuleEntity>, packageName: String, now: Long): Long =
        activeExceptions(rules, now)
            .filter {
                it.target == packageName &&
                    RewardTempException.decodeConfig(it.config)?.kind == RewardTempException.KIND_APP_UNLOCK
            }
            .mapNotNull { it.expiresAt }
            .maxOfOrNull { it - now }
            ?.coerceAtLeast(0L) ?: 0L

    /**
     * 过滤出当前生效的 temp_exception 行：active + 类型匹配 + 未到期。
     * 防御 DAO 之外的调用方传入未过滤列表 (双保险, 语义与 observeActiveNonExpired 一致)。
     */
    private fun activeExceptions(rules: List<EnforceRuleEntity>, now: Long): List<EnforceRuleEntity> =
        rules.filter {
            it.active &&
                it.ruleType == RewardTempException.RULE_TYPE &&
                (it.expiresAt == null || it.expiresAt > now)
        }
}
