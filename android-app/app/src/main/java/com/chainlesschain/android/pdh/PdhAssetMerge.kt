package com.chainlesschain.android.pdh

/**
 * §8.3 / §13.5 跨设备资产冲突合并(纯逻辑核)—— module 101 Phase 7.
 *
 * 同一资产在两台设备各改 → 按资产类型定策略(§13.5),**收敛优先、绝不静默丢一份**:
 *  - 事件/账本(VAULT / TRAJECTORIES,append-only)= 全序并集(按 key 去重,确定性);
 *  - 记忆/指令/项目记忆(MEMORY / INSTINCTS / PROJECT_MEMORY)= 并集去重;
 *  - 技能(SKILLS)= 版本号高者胜;版本相等且内容不同 = 冲突(两份都留,待人工复核)。
 *
 * 复用 [com.chainlesschain.android.presentation.aistudy.PointsLedgerMerge] 的收敛哲学
 * (可交换 / 结合 / 幂等 → P2P 多端最终一致)。真正读写各资产存储是集成层(Phase 7)。
 * **纯函数、可单测、无 Android 依赖**。
 */
object PdhAssetMerge {

    enum class Strategy { TOTAL_ORDER_UNION, UNION_DEDUP, VERSION_WINS }

    /** 一条可合并资产项:[key] 唯一标识;[version] 用于 VERSION_WINS;[contentHash] 判异同。 */
    data class Item(val key: String, val version: Long = 0L, val contentHash: String = "")

    data class MergeResult(
        val merged: List<Item>,
        /** 需人工复核的冲突 key(同 key、版本相等但内容不同 → 两份都在 [merged] 里保留)。 */
        val conflicts: List<String>,
    )

    /** 资产类型 → 合并策略(§13.5)。 */
    fun strategyFor(kind: AssetKind): Strategy = when (kind) {
        AssetKind.VAULT, AssetKind.TRAJECTORIES -> Strategy.TOTAL_ORDER_UNION
        AssetKind.MEMORY, AssetKind.INSTINCTS, AssetKind.PROJECT_MEMORY -> Strategy.UNION_DEDUP
        AssetKind.SKILLS -> Strategy.VERSION_WINS
    }

    /** 按资产类型合并两端的项(收敛优先、确定性、可重放)。 */
    fun merge(kind: AssetKind, local: List<Item>, remote: List<Item>): MergeResult =
        merge(strategyFor(kind), local, remote)

    /**
     * 合并两端的项。可交换(merge(a,b)==merge(b,a))、幂等(merge(a,a)==a)→ P2P 收敛。
     * 冲突项(仅 VERSION_WINS 的版本相等内容不同)以 `key#conflict` 形式两份都保留。
     */
    fun merge(strategy: Strategy, local: List<Item>, remote: List<Item>): MergeResult {
        val byKey = LinkedHashMap<String, Item>()
        val conflicts = sortedSetOf<String>()
        val extras = LinkedHashMap<String, Item>() // 冲突时另一侧(key#conflict),去重

        for (item in local + remote) {
            val existing = byKey[item.key]
            if (existing == null) {
                byKey[item.key] = item
                continue
            }
            when (strategy) {
                // append-only / 去重:同 key = 同项 → 取确定性一侧(contentHash 小者)。
                Strategy.TOTAL_ORDER_UNION, Strategy.UNION_DEDUP ->
                    byKey[item.key] = minOf(existing, item, compareBy { it.contentHash })
                Strategy.VERSION_WINS -> when {
                    item.version > existing.version -> byKey[item.key] = item
                    item.version < existing.version -> Unit // 保留 existing(版本更高)
                    existing.contentHash == item.contentHash -> Unit // 完全相同
                    else -> {
                        // 版本相等、内容不同 = 真冲突 → 两份都留(按 contentHash 定序,
                        // 小者占 key、大者标 #conflict → 与端序无关、可交换)。
                        val (lo, hi) = listOf(existing, item).sortedBy { it.contentHash }
                        byKey[item.key] = lo
                        extras["${item.key}#conflict"] = hi.copy(key = "${item.key}#conflict")
                        conflicts += item.key
                    }
                }
            }
        }
        val merged = (byKey.values + extras.values)
            .sortedWith(compareBy({ it.key }, { it.version }, { it.contentHash }))
        return MergeResult(merged, conflicts.toList())
    }
}
