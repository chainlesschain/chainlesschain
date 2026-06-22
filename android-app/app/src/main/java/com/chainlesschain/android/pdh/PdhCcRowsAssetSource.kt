package com.chainlesschain.android.pdh

import kotlinx.coroutines.runBlocking
import timber.log.Timber
import java.io.File

/**
 * §8.3 通用"cc 行导出/导入"资产源(具体 [PdhBackupCoordinator.AssetSource])—— module 101 Phase 7.
 *
 * 把任意"经 cc 命令导出/导入 (id, json) 行"的 cc 主 DB 资产(instinct / learning trajectories /
 * 未来 store)统一成一个 AssetSource:read → 行→Record(key=id、content=行 JSON、version=0),
 * write → 拼 JSON 数组暂存文件([PdhVaultImportFile])→ import → 删。
 *
 * [exporter]/[importer] 注入对应的 [LocalCcRunner] 方法(如 ::exportInstincts / ::importInstincts)。
 * 与 [PdhMemoryAssetSource] 同构,只是泛化掉具体 store(避免每个 store 一个类)。失败 best-effort
 * (§13.4)。**对应 cc 命令随下个发版上设备**。映射 + 暂存可单测(注入 fake exporter/importer)。
 */
class PdhCcRowsAssetSource(
    override val kind: AssetKind,
    private val tempDir: File,
    private val exporter: suspend () -> LocalCcRunner.ExportEventsResult,
    private val importer: suspend (File) -> LocalCcRunner.ImportEventsResult,
) : PdhBackupCoordinator.AssetSource {

    override fun read(): List<PdhBackupCoordinator.Record> =
        when (val r = runBlocking { exporter() }) {
            is LocalCcRunner.ExportEventsResult.Ok ->
                r.events.map {
                    PdhBackupCoordinator.Record(key = it.id, version = 0L, content = it.json.toByteArray(Charsets.UTF_8))
                }
            is LocalCcRunner.ExportEventsResult.Failed -> {
                Timber.w("PdhCcRowsAssetSource[$kind].read failed: ${r.reason}")
                emptyList()
            }
        }

    override fun write(records: List<PdhBackupCoordinator.Record>) {
        if (records.isEmpty()) return
        if (!tempDir.exists()) tempDir.mkdirs()
        val file = File(tempDir, "pdh-${kind.name.lowercase()}-import-${records.size}-${records.first().key.hashCode()}.json")
        try {
            file.writeText(
                PdhVaultImportFile.assemble(records.map { String(it.content, Charsets.UTF_8) }),
                Charsets.UTF_8,
            )
            when (val r = runBlocking { importer(file) }) {
                is LocalCcRunner.ImportEventsResult.Ok ->
                    Timber.d("PdhCcRowsAssetSource[%s].write: imported=%d failed=%d", kind.name, r.imported, r.failed)
                is LocalCcRunner.ImportEventsResult.Failed ->
                    Timber.w("PdhCcRowsAssetSource[$kind].write failed: ${r.reason}")
            }
        } finally {
            file.delete()
        }
    }
}
