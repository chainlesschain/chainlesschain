package com.chainlesschain.android.pdh

import java.io.File

/**
 * §8.3 文件型资产源(具体实现)—— module 101 Phase 7.
 *
 * [PdhBackupCoordinator.AssetSource] 的生产实现:把一类资产的记录持久成一个**暂存文件**
 * (每行一条 [PdhRecordCodec] 编码的记录,base64 → 无换行)。read/write 即解析/重写该文件。
 *
 * 用途:把各资产**暂存**成统一格式喂备份编排([PdhBackupCoordinator])。文件型资产
 * (instinct / 记忆 / 技能,本就在 cc HOME 下的文件)由各自的导出器写进暂存文件即可直接
 * 用本源;**vault(SQLite,cc 管)需额外的 cc 导出/导入桥**把行记录写进/读出暂存文件
 * (活库不直读,§5.2 原库只读)。暂存文件应落在 app 私有沙箱、加密(§7.3)。
 *
 * 纯 JVM(java.io.File,无 Android 框架)→ 可单测(临时文件往返)。read 容错:文件缺=空、
 * 跳过坏行;write 原子重写(覆盖)。
 */
class PdhFileAssetSource(
    override val kind: AssetKind,
    private val file: File,
    private val codec: PdhBackupCoordinator.RecordCodec = PdhRecordCodec,
) : PdhBackupCoordinator.AssetSource {

    override fun read(): List<PdhBackupCoordinator.Record> {
        if (!file.exists()) return emptyList()
        return file.readLines(Charsets.UTF_8)
            .filter { it.isNotBlank() }
            .mapNotNull { line ->
                runCatching { codec.decode(line.toByteArray(Charsets.UTF_8)) }.getOrNull()
            }
    }

    override fun write(records: List<PdhBackupCoordinator.Record>) {
        file.parentFile?.mkdirs()
        val text = records.joinToString("\n") { String(codec.encode(it), Charsets.UTF_8) }
        file.writeText(text, Charsets.UTF_8)
    }
}
