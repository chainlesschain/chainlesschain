package com.chainlesschain.android.feature.familyguard.domain.enforce

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** M9→M4 兑换 → 临时白名单纯映射 ([RewardTempException])。 */
class RewardTempExceptionTest {

    private val now = 1_000_000L
    private val child = "did:chain:child"

    @Test
    fun `screen time maps to one screen_time row expiring after value minutes`() {
        val rows = RewardTempException.fromRedemption(
            kind = RewardTempException.KIND_SCREEN_TIME_MIN,
            valueMinutes = 30,
            targetApps = emptyList(),
            childDid = child,
            rewardId = "r-game-30",
            now = now,
        )
        assertEquals(1, rows.size)
        val row = rows[0]
        assertEquals(RewardTempException.RULE_TYPE, row.ruleType)
        assertEquals(RewardTempException.TARGET_SCREEN_TIME, row.target)
        assertEquals(now + 30 * 60_000L, row.expiresAt)
        assertEquals(child, row.sourceDid)
        assertTrue(row.active)
    }

    @Test
    fun `app unlock emits one row per target package`() {
        val rows = RewardTempException.fromRedemption(
            kind = RewardTempException.KIND_APP_UNLOCK,
            valueMinutes = 60,
            targetApps = listOf("tv.danmaku.bili", "com.tencent.tmgp.sgame", " "),
            childDid = child,
            rewardId = "r-bili-60",
            now = now,
        )
        assertEquals(2, rows.size) // 空白包名被滤掉
        assertEquals(listOf("tv.danmaku.bili", "com.tencent.tmgp.sgame"), rows.map { it.target })
        assertTrue(rows.all { it.expiresAt == now + 60 * 60_000L })
    }

    @Test
    fun `delayed bedtime targets bedtime with a 24h row carrying minutes in config`() {
        val rows = RewardTempException.fromRedemption(
            kind = RewardTempException.KIND_DELAYED_BEDTIME_MIN,
            valueMinutes = 30,
            targetApps = emptyList(),
            childDid = child,
            rewardId = "r-bedtime-30",
            now = now,
        )
        assertEquals(1, rows.size)
        assertEquals(RewardTempException.TARGET_BEDTIME, rows[0].target)
        assertEquals(now + 24 * 60 * 60 * 1000L, rows[0].expiresAt)
        val config = RewardTempException.decodeConfig(rows[0].config)
        assertEquals(30, config?.valueMinutes)
        assertEquals("r-bedtime-30", config?.rewardId)
    }

    @Test
    fun `parent-executed kinds and bad values deliver nothing`() {
        listOf("FAMILY_ACTIVITY", "REAL_WORLD_VOUCHER", "CASH", "unknown_v2").forEach { kind ->
            assertTrue(
                RewardTempException.fromRedemption(kind, 30, emptyList(), child, "r", now).isEmpty(),
            )
        }
        // 坏目录项: value ≤ 0
        assertTrue(
            RewardTempException.fromRedemption(
                RewardTempException.KIND_SCREEN_TIME_MIN, 0, emptyList(), child, "r", now,
            ).isEmpty(),
        )
    }

    @Test
    fun `config json round-trips and tolerates garbage`() {
        val rows = RewardTempException.fromRedemption(
            RewardTempException.KIND_SCREEN_TIME_MIN, 15, emptyList(), child, "r1", now,
        )
        val config = RewardTempException.decodeConfig(rows[0].config)
        assertEquals(RewardTempException.KIND_SCREEN_TIME_MIN, config?.kind)
        assertEquals(child, config?.childDid)
        assertEquals(null, RewardTempException.decodeConfig("not-json{"))
    }
}
