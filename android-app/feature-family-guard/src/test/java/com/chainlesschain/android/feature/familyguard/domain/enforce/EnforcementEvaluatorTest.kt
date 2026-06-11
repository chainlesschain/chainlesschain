package com.chainlesschain.android.feature.familyguard.domain.enforce

import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import com.chainlesschain.android.feature.familyguard.domain.enforce.EnforcementEvaluator.BlockReason
import com.chainlesschain.android.feature.familyguard.domain.merger.TimeWindow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Epic D 评估引擎纯核 ([EnforcementEvaluator])。 */
class EnforcementEvaluatorTest {

    private val now = 1_000_000L
    private val pkg = "com.tencent.tmgp.sgame"
    private val child = "did:chain:child"

    private fun rule(ruleType: String, target: String, config: String) = EnforceRuleEntity(
        ruleType = ruleType,
        target = target,
        config = config,
        enforceLevel = 2,
        sourceDid = "did:chain:parent",
        createdAt = 1_000L,
    )

    private fun blocklist(vararg packages: String) = rule(
        EnforcementEvaluator.RULE_APP_BLOCKLIST,
        "blocklist",
        """{"packages":[${packages.joinToString(",") { "\"$it\"" }}]}""",
    )

    private fun timeLimit(
        dailyMaxSec: Int,
        weekdayWindow: String? = null,
    ) = rule(
        EnforcementEvaluator.RULE_APP_TIME_LIMIT,
        pkg,
        buildString {
            append("""{"package":"$pkg","daily_max_sec":$dailyMaxSec""")
            weekdayWindow?.let { append(""","weekday_window":$it""") }
            append("}")
        },
    )

    private fun evaluate(
        rules: List<EnforceRuleEntity>,
        usedSec: Int = 0,
        minutesOfDay: Int = 12 * 60,
        isWeekend: Boolean = false,
    ) = EnforcementEvaluator.evaluateApp(pkg, rules, usedSec, minutesOfDay, isWeekend, now)

    @Test
    fun `no rules means allowed without a quota`() {
        val d = evaluate(emptyList())
        assertTrue(d.allowed)
        assertNull(d.remainingSec)
    }

    @Test
    fun `blocklist union across parents blocks`() {
        val d = evaluate(listOf(blocklist("com.other"), blocklist(pkg)))
        assertFalse(d.allowed)
        assertEquals(BlockReason.BLOCKLIST, d.reason)
    }

    @Test
    fun `redeemed app unlock overrides even the blocklist`() {
        val unlock = RewardTempException.fromRedemption(
            RewardTempException.KIND_APP_UNLOCK, 60, listOf(pkg), child, "r1", now - 1_000L,
        )
        val d = evaluate(listOf(blocklist(pkg)) + unlock)
        assertTrue(d.allowed)
    }

    @Test
    fun `daily quota counts down and blocks at zero, redeemed minutes extend it`() {
        val rules = listOf(timeLimit(dailyMaxSec = 3_600))

        assertEquals(1_800, evaluate(rules, usedSec = 1_800).remainingSec)
        val exhausted = evaluate(rules, usedSec = 3_600)
        assertFalse(exhausted.allowed)
        assertEquals(BlockReason.TIME_LIMIT, exhausted.reason)

        // 兑换 30 分钟屏幕时间 → 预算 +1800s → 重新放行
        val screenTime = RewardTempException.fromRedemption(
            RewardTempException.KIND_SCREEN_TIME_MIN, 30, emptyList(), child, "r2", now - 1_000L,
        )
        val extended = evaluate(rules + screenTime, usedSec = 3_600)
        assertTrue(extended.allowed)
        assertEquals(1_800, extended.remainingSec)
    }

    @Test
    fun `outside the weekday window blocks and bedtime delay extends the end`() {
        val rules = listOf(timeLimit(3_600, weekdayWindow = """{"start":"07:00","end":"21:30"}"""))
        val nineFortyPm = 21 * 60 + 40

        val outside = evaluate(rules, minutesOfDay = nineFortyPm)
        assertFalse(outside.allowed)
        assertEquals(BlockReason.TIME_WINDOW, outside.reason)

        // 兑换推迟就寝 30 分钟 → 窗口末端 21:30→22:00 → 21:40 放行
        val bedtime = RewardTempException.fromRedemption(
            RewardTempException.KIND_DELAYED_BEDTIME_MIN, 30, emptyList(), child, "r3", now - 1_000L,
        )
        assertTrue(evaluate(rules + bedtime, minutesOfDay = nineFortyPm).allowed)
    }

    @Test
    fun `weekend uses the weekend window and missing window means no window gate`() {
        val rules = listOf(timeLimit(3_600, weekdayWindow = """{"start":"07:00","end":"08:00"}"""))
        // 周末: weekday 窗口不适用 (weekend_window 缺省 = 不限窗)
        assertTrue(evaluate(rules, minutesOfDay = 23 * 60, isWeekend = true).allowed)
        assertFalse(evaluate(rules, minutesOfDay = 23 * 60, isWeekend = false).allowed)
    }

    @Test
    fun `window crossing midnight wraps correctly`() {
        val w = TimeWindow(start = "21:00", end = "06:00")
        assertTrue(EnforcementEvaluator.inWindow(w, minutesOfDay = 23 * 60))
        assertTrue(EnforcementEvaluator.inWindow(w, minutesOfDay = 5 * 60))
        assertFalse(EnforcementEvaluator.inWindow(w, minutesOfDay = 12 * 60))
    }

    @Test
    fun `garbage config rows are skipped not crashed`() {
        val bad = rule(EnforcementEvaluator.RULE_APP_TIME_LIMIT, pkg, "not-json{")
        val d = evaluate(listOf(bad))
        assertTrue(d.allowed)
        assertNull(d.remainingSec)
    }
}
