package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §8.3 备份引擎 —— 内容寻址增量同步规划纯逻辑测试:相同清单零传输、增量推/拉、
 * 同 hash 去重、与扫描顺序无关的确定性。
 */
class PdhBackupSyncTest {

    private fun b(kind: AssetKind, hash: String, size: Long = 100) =
        PdhBackupSync.Block(kind, hash, size)

    @Test
    fun identical_manifests_are_up_to_date() {
        val m = PdhBackupSync.Manifest(listOf(b(AssetKind.VAULT, "h1"), b(AssetKind.MEMORY, "h2")))
        assertTrue(PdhBackupSync.plan(m, m).isUpToDate)
    }

    @Test
    fun incremental_pushes_local_only_pulls_remote_only_shares_common() {
        val local = PdhBackupSync.Manifest(
            listOf(b(AssetKind.VAULT, "common"), b(AssetKind.VAULT, "localOnly")),
        )
        val remote = PdhBackupSync.Manifest(
            listOf(b(AssetKind.VAULT, "common"), b(AssetKind.VAULT, "remoteOnly")),
        )
        val plan = PdhBackupSync.plan(local, remote)
        assertEquals(listOf("localOnly"), plan.toPush.map { it.hash }) // 对端缺
        assertEquals(listOf("remoteOnly"), plan.toPull.map { it.hash }) // 本端缺
    }

    @Test
    fun content_addressed_dedup_counts_a_repeated_hash_once() {
        val local = PdhBackupSync.Manifest(
            listOf(b(AssetKind.VAULT, "dup", 100), b(AssetKind.SKILLS, "dup", 100)),
        )
        val plan = PdhBackupSync.plan(local, PdhBackupSync.Manifest(emptyList()))
        assertEquals(1, plan.toPush.size) // 同 hash → 一块
        assertEquals(100L, plan.pushBytes)
    }

    @Test
    fun plan_is_deterministic_regardless_of_block_order() {
        val a = PdhBackupSync.Manifest(listOf(b(AssetKind.VAULT, "h2"), b(AssetKind.MEMORY, "h1")))
        val a2 = PdhBackupSync.Manifest(listOf(b(AssetKind.MEMORY, "h1"), b(AssetKind.VAULT, "h2")))
        val empty = PdhBackupSync.Manifest(emptyList())
        assertEquals(PdhBackupSync.plan(a, empty).toPush, PdhBackupSync.plan(a2, empty).toPush)
    }
}
