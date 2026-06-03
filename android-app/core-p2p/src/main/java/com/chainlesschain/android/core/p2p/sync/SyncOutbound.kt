package com.chainlesschain.android.core.p2p.sync

/**
 * Android → 远端 (PC 桌面) 出向 JSON-RPC sync.* 调用接口（Phase 3d M3 step D.5）。
 *
 * SyncManager 通过这层抽象推送本地变更到对端，避免 core-p2p 模块直接依赖
 * app 模块的 P2PClient（反向跨模块）。具体实现 P2PClientSyncOutbound 在 app
 * 模块，注入 P2PClient 通过 sendCommand 走 chainlesschain:command:request 编码。
 *
 * 与 desktop src/main/sync/mobile-bridge-sync.js 的 _sendItem / _invokeRemote
 * 对称：
 *   - desktop → Android: 桌面调 mobileBridge.sendToMobile
 *   - Android → desktop: SyncManager 调 SyncOutbound（=P2PClient.sendCommand）
 *
 * v1 仅推送（pushItem）。pullFromDevice 留 v1.1 用于 Android 主动从桌面拉
 * cursor 之后的变更（catch-up）。
 *
 * 失败处理：
 *   - 网络错/超时 → impl 抛异常，SyncManager 内部 try/catch 跳过该项不阻塞
 *   - 协议层错（method-not-found 等）→ 返回 SyncPushResponse(status="failed",
 *     error=...)
 *   - 冲突 → 返回 SyncPushResponse(status="conflict", resolved=...)，SyncManager
 *     按 LWW 决策：远端胜则 apply resolved 到本地；本地胜则保留 pendingChanges
 */
interface SyncOutbound {
    /**
     * 推送一条 SyncItem 到对端。返回对端 handlePushRpc 的 response，
     * 异常情况抛 throw（SyncManager 包 try/catch 处理）。
     *
     * @param deviceId 目标对端 deviceId（信令服务器/路由用）
     * @param item 待推送的同步项
     */
    suspend fun pushItem(deviceId: String, item: SyncItem): SyncPushResponse

    /**
     * 从对端拉取 cursor 之后的变更（v1.1）。v1 SyncManager 不调用，仅作占位。
     */
    suspend fun pullFromDevice(
        deviceId: String,
        cursor: PullCursor,
        resourceTypes: List<ResourceType>?,
        limit: Int
    ): SyncPullResponse
}
