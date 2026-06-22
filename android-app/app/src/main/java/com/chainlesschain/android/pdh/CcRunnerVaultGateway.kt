package com.chainlesschain.android.pdh

import kotlinx.coroutines.runBlocking
import timber.log.Timber
import java.io.File

/**
 * §8.3 [PdhVaultBridge.CcVaultGateway] 的真实现 —— module 101 Phase 7.
 *
 * 让 cc 管理的 vault 经 `cc hub export-events` / `import-events`(v5.0.3.126 起在设备上)
 * 参与备份:
 *  - exportEvents:跑 export-events,把每条事件映射成 [PdhVaultBridge.VaultEventBlob](id+原始 JSON);
 *  - importEvents:把块写成 JSON 数组暂存文件([PdhVaultImportFile.assemble]),跑 import-events
 *    幂等导入(ON CONFLICT(id) upsert),完后删暂存文件。
 *
 * 活库只读 §5.2 + cc 独占 vault → 一律经 cc 子进程([LocalCcRunner]),不直读 vault.db。
 * 接口是同步的(AssetSource 契约),底层 cc 调用是 suspend → 这里 [runBlocking] 桥接
 * (备份非热路径,可接受阻塞)。失败best-effort:导出失败回空、导入失败记日志不抛
 * (§13.4 诚实降级;上层 SyncOutcome 另有传输/解密统计)。
 */
class CcRunnerVaultGateway(
    private val runner: LocalCcRunner,
    /** 暂存导入文件的目录(app 私有沙箱)。 */
    private val tempDir: File,
) : PdhVaultBridge.CcVaultGateway {

    override fun exportEvents(): List<PdhVaultBridge.VaultEventBlob> =
        when (val r = runBlocking { runner.exportEvents() }) {
            is LocalCcRunner.ExportEventsResult.Ok ->
                r.events.map { PdhVaultBridge.VaultEventBlob(id = it.id, json = it.json) }
            is LocalCcRunner.ExportEventsResult.Failed -> {
                Timber.w("CcVaultGateway.exportEvents failed: ${r.reason}")
                emptyList()
            }
        }

    override fun importEvents(events: List<PdhVaultBridge.VaultEventBlob>) {
        if (events.isEmpty()) return
        if (!tempDir.exists()) tempDir.mkdirs()
        // 唯一文件名(基于内容大小 + 首块 id 摘要,避免并发覆盖;无 Date/Random 依赖)。
        val stamp = "${events.size}-${events.first().id.hashCode()}"
        val file = File(tempDir, "pdh-import-$stamp.json")
        try {
            file.writeText(PdhVaultImportFile.assemble(events.map { it.json }), Charsets.UTF_8)
            when (val r = runBlocking { runner.importEvents(file) }) {
                is LocalCcRunner.ImportEventsResult.Ok ->
                    Timber.d("CcVaultGateway.importEvents: imported=%d failed=%d", r.imported, r.failed)
                is LocalCcRunner.ImportEventsResult.Failed ->
                    Timber.w("CcVaultGateway.importEvents failed: ${r.reason}")
            }
        } finally {
            file.delete()
        }
    }
}
