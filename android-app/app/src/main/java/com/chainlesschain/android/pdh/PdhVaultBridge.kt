package com.chainlesschain.android.pdh

/**
 * §8.3 vault 资产源桥(具体 [PdhBackupCoordinator.AssetSource])—— module 101 Phase 7.
 *
 * 让 cc 管理的 vault(SQLite)作为一类备份资产参与 §8.3 同步。vault 事件不可变、带稳定
 * `id`,putEvent 对 id 幂等 upsert(ON CONFLICT(id))→ 完美匹配 [AssetKind.VAULT] 的
 * 全序并集合并:
 *  - read(备份):导出全部 vault 事件 → 每个事件一条 Record(key=事件 id、content=事件原始
 *    JSON、version=0 不可变);
 *  - write(恢复):把收敛后的事件经 importEvents 幂等导入(本地已有的是 no-op upsert,远端
 *    新事件被插入)。
 *
 * **活库只读 §5.2 + cc 独占 vault**:不直读 vault.db(WAL/并发风险),一律经 cc 子进程。
 * [CcVaultGateway] 是 seam(测试注入 in-memory fake);真实现走 `cc hub` 子进程导出/导入
 * 事件(**Node 侧待补 `hub export-events --json` / `hub import-events` 命令**——vault.js 已
 * 有 queryEvents/putEvent 原语,加薄 CLI 即可;改 pdh/lib 须走发版链 traps #27/#28)。
 *
 * 桥本身(事件 ⇄ Record 映射)纯逻辑、不解析 JSON(gateway 给 id + 原始 json)→ 可单测。
 */
class PdhVaultBridge(
    private val gateway: CcVaultGateway,
) : PdhBackupCoordinator.AssetSource {

    override val kind: AssetKind = AssetKind.VAULT

    /** 一个 vault 事件:稳定 [id] + 原始事件 [json](由 cc 导出/导入)。 */
    data class VaultEventBlob(val id: String, val json: String)

    /** 读写 vault 事件的 seam。真实现走 cc hub 子进程(export/import events,Node 侧待补)。 */
    interface CcVaultGateway {
        fun exportEvents(): List<VaultEventBlob>
        fun importEvents(events: List<VaultEventBlob>)
    }

    override fun read(): List<PdhBackupCoordinator.Record> =
        gateway.exportEvents().map {
            PdhBackupCoordinator.Record(key = it.id, version = 0L, content = it.json.toByteArray(Charsets.UTF_8))
        }

    override fun write(records: List<PdhBackupCoordinator.Record>) {
        // vault 事件不可变 + putEvent 对 id 幂等 upsert → 导入全量收敛集安全(本地项 no-op)。
        gateway.importEvents(
            records.map { VaultEventBlob(id = it.key, json = String(it.content, Charsets.UTF_8)) },
        )
    }
}
