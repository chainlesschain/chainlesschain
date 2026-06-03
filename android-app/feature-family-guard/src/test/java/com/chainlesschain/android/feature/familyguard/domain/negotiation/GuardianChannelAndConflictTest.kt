package com.chainlesschain.android.feature.familyguard.domain.negotiation

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import com.chainlesschain.android.feature.familyguard.domain.merger.AppBlocklistConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.AppTimeLimitConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.PaymentCapConfig
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FAMILY-62 验收 (纯逻辑): GuardianChannelResolver (guardian-only 解析) +
 * RuleConflictDetector (分歧判定，复用 RuleMerger 取严生效值)。
 */
class GuardianChannelAndConflictTest {

    private val grp = "grp1"
    private val resolver = GuardianChannelResolver()

    private fun member(
        did: String,
        role: String,
        group: String = grp,
        device: String = "d-$did",
        status: String = "active",
    ) = FamilyMembershipEntity(
        familyGroupId = group,
        memberDid = did,
        role = role,
        deviceId = device,
        joinedAt = 1_000L,
        status = status,
    )

    // ─── 频道解析 ───

    @Test
    fun `resolve keeps guardians excludes child and dedupes devices`() {
        val members = listOf(
            member("did:parent:A", "parent"),
            member("did:parent:A", "parent", device = "d-A2"), // 同 guardian 第二台设备
            member("did:guardian:B", "guardian"),
            member("did:child:C", "child"), // 排除
        )
        val ch = resolver.resolve(grp, members)
        assertEquals(listOf("did:parent:A", "did:guardian:B"), ch.guardianDids)
        assertEquals("family-negotiation:grp1", ch.channelId)
        assertTrue(ch.canNegotiate)
    }

    @Test
    fun `resolve filters inactive and other groups`() {
        val members = listOf(
            member("did:parent:A", "parent"),
            member("did:guardian:B", "guardian", status = "inactive"), // 非 active
            member("did:parent:D", "parent", group = "other"), // 别组
        )
        val ch = resolver.resolve(grp, members)
        assertEquals(listOf("did:parent:A"), ch.guardianDids)
        assertFalse(ch.canNegotiate) // 仅 1 guardian
    }

    @Test
    fun `empty memberships yields empty non-negotiable channel`() {
        val ch = resolver.resolve(grp, emptyList())
        assertTrue(ch.guardianDids.isEmpty())
        assertFalse(ch.canNegotiate)
    }

    // ─── 冲突检测: app 时长 ───

    @Test
    fun `appTimeLimit conflict when daily max differs, effective is strictest`() {
        val c = RuleConflictDetector.appTimeLimit(
            grp,
            "com.game",
            listOf(
                "did:A" to AppTimeLimitConfig("com.game", dailyMaxSec = 3600),
                "did:B" to AppTimeLimitConfig("com.game", dailyMaxSec = 1800),
            ),
        )
        assertEquals(RuleConflictType.APP_TIME_LIMIT, c?.type)
        assertEquals("com.game", c?.subject)
        assertEquals(2, c?.proposals?.size)
        assertTrue(c!!.effectiveValue.startsWith("1800s")) // 取最严
    }

    @Test
    fun `appTimeLimit no conflict when all agree or single proposal`() {
        assertNull(
            RuleConflictDetector.appTimeLimit(
                grp, "com.game",
                listOf(
                    "did:A" to AppTimeLimitConfig("com.game", 1800),
                    "did:B" to AppTimeLimitConfig("com.game", 1800),
                ),
            ),
        )
        assertNull(
            RuleConflictDetector.appTimeLimit(
                grp, "com.game",
                listOf("did:A" to AppTimeLimitConfig("com.game", 1800)),
            ),
        )
    }

    // ─── 冲突检测: 支付 ───

    @Test
    fun `paymentCap conflict on per-day divergence`() {
        val c = RuleConflictDetector.paymentCap(
            grp,
            listOf(
                "did:A" to PaymentCapConfig(perDay = 100.0, perMonth = 1000.0, perTxApprovalThreshold = 50.0),
                "did:B" to PaymentCapConfig(perDay = 30.0, perMonth = 500.0, perTxApprovalThreshold = 20.0),
            ),
        )
        assertEquals(RuleConflictType.PAYMENT_CAP, c?.type)
        assertTrue(c!!.effectiveValue.contains("30.0")) // min per_day
    }

    // ─── 冲突检测: 黑名单 ───

    @Test
    fun `appBlocklist conflict when sets differ, effective is union`() {
        val c = RuleConflictDetector.appBlocklist(
            grp,
            listOf(
                "did:A" to AppBlocklistConfig(listOf("com.x")),
                "did:B" to AppBlocklistConfig(listOf("com.y")),
            ),
        )
        assertEquals(RuleConflictType.APP_BLOCKLIST, c?.type)
        assertTrue(c!!.effectiveValue.contains("com.x"))
        assertTrue(c.effectiveValue.contains("com.y"))
    }

    @Test
    fun `appBlocklist no conflict when same set regardless of order`() {
        assertNull(
            RuleConflictDetector.appBlocklist(
                grp,
                listOf(
                    "did:A" to AppBlocklistConfig(listOf("com.x", "com.y")),
                    "did:B" to AppBlocklistConfig(listOf("com.y", "com.x")),
                ),
            ),
        )
    }
}
