package com.chainlesschain.android.core.p2p.sync

/**
 * 积分流水接收落库端口 (FAMILY-67 积分同步下行侧)。
 *
 * 对称于上行 `SyncManagerPointsLedgerOutbox`（:app，把本机 PointsEvent 编码成
 * [ResourceType.POINTS_EVENT] 的 SyncItem 入队）：对端 [SyncManager] 收到该 item 后，
 * [SyncDataApplier] 按 ResourceType 路由到本端口，由 :app 的实装解码
 * (`PointsEventSyncData`)、鉴权 (GRANT 须 PARENT/GUARDIAN)、经 PointsLedger 落库。
 *
 * 积分流水是 **append-only**：上行只发 CREATE，故只定义保存入口；UPDATE 路由复用同一保存
 * (幂等，DAO `INSERT … IGNORE` 按 id 去重)，DELETE 无语义。
 */
interface PointsLedgerSyncApplier {

    /**
     * 落一条收到的积分流水。
     * @param resourceId SyncItem.resourceId（形如 `points_event|<id>`，用于日志/溯源）。
     * @param data SyncItem.data（对端 PointsEventSyncData 的 JSON 编码）。
     */
    suspend fun savePointsEventFromSync(resourceId: String, data: String)
}
