package com.chainlesschain.android.core.p2p.sync

/**
 * 家长端 telemetry 接收落库端口 (FAMILY-26 下行侧)。
 *
 * 对称于上行 `SyncManagerTelemetryOutbox`（:app，把孩子端 TelemetryEvent 编码成
 * [ResourceType.TELEMETRY] 的 SyncItem 入队）：家长端 [SyncManager] 收到该 item 后，
 * [SyncDataApplier] 按 ResourceType 路由到本端口，由 :app 的实装解码（`TelemetryIngest`）
 * 并落 child_event 镜像表，供「孩子活动看板」聚合展示。
 *
 * 同 [FamilyGuardSyncApplier] / [KnowledgeSyncApplier] 模式：接口在 core-p2p，实装在
 * :app（:app 同时依赖 core-p2p + feature-family-guard，是接通收件落库的唯一合适层），
 * feature-p2p 的 [SyncDataApplier] 路由器经本端口调用，避免横向模块依赖。
 *
 * telemetry 是 **append-only 事件**：上行只发 CREATE，故只定义保存入口；UPDATE 路由复用
 * 同一保存（幂等，重复投递由 SyncManager 的 resourceId 去重 + 内容去重兜底），DELETE 无语义。
 */
interface TelemetrySyncApplier {

    /**
     * 落一条收到的孩子 telemetry。
     * @param resourceId SyncItem.resourceId（稳定键 `telemetry|childDid|source|kind|ts`，用于日志/溯源）。
     * @param data SyncItem.data（孩子端 TelemetrySyncData 的 JSON 编码）。
     */
    suspend fun saveTelemetryFromSync(resourceId: String, data: String)
}
