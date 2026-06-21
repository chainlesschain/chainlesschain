package com.chainlesschain.android.pdh

import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §8.3 P2P 块传输编排纯逻辑测试:推/拉计划、内容寻址完整性(hash 不符丢弃)、诚实
 * 部分失败统计(push 失败 / 拉缺 / 本地块缺)。suspend → runTest + in-memory fake channel。
 */
class PdhBackupTransportTest {

    private fun block(kind: AssetKind, hash: String) =
        PdhBackupEnvelope.EncryptedBlock(kind, hash, byteArrayOf(0), byteArrayOf(1, 2))

    private fun ref(kind: AssetKind, hash: String) = PdhBackupSync.Block(kind, hash, 2)

    /** in-memory 对端:remoteHas 供 pull;pushSucceeds 控制 push 成败;corrupt 模拟错块。 */
    private class FakeChannel(
        val remoteHas: Map<String, PdhBackupEnvelope.EncryptedBlock> = emptyMap(),
        val pushSucceeds: Boolean = true,
        val corruptPull: Boolean = false,
    ) : PdhBackupTransport.BlockChannel {
        val pushedHashes = mutableListOf<String>()
        override suspend fun push(block: PdhBackupEnvelope.EncryptedBlock): Boolean {
            if (!pushSucceeds) return false
            pushedHashes.add(block.contentHash)
            return true
        }
        override suspend fun pull(assetKind: AssetKind, hash: String): PdhBackupEnvelope.EncryptedBlock? {
            val b = remoteHas[hash] ?: return null
            return if (corruptPull) b.copy(contentHash = "WRONG_HASH") else b
        }
    }

    @Test
    fun happy_path_pushes_and_pulls_all() = runTest {
        val local = mapOf("p1" to block(AssetKind.VAULT, "p1"))
        val plan = PdhBackupSync.SyncPlan(
            toPush = listOf(ref(AssetKind.VAULT, "p1")),
            toPull = listOf(ref(AssetKind.MEMORY, "r1")),
        )
        val channel = FakeChannel(remoteHas = mapOf("r1" to block(AssetKind.MEMORY, "r1")))
        val r = PdhBackupTransport.transfer(plan, { local[it] }, channel)
        assertTrue(r.ok)
        assertEquals(1, r.pushed)
        assertEquals(listOf("p1"), channel.pushedHashes)
        assertEquals(listOf("r1"), r.pulled.map { it.contentHash })
    }

    @Test
    fun push_failure_is_reported_not_swallowed() = runTest {
        val local = mapOf("p1" to block(AssetKind.VAULT, "p1"))
        val plan = PdhBackupSync.SyncPlan(listOf(ref(AssetKind.VAULT, "p1")), emptyList())
        val r = PdhBackupTransport.transfer(plan, { local[it] }, FakeChannel(pushSucceeds = false))
        assertFalse(r.ok)
        assertEquals(1, r.pushFailed)
        assertEquals(0, r.pushed)
    }

    @Test
    fun unresolvable_local_block_counts_as_push_failure() = runTest {
        val plan = PdhBackupSync.SyncPlan(listOf(ref(AssetKind.VAULT, "gone")), emptyList())
        val r = PdhBackupTransport.transfer(plan, { null }, FakeChannel())
        assertEquals(1, r.pushFailed)
        assertFalse(r.ok)
    }

    @Test
    fun missing_remote_block_counts_as_pull_missing() = runTest {
        val plan = PdhBackupSync.SyncPlan(emptyList(), listOf(ref(AssetKind.MEMORY, "r1")))
        val r = PdhBackupTransport.transfer(plan, { null }, FakeChannel(remoteHas = emptyMap()))
        assertEquals(1, r.pullMissing)
        assertTrue(r.pulled.isEmpty())
        assertFalse(r.ok)
    }

    @Test
    fun content_hash_mismatch_on_pull_is_rejected() = runTest {
        val plan = PdhBackupSync.SyncPlan(emptyList(), listOf(ref(AssetKind.MEMORY, "r1")))
        // 对端返回的块 contentHash 被改成 WRONG_HASH != 请求 r1 → 拒收
        val channel = FakeChannel(remoteHas = mapOf("r1" to block(AssetKind.MEMORY, "r1")), corruptPull = true)
        val r = PdhBackupTransport.transfer(plan, { null }, channel)
        assertEquals(1, r.pullMissing)
        assertTrue(r.pulled.isEmpty()) // 错块不接受(内容寻址完整性)
    }

    @Test
    fun empty_plan_is_ok_and_transfers_nothing() = runTest {
        val r = PdhBackupTransport.transfer(
            PdhBackupSync.SyncPlan(emptyList(), emptyList()), { null }, FakeChannel(),
        )
        assertTrue(r.ok)
        assertEquals(0, r.pushed)
        assertTrue(r.pulled.isEmpty())
    }
}
