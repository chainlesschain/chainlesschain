package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * §8.3 备份清单线编码测试:块往返、规范序(同集合同字节)、空清单、坏头拒、容错跳过坏行/
 * 未知资产类型(前向兼容)。纯逻辑。
 */
class PdhManifestCodecTest {

    private fun block(kind: AssetKind, hash: String, size: Long = 1) =
        PdhBackupSync.Block(kind, hash, size)

    @Test
    fun round_trips_blocks() {
        val m = PdhBackupSync.Manifest(
            listOf(block(AssetKind.VAULT, "abc", 10), block(AssetKind.MEMORY, "def", 20)),
        )
        val decoded = PdhManifestCodec.decode(PdhManifestCodec.encode(m))
        assertEquals(m.blocks.toSet(), decoded.blocks.toSet())
    }

    @Test
    fun encoding_is_canonical_order_independent() {
        val a = PdhBackupSync.Manifest(listOf(block(AssetKind.VAULT, "h2"), block(AssetKind.MEMORY, "h1")))
        val b = PdhBackupSync.Manifest(listOf(block(AssetKind.MEMORY, "h1"), block(AssetKind.VAULT, "h2")))
        assertTrue(PdhManifestCodec.encode(a).contentEquals(PdhManifestCodec.encode(b))) // 同集合 → 同字节
    }

    @Test
    fun empty_manifest_round_trips() {
        val decoded = PdhManifestCodec.decode(PdhManifestCodec.encode(PdhBackupSync.Manifest(emptyList())))
        assertTrue(decoded.blocks.isEmpty())
    }

    @Test
    fun bad_header_is_rejected() {
        assertFailsWith<IllegalArgumentException> {
            PdhManifestCodec.decode("garbage\nVAULT|h|1".toByteArray())
        }
    }

    @Test
    fun skips_malformed_and_unknown_kind_lines() {
        val text = listOf(
            PdhManifestCodec.MAGIC,
            "VAULT|okhash|5", // 唯一有效
            "BADKIND|h|1", // 未知资产类型 → 跳过(前向兼容)
            "VAULT|h|notanumber", // size 坏 → 跳过
            "VAULT|onlytwofields", // 字段不足 → 跳过
            "", // 空行 → 跳过
        ).joinToString("\n")
        val decoded = PdhManifestCodec.decode(text.toByteArray())
        assertEquals(1, decoded.blocks.size)
        assertEquals("okhash", decoded.blocks[0].hash)
        assertEquals(AssetKind.VAULT, decoded.blocks[0].assetKind)
    }

    @Test
    fun decoded_manifest_feeds_sync_plan() {
        // 端到端:对端清单经线编码往返后,喂 plan 得到正确增量
        val remote = PdhBackupSync.Manifest(listOf(block(AssetKind.VAULT, "shared"), block(AssetKind.MEMORY, "remoteOnly")))
        val wire = PdhManifestCodec.encode(remote)
        val local = PdhBackupSync.Manifest(listOf(block(AssetKind.VAULT, "shared"), block(AssetKind.VAULT, "localOnly")))
        val plan = PdhBackupSync.plan(local, PdhManifestCodec.decode(wire))
        assertEquals(listOf("localOnly"), plan.toPush.map { it.hash })
        assertEquals(listOf("remoteOnly"), plan.toPull.map { it.hash })
    }
}
