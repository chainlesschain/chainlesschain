import Foundation

/// 主动建立 / 维护 signaling WS 连接 — Phase 1.2 完整实现。
///
/// 对应 Android `core-p2p/.../pairing/PairingSignalingGate.kt`。架构动机：
/// `SignalClient.connect()` 默认 lazy，只在 `WebRTCClient.connect(pcPeerId,
/// localPeerId)` 被调，那条路径需要先有已知 pcPeerId — 配对前不存在，鸡生蛋。
/// 本 protocol 让 ViewModel 能主动触发 signaling connect + register。
public protocol PairingSignalingGate: AnyObject, Sendable {
    /// 确保 signaling WS 已连 + register 一个 peer-id。Idempotent。
    /// 失败时 throw，ViewModel 可降级为「无 confirmation」模式（Flow A 仍显 QR）。
    func ensureRegistered(localPeerId: String) async throws

    /// Flow B: phone 扫桌面 QR 完成后经信令发 pair-ack 给桌面 pcPeerId。
    /// 内部先 `ensureRegistered` 保证 WS 已连，再 sendForwardedMessage。
    ///
    /// Payload 字段（与 desktop `desktop-pair-handlers.recordPairAck` 对齐）：
    ///   `{type:"pair-ack", pairingCode, mobileDid, deviceInfo:{deviceId,name,platform}, timestamp}`
    func sendAck(toPeerId: String, ackPayload: [String: Any]) async throws

    /// 切 signaling URL 前必调（LAN ↔ 中继 fallback），清缓存的 registeredPeerId
    /// 避免 ensureRegistered 短路不重连。
    func reset() async
}
