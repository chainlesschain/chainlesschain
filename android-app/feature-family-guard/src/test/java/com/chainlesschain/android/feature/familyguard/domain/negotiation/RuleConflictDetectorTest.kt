package com.chainlesschain.android.feature.familyguard.domain.negotiation

import com.chainlesschain.android.feature.familyguard.domain.merger.AppBlocklistConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.AppTimeLimitConfig
import com.chainlesschain.android.feature.familyguard.domain.merger.PaymentCapConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [RuleConflictDetector] 单测（FAMILY-62 多家长规则分歧检测）：纯函数，此前无直测。
 * 分歧检测错=该协商的没推协商频道（家长不知情）/不该打扰的误推。生效值复用 RuleMerger「取最严」。
 */
class RuleConflictDetectorTest {

    // ---- appTimeLimit ----

    @Test
    fun `appTimeLimit returns null with fewer than two proposals`() {
        assertNull(RuleConflictDetector.appTimeLimit("g", "com.x", emptyList()))
        assertNull(
            RuleConflictDetector.appTimeLimit("g", "com.x", listOf("d1" to AppTimeLimitConfig("com.x", 3600))),
        )
    }

    @Test
    fun `appTimeLimit returns null when all proposals agree`() {
        val ps = listOf(
            "d1" to AppTimeLimitConfig("com.x", 3600),
            "d2" to AppTimeLimitConfig("com.x", 3600),
        )
        assertNull(RuleConflictDetector.appTimeLimit("g", "com.x", ps))
    }

    @Test
    fun `appTimeLimit reports conflict with strictest (min) effective value`() {
        val ps = listOf(
            "d1" to AppTimeLimitConfig("com.x", 7200),
            "d2" to AppTimeLimitConfig("com.x", 3600),
        )
        val c = requireNotNull(RuleConflictDetector.appTimeLimit("g", "com.x", ps))
        assertEquals(RuleConflictType.APP_TIME_LIMIT, c.type)
        assertEquals("com.x", c.subject)
        assertEquals(2, c.proposals.size)
        assertTrue("effective 应为最严(min=3600): ${c.effectiveValue}", c.effectiveValue.contains("3600"))
    }

    // ---- paymentCap ----

    @Test
    fun `paymentCap reports conflict with strictest perDay`() {
        val ps = listOf(
            "d1" to PaymentCapConfig(perDay = 10.0, perMonth = 300.0, perTxApprovalThreshold = 50.0),
            "d2" to PaymentCapConfig(perDay = 5.0, perMonth = 300.0, perTxApprovalThreshold = 50.0),
        )
        val c = requireNotNull(RuleConflictDetector.paymentCap("g", ps))
        assertEquals(RuleConflictType.PAYMENT_CAP, c.type)
        assertTrue("effective 应含最严 perDay=5: ${c.effectiveValue}", c.effectiveValue.contains("5"))
    }

    @Test
    fun `paymentCap returns null when perDay agrees (v0_1 only compares perDay)`() {
        val ps = listOf(
            "d1" to PaymentCapConfig(perDay = 10.0, perMonth = 300.0, perTxApprovalThreshold = 50.0),
            "d2" to PaymentCapConfig(perDay = 10.0, perMonth = 100.0, perTxApprovalThreshold = 20.0),
        )
        assertNull(RuleConflictDetector.paymentCap("g", ps))
    }

    // ---- appBlocklist ----

    @Test
    fun `appBlocklist reports conflict with union effective value`() {
        val ps = listOf(
            "d1" to AppBlocklistConfig(listOf("a", "b")),
            "d2" to AppBlocklistConfig(listOf("b", "c")),
        )
        val c = requireNotNull(RuleConflictDetector.appBlocklist("g", ps))
        assertEquals(RuleConflictType.APP_BLOCKLIST, c.type)
        listOf("a", "b", "c").forEach {
            assertTrue("并集 effective 应含 $it: ${c.effectiveValue}", c.effectiveValue.contains(it))
        }
    }

    @Test
    fun `appBlocklist returns null when package sets agree regardless of order`() {
        val ps = listOf(
            "d1" to AppBlocklistConfig(listOf("a", "b")),
            "d2" to AppBlocklistConfig(listOf("b", "a")), // 同集合（toSet 比较，顺序无关）
        )
        assertNull(RuleConflictDetector.appBlocklist("g", ps))
    }
}
