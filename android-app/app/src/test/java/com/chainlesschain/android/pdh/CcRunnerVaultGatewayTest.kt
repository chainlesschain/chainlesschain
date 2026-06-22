package com.chainlesschain.android.pdh

import io.mockk.coEvery
import io.mockk.mockk
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §8.3 CcVaultGateway 测试:export Ok→blobs(id+json)、export 失败→空、import 把块写成
 * JSON 数组文件并调 runner、空导入 no-op。mockk LocalCcRunner(真 cc 调用是设备集成,不在此)。
 */
class CcRunnerVaultGatewayTest {

    private fun tempDir(): File =
        File.createTempFile("gwtest", ".d").let { it.delete(); it.mkdirs(); it }

    private fun blob(id: String, json: String) = PdhVaultBridge.VaultEventBlob(id, json)

    @Test
    fun export_ok_maps_events_to_blobs() {
        val runner = mockk<LocalCcRunner>()
        coEvery { runner.exportEvents(any()) } returns LocalCcRunner.ExportEventsResult.Ok(
            listOf(
                LocalCcRunner.ExportedEvent("e1", """{"id":"e1","subtype":"msg"}"""),
                LocalCcRunner.ExportedEvent("e2", """{"id":"e2"}"""),
            ),
        )
        val out = CcRunnerVaultGateway(runner, tempDir()).exportEvents()
        assertEquals(listOf("e1", "e2"), out.map { it.id })
        assertEquals("""{"id":"e1","subtype":"msg"}""", out.first().json)
    }

    @Test
    fun export_failed_returns_empty() {
        val runner = mockk<LocalCcRunner>()
        coEvery { runner.exportEvents(any()) } returns
            LocalCcRunner.ExportEventsResult.Failed("spawn-failed", null)
        assertTrue(CcRunnerVaultGateway(runner, tempDir()).exportEvents().isEmpty())
    }

    @Test
    fun import_writes_json_array_file_and_calls_runner() {
        val runner = mockk<LocalCcRunner>()
        var seenContent: String? = null
        coEvery { runner.importEvents(any(), any()) } answers {
            // 读暂存文件内容(在 gateway finally 删除之前)
            seenContent = firstArg<File>().readText()
            LocalCcRunner.ImportEventsResult.Ok(imported = 2, failed = 0)
        }
        CcRunnerVaultGateway(runner, tempDir()).importEvents(
            listOf(blob("a", """{"id":"a"}"""), blob("b", """{"id":"b"}""")),
        )
        assertEquals("""[{"id":"a"},{"id":"b"}]""", seenContent)
    }

    @Test
    fun import_empty_is_noop() {
        val runner = mockk<LocalCcRunner>() // no stubs → any call would fail the test
        CcRunnerVaultGateway(runner, tempDir()).importEvents(emptyList())
        // reaching here without a mockk "no answer found" error proves no runner call
    }
}
