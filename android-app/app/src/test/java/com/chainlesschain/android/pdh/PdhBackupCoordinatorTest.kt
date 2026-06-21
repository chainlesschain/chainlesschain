package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.security.strongbox.EncryptResult
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §8.3 端到端编排测试:把五块组合起来跑双向同步 —— 推本端独有 / 拉对端独有 / 合并写回,
 * 收敛 + 幂等 + 冲突两份都留。全程 fake seam(codec / cipher / channel / source)。
 */
class PdhBackupCoordinatorTest {

    // 可逆 codec:keyversioncontent(测试内容用 ASCII,不含 )。
    private val codec = object : PdhBackupCoordinator.RecordCodec {
        override fun encode(record: PdhBackupCoordinator.Record): ByteArray =
            "${record.key}${record.version}${String(record.content)}".toByteArray()
        override fun decode(bytes: ByteArray): PdhBackupCoordinator.Record {
            val p = String(bytes).split("", limit = 3)
            return PdhBackupCoordinator.Record(p[0], p[1].toLong(), p[2].toByteArray())
        }
    }

    // 可逆 cipher(反转字节,iv 固定)— 验证编排,非真 AES(那在 KeystoreFacade)。
    private val cipher = object : PdhBackupEnvelope.BackupCipher {
        override fun seal(plaintext: ByteArray) = EncryptResult(byteArrayOf(9), plaintext.reversedArray())
        override fun open(iv: ByteArray, ciphertext: ByteArray) = ciphertext.reversedArray()
    }

    private fun rec(key: String, version: Long, content: String) =
        PdhBackupCoordinator.Record(key, version, content.toByteArray())

    private fun blockOf(kind: AssetKind, r: PdhBackupCoordinator.Record) =
        PdhBackupEnvelope.seal(kind, codec.encode(r), cipher)

    private fun hashOf(r: PdhBackupCoordinator.Record) =
        PdhBackupEnvelope.contentHash(codec.encode(r))

    private class FakeSource(
        override val kind: AssetKind,
        var records: MutableList<PdhBackupCoordinator.Record>,
    ) : PdhBackupCoordinator.AssetSource {
        override fun read() = records.toList()
        override fun write(records: List<PdhBackupCoordinator.Record>) {
            this.records = records.toMutableList()
        }
    }

    private class FakeChannel(remoteBlocks: List<PdhBackupEnvelope.EncryptedBlock>) :
        PdhBackupTransport.BlockChannel {
        private val byHash = remoteBlocks.associateBy { it.contentHash }
        val pushed = mutableListOf<String>()
        override suspend fun push(block: PdhBackupEnvelope.EncryptedBlock): Boolean {
            pushed.add(block.contentHash); return true
        }
        override suspend fun pull(assetKind: AssetKind, hash: String) = byHash[hash]
    }

    @Test
    fun sync_pushes_local_only_pulls_remote_only_and_converges() = runTest {
        val a = rec("a", 0, "alpha")
        val b = rec("b", 0, "beta")
        val mem = FakeSource(AssetKind.MEMORY, mutableListOf(a))
        val remoteBlock = blockOf(AssetKind.MEMORY, b)
        val channel = FakeChannel(listOf(remoteBlock))
        val remoteManifest = PdhBackupSync.Manifest(listOf(PdhBackupEnvelope.toSyncBlock(remoteBlock)))

        val out = PdhBackupCoordinator.sync(listOf(mem), codec, cipher, channel, remoteManifest)

        assertTrue(out.ok)
        assertEquals(listOf(hashOf(a)), channel.pushed) // 推了本端独有 A
        assertEquals(setOf("a", "b"), mem.records.map { it.key }.toSet()) // 收敛:A∪B
        assertFalse(out.hasConflicts)
    }

    @Test
    fun matching_manifest_is_a_noop() = runTest {
        val a = rec("a", 0, "alpha")
        val mem = FakeSource(AssetKind.MEMORY, mutableListOf(a))
        val aBlock = blockOf(AssetKind.MEMORY, a)
        val channel = FakeChannel(listOf(aBlock))
        val manifest = PdhBackupSync.Manifest(listOf(PdhBackupEnvelope.toSyncBlock(aBlock)))

        val out = PdhBackupCoordinator.sync(listOf(mem), codec, cipher, channel, manifest)

        assertTrue(out.ok)
        assertTrue(channel.pushed.isEmpty()) // 对端已有 A → 不推
        assertEquals(listOf("a"), mem.records.map { it.key }) // 不变
    }

    @Test
    fun sync_is_idempotent() = runTest {
        val a = rec("a", 0, "alpha")
        val b = rec("b", 0, "beta")
        val mem = FakeSource(AssetKind.MEMORY, mutableListOf(a))
        val remoteBlock = blockOf(AssetKind.MEMORY, b)
        val manifest = PdhBackupSync.Manifest(listOf(PdhBackupEnvelope.toSyncBlock(remoteBlock)))

        PdhBackupCoordinator.sync(listOf(mem), codec, cipher, FakeChannel(listOf(remoteBlock)), manifest)
        val afterFirst = mem.records.map { it.key }.toSet()
        PdhBackupCoordinator.sync(listOf(mem), codec, cipher, FakeChannel(listOf(remoteBlock)), manifest)
        assertEquals(afterFirst, mem.records.map { it.key }.toSet()) // 再同步收敛,不变
    }

    @Test
    fun skills_version_tie_keeps_both_and_reports_conflict() = runTest {
        val localX = rec("s1", 1, "X")
        val remoteY = rec("s1", 1, "Y")
        val skills = FakeSource(AssetKind.SKILLS, mutableListOf(localX))
        val remoteBlock = blockOf(AssetKind.SKILLS, remoteY)
        val channel = FakeChannel(listOf(remoteBlock))
        val manifest = PdhBackupSync.Manifest(listOf(PdhBackupEnvelope.toSyncBlock(remoteBlock)))

        val out = PdhBackupCoordinator.sync(listOf(skills), codec, cipher, channel, manifest)

        assertEquals(listOf("s1"), out.conflictsByKind[AssetKind.SKILLS])
        assertEquals(2, skills.records.size) // 两份都写回(收敛优先,不静默丢)
        assertTrue(skills.records.any { String(it.content) == "X" })
        assertTrue(skills.records.any { String(it.content) == "Y" })
    }
}
