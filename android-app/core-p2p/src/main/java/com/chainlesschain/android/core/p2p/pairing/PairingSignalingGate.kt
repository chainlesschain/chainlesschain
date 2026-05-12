package com.chainlesschain.android.core.p2p.pairing

/**
 * 主动建立 / 维护 signaling WS 连接 — Android v1.1 W3.6 (issue #19)。
 *
 * **架构动机**：Flow A 配对要求 mobile **先**连上信令服务器才能收 desktop
 * 发的 `pairing:confirmation`。但 `SignalClient.connect()` 默认是 lazy，只在
 * `WebRTCClient.connect(pcPeerId, localPeerId)` 里被调，而那条路径需要先有
 * 已知的 pcPeerId — 配对前不存在，鸡生蛋。
 *
 * 本接口让 `DesktopPairingViewModel.startPairing()` 能主动触发 signaling
 * connect + register，与现有 PairingMessageBus listener 配合实现完整
 * round-trip。`:app` 模块 `WebSocketPairingSignalingGate` 实现，包 SignalClient。
 *
 * 与 [PairingMessageBus] 同模式 — interface 落 core-p2p 让 feature-p2p
 * DesktopPairingViewModel 无须依赖 :app。
 */
interface PairingSignalingGate {
    /**
     * 确保 signaling WS 已连 + register 一个临时 peer-id（用于 desktop 回的
     * `pairing:confirmation` 经信令路由到本设备）。
     *
     * **Idempotent**：已连时是 no-op。失败时返 [Result.failure]，ViewModel
     * 可降级到"无 confirmation"模式（仍显 QR 让用户重试）。
     */
    suspend fun ensureRegistered(localPeerId: String): Result<Unit>
}
