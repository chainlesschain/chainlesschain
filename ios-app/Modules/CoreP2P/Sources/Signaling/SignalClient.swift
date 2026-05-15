import Foundation

/// WebSocket 信令客户端 protocol — Phase 1.2 由 `WebSocketSignalClient`
/// (URLSessionWebSocketTask) 实现。
///
/// **设计约束（与 Plan A.1 echo-loop bug 对齐）**：实现侧 `currentPeerId` 必须
/// 只在 `register()` 内赋值，`sendOffer/sendAnswer/sendCandidate` 内禁止
/// `currentPeerId = peerId`（peerId 是 target 不是 self；WS 重连 auto-register
/// 会把自己注册成对方身份 → 消息路由回自己）。grep `currentPeerId\s*=`
/// 必须只命中 register。
public protocol SignalClient: AnyObject, Sendable {
    /// 建立 WS 连接到 signaling server。Idempotent — 已连时是 no-op。
    func connect() async throws

    /// 主动断开 + 清缓存。LAN ↔ 中继 fallback 切 URL 前必调。
    func disconnect() async

    /// 注册自己的 peer-id 给 signaling server，让对端能 forward 消息过来。
    /// **必须**在 connect 之后调；可重复（重连后自动重发）。
    func register(peerId: String, metadata: [String: String]) async throws

    /// 经 signaling server forward 一条消息到 toPeerId。
    /// payload 必须能 JSON-encode（[String: Any] 或 NSDictionary 兼容）。
    func sendForwardedMessage(toPeerId: String, payload: [String: Any]) async throws

    /// **所有** 入站 type=message forwarded 帧的 raw JSON string —
    /// Phase 2.4 加的多订阅入口（与 Android `SignalClient.forwardedMessages:
    /// SharedFlow<String>` 对齐）。
    ///
    /// **scope**：`{type:"message", from, payload, timestamp}` 形态的所有
    /// inbound 都 emit 到此流。订阅者按 `payload.type` 自分发：
    /// - Phase 2.4 `RemoteDependencies` 路由 `answer/ice-candidate/
    ///   chainlesschain:*` 给 `RemoteWebRTCClient.handle*`
    /// - Phase 1 pairing flow 仍通过 [PairingMessageBus] 收 `pairing:confirmation`
    ///   （WebSocketSignalClient 内部既 emit 到 messageBus 也 yield 到本流，
    ///   两条路径并存，订阅者只听自己关心的）
    ///
    /// **注**：与 Android Trap 1（setOnForwardedMessageReceived 单 listener
    /// 后写覆盖前写）防御 — iOS 从一开始就用 AsyncStream 多订阅。
    var forwardedMessages: AsyncStream<String> { get }
}
