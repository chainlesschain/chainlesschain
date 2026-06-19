package com.chainlesschain.android.presentation.aistudy

/**
 * 积分流水上行 outbox 端口 (FAMILY-67)。
 *
 * 本机产生的 earn/spend/grant 经 [SyncingPointsLedger] append 后调 [enqueue]，把流水排入
 * 同步队列 (真实适配器 `SyncManagerPointsLedgerOutbox` 包成 SyncItem → SyncManager)，
 * SyncCoordinator 推到对端 (家长/孩子)。append-only，对端去重靠 id。
 */
interface PointsLedgerOutbox {

    /** 把一条本机新增的积分流水排入上行同步队列。 */
    suspend fun enqueue(event: PointsEvent)
}
