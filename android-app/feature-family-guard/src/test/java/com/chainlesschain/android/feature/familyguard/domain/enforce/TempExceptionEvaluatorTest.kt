package com.chainlesschain.android.feature.familyguard.domain.enforce

import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** M9→M4 临时例外评估侧纯函数 ([TempExceptionEvaluator])。 */
class TempExceptionEvaluatorTest {

    private val now = 1_000_000L
    private val child = "did:chain:child"

    /** 经真实写侧 ([RewardTempException]) 生成, 保证读写契约一致。 */
    private fun redeemed(kind: String, valueMinutes: Int, apps: List<String> = emptyList(), at: Long = now - 1_000L) =
        RewardTempException.fromRedemption(kind, valueMinutes, apps, child, "r-$kind", at)

    @Test
    fun `app unlock is active until expiry and reports remaining time`() {
        val rules = redeemed(RewardTempException.KIND_APP_UNLOCK, 60, listOf("tv.danmaku.bili"))

        assertTrue(TempExceptionEvaluator.appUnlockActive(rules, "tv.danmaku.bili", now))
        assertFalse(TempExceptionEvaluator.appUnlockActive(rules, "com.other.app", now))

        val remaining = TempExceptionEvaluator.appUnlockRemainingMs(rules, "tv.danmaku.bili", now)
        assertEquals(60 * 60_000L - 1_000L, remaining)

        // 到期后失效
        val later = now + 61 * 60_000L
        assertFalse(TempExceptionEvaluator.appUnlockActive(rules, "tv.danmaku.bili", later))
        assertEquals(0L, TempExceptionEvaluator.appUnlockRemainingMs(rules, "tv.danmaku.bili", later))
    }

    @Test
    fun `extra screen time sums multiple active redemptions`() {
        val rules = redeemed(RewardTempException.KIND_SCREEN_TIME_MIN, 30) +
            redeemed(RewardTempException.KIND_SCREEN_TIME_MIN, 15) +
            // 已到期的不算
            redeemed(RewardTempException.KIND_SCREEN_TIME_MIN, 99, at = now - 100 * 60_000L)

        assertEquals(45, TempExceptionEvaluator.extraScreenTimeMinutes(rules, now))
    }

    @Test
    fun `bedtime delay takes the max instead of stacking`() {
        val rules = redeemed(RewardTempException.KIND_DELAYED_BEDTIME_MIN, 30) +
            redeemed(RewardTempException.KIND_DELAYED_BEDTIME_MIN, 20)

        assertEquals(30, TempExceptionEvaluator.bedtimeDelayMinutes(rules, now))
        assertEquals(0, TempExceptionEvaluator.bedtimeDelayMinutes(emptyList(), now))
    }

    @Test
    fun `inactive rows and foreign rule types are ignored (defensive double filter)`() {
        val deactivated = redeemed(RewardTempException.KIND_SCREEN_TIME_MIN, 30)
            .map { it.copy(active = false) }
        val foreign = listOf(
            EnforceRuleEntity(
                ruleType = "app_blocklist",
                target = RewardTempException.TARGET_SCREEN_TIME,
                config = "{}",
                enforceLevel = 2,
                sourceDid = child,
                createdAt = now,
                expiresAt = null,
            ),
        )
        assertEquals(0, TempExceptionEvaluator.extraScreenTimeMinutes(deactivated + foreign, now))
    }

    @Test
    fun `garbage config rows are skipped not crashed`() {
        val bad = redeemed(RewardTempException.KIND_SCREEN_TIME_MIN, 30)
            .map { it.copy(config = "not-json{") }
        assertEquals(0, TempExceptionEvaluator.extraScreenTimeMinutes(bad, now))
        assertFalse(TempExceptionEvaluator.appUnlockActive(bad, RewardTempException.TARGET_SCREEN_TIME, now))
    }
}
