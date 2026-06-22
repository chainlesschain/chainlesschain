package com.chainlesschain.android.pdh

import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §8.3 通用 cc 行资产源测试:export Ok→Records(id+json,version 0)、export 失败→空、write 拼
 * JSON 数组文件并调 importer、空写 no-op。注入 fake exporter/importer(真 cc 是设备集成)。
 */
class PdhCcRowsAssetSourceTest {

    private fun tempDir(): File =
        File.createTempFile("ccrows", ".d").let { it.delete(); it.mkdirs(); it }

    private fun rec(key: String, json: String) =
        PdhBackupCoordinator.Record(key, 0L, json.toByteArray())

    @Test
    fun read_maps_rows_to_records() {
        val src = PdhCcRowsAssetSource(
            AssetKind.INSTINCTS, tempDir(),
            exporter = {
                LocalCcRunner.ExportEventsResult.Ok(
                    listOf(
                        LocalCcRunner.ExportedEvent("i1", """{"id":"i1","pattern":"外卖→美团"}"""),
                        LocalCcRunner.ExportedEvent("i2", """{"id":"i2"}"""),
                    ),
                )
            },
            importer = { LocalCcRunner.ImportEventsResult.Ok(0, 0) },
        )
        val out = src.read()
        assertEquals(listOf("i1", "i2"), out.map { it.key })
        assertTrue(out.all { it.version == 0L })
        assertEquals("""{"id":"i1","pattern":"外卖→美团"}""", String(out.first().content))
    }

    @Test
    fun read_failed_returns_empty() {
        val src = PdhCcRowsAssetSource(
            AssetKind.TRAJECTORIES, tempDir(),
            exporter = { LocalCcRunner.ExportEventsResult.Failed("spawn-failed", null) },
            importer = { LocalCcRunner.ImportEventsResult.Ok(0, 0) },
        )
        assertTrue(src.read().isEmpty())
    }

    @Test
    fun write_assembles_json_array_file_and_calls_importer() {
        var seen: String? = null
        val src = PdhCcRowsAssetSource(
            AssetKind.INSTINCTS, tempDir(),
            exporter = { LocalCcRunner.ExportEventsResult.Ok(emptyList()) },
            importer = { f -> seen = f.readText(); LocalCcRunner.ImportEventsResult.Ok(2, 0) },
        )
        src.write(listOf(rec("i1", """{"id":"i1"}"""), rec("i2", """{"id":"i2"}""")))
        assertEquals("""[{"id":"i1"},{"id":"i2"}]""", seen)
    }

    @Test
    fun write_empty_is_noop() {
        var called = false
        val src = PdhCcRowsAssetSource(
            AssetKind.TRAJECTORIES, tempDir(),
            exporter = { LocalCcRunner.ExportEventsResult.Ok(emptyList()) },
            importer = { called = true; LocalCcRunner.ImportEventsResult.Ok(0, 0) },
        )
        src.write(emptyList())
        assertTrue(!called)
    }
}
