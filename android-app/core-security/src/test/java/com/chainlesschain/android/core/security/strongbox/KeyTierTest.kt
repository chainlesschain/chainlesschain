package com.chainlesschain.android.core.security.strongbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [KeyTier] 纯逻辑单测：硬件等级模型 + 高风险放行门（ADR-2 三阶段降级）。
 *
 * StrongBoxKeyManagerTest 已覆盖 isAtLeast 传递排序；这里补安全相关的不变量与
 * allowsHighRisk() 门——高风险操作只应在硬件级（TEE/StrongBox）密钥后端放行，
 * 软件级必须拒绝（否则会在不足硬件上允许高风险操作）。
 */
class KeyTierTest {

    @Test
    fun `allowsHighRisk only on hardware-backed tiers`() {
        // 硬件级（TEE / StrongBox，无论 native 还是 wrapper）→ 放行
        assertTrue(KeyTier.NATIVE_STRONGBOX.allowsHighRisk())
        assertTrue(KeyTier.NATIVE_TEE.allowsHighRisk())
        assertTrue(KeyTier.WRAPPER_STRONGBOX.allowsHighRisk())
        assertTrue(KeyTier.WRAPPER_TEE.allowsHighRisk())
        // 软件级 → 必须拒绝
        assertFalse(KeyTier.SOFTWARE.allowsHighRisk())
    }

    @Test
    fun `only SOFTWARE is not hardware-backed`() {
        val notHwBacked = KeyTier.values().filter { !it.isHardwareBacked }
        assertEquals(listOf(KeyTier.SOFTWARE), notHwBacked)
        // allowsHighRisk 与 isHardwareBacked 等价
        KeyTier.values().forEach { assertEquals(it.isHardwareBacked, it.allowsHighRisk()) }
    }

    @Test
    fun `only NATIVE tiers are native`() {
        val native = KeyTier.values().filter { it.isNative }.toSet()
        assertEquals(setOf(KeyTier.NATIVE_STRONGBOX, KeyTier.NATIVE_TEE), native)
    }

    @Test
    fun `ranks form a strict total order StrongBox-native highest to Software lowest`() {
        val byRank = KeyTier.values().sortedByDescending { it.rank }
        assertEquals(
            listOf(
                KeyTier.NATIVE_STRONGBOX,
                KeyTier.NATIVE_TEE,
                KeyTier.WRAPPER_STRONGBOX,
                KeyTier.WRAPPER_TEE,
                KeyTier.SOFTWARE,
            ),
            byRank,
        )
        // rank 唯一（严格全序，无并列）
        val ranks = KeyTier.values().map { it.rank }
        assertEquals(ranks.size, ranks.toSet().size)
    }

    @Test
    fun `comparator sorts ascending by rank`() {
        val sorted = KeyTier.values().toList().shuffled().sortedWith(KeyTier.comparator())
        assertEquals(KeyTier.SOFTWARE, sorted.first())
        assertEquals(KeyTier.NATIVE_STRONGBOX, sorted.last())
    }

    @Test
    fun `isAtLeast is reflexive and respects ordering`() {
        KeyTier.values().forEach { assertTrue(it.isAtLeast(it)) }
        assertTrue(KeyTier.NATIVE_STRONGBOX.isAtLeast(KeyTier.SOFTWARE))
        assertFalse(KeyTier.SOFTWARE.isAtLeast(KeyTier.WRAPPER_TEE))
        assertFalse(KeyTier.WRAPPER_TEE.isAtLeast(KeyTier.NATIVE_TEE))
    }
}
