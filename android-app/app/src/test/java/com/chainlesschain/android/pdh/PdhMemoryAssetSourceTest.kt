package com.chainlesschain.android.pdh

import io.mockk.coEvery
import io.mockk.mockk
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §8.3 记忆资产源测试:export Ok→Records(id+json,version 0)、export 失败→空、write 把记录
 * 拼成 JSON 数组文件并调 runner.importMemory、空写 no-op。mockk LocalCcRunner(真 cc 是设备集成)。
 */
class PdhMemoryAssetSourceTest {

    private fun tempDir(): File =
        File.createTempFile("memsrc", ".d").let { it.delete(); it.mkdirs(); it }

    private fun rec(key: String, json: String) =
        PdhBackupCoordinator.Record(key, 0L, json.toByteArray())

    @Test
    fun read_maps_memory_entries_to_records() {
        val runner = mockk<LocalCcRunner>()
        coEvery { runner.exportMemory(any()) } returns LocalCcRunner.ExportEventsResult.Ok(
            listOf(
                LocalCcRunner.ExportedEvent("m1", """{"id":"m1","content":"妈妈=张三"}"""),
                LocalCcRunner.ExportedEvent("m2", """{"id":"m2","content":"外卖=美团"}"""),
            ),
        )
        val out = PdhMemoryAssetSource(runner, tempDir()).read()
        assertEquals(listOf("m1", "m2"), out.map { it.key })
        assertTrue(out.all { it.version == 0L })
        assertEquals("""{"id":"m1","content":"妈妈=张三"}""", String(out.first().content))
    }

    @Test
    fun read_failed_returns_empty() {
        val runner = mockk<LocalCcRunner>()
        coEvery { runner.exportMemory(any()) } returns
            LocalCcRunner.ExportEventsResult.Failed("spawn-failed", null)
        assertTrue(PdhMemoryAssetSource(runner, tempDir()).read().isEmpty())
    }

    @Test
    fun write_assembles_json_array_file_and_calls_runner() {
        val runner = mockk<LocalCcRunner>()
        var seen: String? = null
        coEvery { runner.importMemory(any(), any()) } answers {
            seen = firstArg<File>().readText()
            LocalCcRunner.ImportEventsResult.Ok(imported = 2, failed = 0)
        }
        PdhMemoryAssetSource(runner, tempDir()).write(
            listOf(rec("m1", """{"id":"m1"}"""), rec("m2", """{"id":"m2"}""")),
        )
        assertEquals("""[{"id":"m1"},{"id":"m2"}]""", seen)
    }

    @Test
    fun write_empty_is_noop() {
        val runner = mockk<LocalCcRunner>() // no stubs → any call fails the test
        PdhMemoryAssetSource(runner, tempDir()).write(emptyList())
    }
}
