package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §8.3 / §13.5 跨设备资产冲突合并纯逻辑测试:策略分型、并集去重、可交换/幂等(P2P
 * 收敛)、技能版本号高者胜、版本相等内容不同 = 两份都留(收敛优先)。
 */
class PdhAssetMergeTest {

    private fun i(key: String, version: Long = 0L, hash: String = "") =
        PdhAssetMerge.Item(key, version, hash)

    @Test
    fun strategy_per_asset_type() {
        assertEquals(PdhAssetMerge.Strategy.TOTAL_ORDER_UNION, PdhAssetMerge.strategyFor(AssetKind.VAULT))
        assertEquals(PdhAssetMerge.Strategy.TOTAL_ORDER_UNION, PdhAssetMerge.strategyFor(AssetKind.TRAJECTORIES))
        assertEquals(PdhAssetMerge.Strategy.UNION_DEDUP, PdhAssetMerge.strategyFor(AssetKind.MEMORY))
        assertEquals(PdhAssetMerge.Strategy.UNION_DEDUP, PdhAssetMerge.strategyFor(AssetKind.INSTINCTS))
        assertEquals(PdhAssetMerge.Strategy.UNION_DEDUP, PdhAssetMerge.strategyFor(AssetKind.PROJECT_MEMORY))
        assertEquals(PdhAssetMerge.Strategy.VERSION_WINS, PdhAssetMerge.strategyFor(AssetKind.SKILLS))
    }

    @Test
    fun union_merges_distinct_keys_and_dedups() {
        val r = PdhAssetMerge.merge(AssetKind.MEMORY, listOf(i("k1"), i("k2")), listOf(i("k2"), i("k3")))
        assertEquals(listOf("k1", "k2", "k3"), r.merged.map { it.key })
        assertTrue(r.conflicts.isEmpty())
    }

    @Test
    fun union_is_commutative_and_idempotent() {
        val a = listOf(i("k1", 0, "x"), i("k2", 0, "y"))
        val b = listOf(i("k2", 0, "y"), i("k3", 0, "z"))
        assertEquals(
            PdhAssetMerge.merge(AssetKind.VAULT, a, b).merged,
            PdhAssetMerge.merge(AssetKind.VAULT, b, a).merged,
        )
        assertEquals(a.sortedBy { it.key }, PdhAssetMerge.merge(AssetKind.VAULT, a, a).merged)
    }

    @Test
    fun version_wins_keeps_the_higher_version() {
        val r = PdhAssetMerge.merge(AssetKind.SKILLS, listOf(i("s1", 2, "v2")), listOf(i("s1", 1, "v1")))
        assertEquals(1, r.merged.size)
        assertEquals(2L, r.merged[0].version)
        assertTrue(r.conflicts.isEmpty())
    }

    @Test
    fun version_tie_different_content_keeps_both_as_conflict() {
        val r = PdhAssetMerge.merge(AssetKind.SKILLS, listOf(i("s1", 1, "A")), listOf(i("s1", 1, "B")))
        assertEquals(listOf("s1"), r.conflicts)
        assertEquals(2, r.merged.size) // 两份都留(收敛优先,不静默丢)
        assertTrue(r.merged.any { it.key == "s1#conflict" })
        // 可交换:换端序结果一致
        assertEquals(r.merged, PdhAssetMerge.merge(AssetKind.SKILLS, listOf(i("s1", 1, "B")), listOf(i("s1", 1, "A"))).merged)
    }
}
