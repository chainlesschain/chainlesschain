package com.chainlesschain.android.pdh

import kotlinx.coroutines.runBlocking
import timber.log.Timber
import java.io.File

/**
 * §8.3 记忆资产源(具体 [PdhBackupCoordinator.AssetSource])—— module 101 Phase 7.
 *
 * 让 cc 的层次化记忆(`memory_entries`)经 `cc memory export` / `import` 参与备份:
 *  - read(备份):export → 每条记忆 → Record(key=记忆 id、content=记忆条 JSON、version=0;
 *    MEMORY 走 [PdhAssetMerge] 的并集去重,version 不参与);
 *  - write(恢复):把记录拼成 JSON 数组暂存文件([PdhVaultImportFile.assemble])→ import
 *    幂等 upsert(ON CONFLICT(id))→ 删暂存文件。
 *
 * 与 [PdhVaultBridge]/[CcRunnerVaultGateway] 同构,但记忆库走 cc 主 DB(`cc memory ...`),
 * 故直接包 [LocalCcRunner](活库只读 §5.2:一律经 cc 子进程,不直读 DB)。接口同步、cc 调用
 * suspend → [runBlocking] 桥接(备份非热路径)。失败 best-effort(导出失败回空、导入失败记日志,
 * §13.4)。映射 + 暂存可单测(mockk LocalCcRunner);真 cc 调用是设备集成。
 *
 * **注:`cc memory export/import` 命令随下个 cc 发版上设备**(同 vault 命令随 v5.0.3.126)。
 */
class PdhMemoryAssetSource(
    private val runner: LocalCcRunner,
    private val tempDir: File,
) : PdhBackupCoordinator.AssetSource {

    override val kind: AssetKind = AssetKind.MEMORY

    override fun read(): List<PdhBackupCoordinator.Record> =
        when (val r = runBlocking { runner.exportMemory() }) {
            is LocalCcRunner.ExportEventsResult.Ok ->
                r.events.map {
                    PdhBackupCoordinator.Record(key = it.id, version = 0L, content = it.json.toByteArray(Charsets.UTF_8))
                }
            is LocalCcRunner.ExportEventsResult.Failed -> {
                Timber.w("PdhMemoryAssetSource.read failed: ${r.reason}")
                emptyList()
            }
        }

    override fun write(records: List<PdhBackupCoordinator.Record>) {
        if (records.isEmpty()) return
        if (!tempDir.exists()) tempDir.mkdirs()
        val file = File(tempDir, "pdh-memory-import-${records.size}-${records.first().key.hashCode()}.json")
        try {
            file.writeText(
                PdhVaultImportFile.assemble(records.map { String(it.content, Charsets.UTF_8) }),
                Charsets.UTF_8,
            )
            when (val r = runBlocking { runner.importMemory(file) }) {
                is LocalCcRunner.ImportEventsResult.Ok ->
                    Timber.d("PdhMemoryAssetSource.write: imported=%d failed=%d", r.imported, r.failed)
                is LocalCcRunner.ImportEventsResult.Failed ->
                    Timber.w("PdhMemoryAssetSource.write failed: ${r.reason}")
            }
        } finally {
            file.delete()
        }
    }
}
