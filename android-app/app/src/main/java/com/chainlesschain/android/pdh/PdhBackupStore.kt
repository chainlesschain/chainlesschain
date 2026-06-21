package com.chainlesschain.android.pdh

/**
 * §8.3 跨设备备份 —— 资产存储读写/恢复编排(纯逻辑核)—— module 101 Phase 7.
 *
 * 把纯核([PdhBackupSync] 增量同步 / [PdhAssetMerge] 冲突合并 / [PdhBackupEnvelope]
 * 加密块)接到**真实资产存储**(vault SQLite / 记忆文件 / 技能):
 *  - 备份侧:[collect] 读各 store 的项(供封装 + 同步);
 *  - 恢复侧:[applyRestore] 把远端项按资产类型(§13.5)与本地合并,**写回 store**,
 *    返回需人工复核的冲突 key(收敛优先:冲突两份都已在合并结果里)。
 *
 * 各资产的真实读写(vault.db / instinct / skills / memory)是 device/cc 集成层,经
 * [AssetStore] 适配(测试注入 in-memory fake)。编排 = 读→合并→写回,**幂等、可单测**
 * (重复 applyRestore 结果不变 → P2P 多次同步收敛)。
 */
object PdhBackupStore {

    /** 一类资产的存储适配器:真实现读写 vault/记忆/技能;测试用 in-memory fake。 */
    interface AssetStore {
        val kind: AssetKind
        fun read(): List<PdhAssetMerge.Item>
        fun write(items: List<PdhAssetMerge.Item>)
    }

    /** 多类恢复结果:按资产类型汇总需复核的冲突 key。 */
    data class RestoreReport(val conflictsByKind: Map<AssetKind, List<String>>) {
        val hasConflicts: Boolean get() = conflictsByKind.values.any { it.isNotEmpty() }
        val totalConflicts: Int get() = conflictsByKind.values.sumOf { it.size }
    }

    /** 备份侧:读所有 store 的项(供 [PdhBackupEnvelope] 封装 + [PdhBackupSync] 规划)。 */
    fun collect(stores: List<AssetStore>): Map<AssetKind, List<PdhAssetMerge.Item>> =
        stores.associate { it.kind to it.read() }

    /**
     * 恢复一类:本地 ∪ 远端按资产类型合并(§13.5),写回 [store];返回冲突 key。
     * 幂等:再次以相同远端调用结果不变(merge 收敛 → 写回同一集合)。
     */
    fun applyRestore(store: AssetStore, remote: List<PdhAssetMerge.Item>): List<String> {
        val result = PdhAssetMerge.merge(store.kind, store.read(), remote)
        store.write(result.merged)
        return result.conflicts
    }

    /**
     * 多类一次性恢复:逐 store 合并写回,汇总冲突。某类无远端项 → 按空合并(本地不变,
     * 幂等),仍如实列出该类(0 冲突)。
     */
    fun applyRestoreAll(
        stores: List<AssetStore>,
        remoteByKind: Map<AssetKind, List<PdhAssetMerge.Item>>,
    ): RestoreReport = RestoreReport(
        stores.associate { store ->
            store.kind to applyRestore(store, remoteByKind[store.kind] ?: emptyList())
        },
    )
}
