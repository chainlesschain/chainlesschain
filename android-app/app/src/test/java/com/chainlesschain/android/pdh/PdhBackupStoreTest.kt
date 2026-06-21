package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §8.3 资产存储恢复编排纯逻辑测试:读各 store、远端∪本地按类型合并写回、空远端幂等、
 * 多类冲突汇总、重复恢复收敛(幂等)。真实存储读写是集成层,这里用 in-memory fake。
 */
class PdhBackupStoreTest {

    private fun item(key: String, version: Long = 0L, hash: String = "") =
        PdhAssetMerge.Item(key, version, hash)

    private class FakeStore(
        override val kind: AssetKind,
        initial: List<PdhAssetMerge.Item> = emptyList(),
    ) : PdhBackupStore.AssetStore {
        var items: List<PdhAssetMerge.Item> = initial
        override fun read() = items
        override fun write(items: List<PdhAssetMerge.Item>) { this.items = items }
    }

    @Test
    fun collect_reads_all_stores() {
        val stores = listOf(
            FakeStore(AssetKind.MEMORY, listOf(item("m1"))),
            FakeStore(AssetKind.SKILLS, listOf(item("s1", 1))),
        )
        val collected = PdhBackupStore.collect(stores)
        assertEquals(listOf("m1"), collected[AssetKind.MEMORY]!!.map { it.key })
        assertEquals(listOf("s1"), collected[AssetKind.SKILLS]!!.map { it.key })
    }

    @Test
    fun apply_restore_merges_remote_into_local_and_writes_back() {
        val store = FakeStore(AssetKind.MEMORY, listOf(item("local1")))
        val conflicts = PdhBackupStore.applyRestore(store, listOf(item("remote1")))
        assertEquals(listOf("local1", "remote1"), store.read().map { it.key })
        assertTrue(conflicts.isEmpty())
    }

    @Test
    fun apply_restore_empty_remote_is_noop() {
        val store = FakeStore(AssetKind.MEMORY, listOf(item("k1"), item("k2")))
        PdhBackupStore.applyRestore(store, emptyList())
        assertEquals(listOf("k1", "k2"), store.read().map { it.key })
    }

    @Test
    fun apply_restore_is_idempotent() {
        val store = FakeStore(AssetKind.VAULT, listOf(item("a", 0, "x")))
        val remote = listOf(item("b", 0, "y"))
        PdhBackupStore.applyRestore(store, remote)
        val afterFirst = store.read()
        PdhBackupStore.applyRestore(store, remote) // 再次同步 → 收敛,内容不变
        assertEquals(afterFirst, store.read())
    }

    @Test
    fun skills_version_conflict_is_reported_and_both_kept() {
        val store = FakeStore(AssetKind.SKILLS, listOf(item("s1", 1, "A")))
        val conflicts = PdhBackupStore.applyRestore(store, listOf(item("s1", 1, "B")))
        assertEquals(listOf("s1"), conflicts)
        assertTrue(store.read().any { it.key == "s1#conflict" }) // 两份都留(收敛优先)
    }

    @Test
    fun apply_restore_all_aggregates_conflicts_by_kind() {
        val mem = FakeStore(AssetKind.MEMORY, listOf(item("m1")))
        val skills = FakeStore(AssetKind.SKILLS, listOf(item("s1", 1, "A")))
        val report = PdhBackupStore.applyRestoreAll(
            listOf(mem, skills),
            mapOf(
                AssetKind.MEMORY to listOf(item("m2")),
                AssetKind.SKILLS to listOf(item("s1", 1, "B")),
            ),
        )
        assertTrue(report.hasConflicts)
        assertEquals(1, report.totalConflicts)
        assertEquals(listOf("s1"), report.conflictsByKind[AssetKind.SKILLS])
        assertFalse(report.conflictsByKind[AssetKind.MEMORY]!!.isNotEmpty()) // memory 并集无冲突
        assertEquals(listOf("m1", "m2"), mem.read().map { it.key })
    }
}
