import Foundation

/// `RemoteWebRTCClient` 错误类型 — Phase 2.1。
///
/// 错误粒度对齐 Android Plan A.1 `WebRTCClient` 的 `Result.failure(...)`
/// 路径，方便 telemetry / UI 文案分类映射。
public enum RemoteWebRTCError: Error, Equatable, Sendable {
    /// DC 还没 ready 时调 `sendMessage` — 本错误是 `TerminalRpcClient` fallback
    /// 到 signaling 路径的 trigger（与 Android `IllegalStateException("Data
    /// channel not open")` 对应，见 design doc §3.4）。
    case dataChannelNotOpen

    /// signaling WS 连接失败（Phase 1 已有）。
    case signalingConnectFailed(String)

    /// register 失败 — server 没回 type=registered，或 ack 字段缺失。
    case registrationFailed(String)

    /// `createOffer()` 失败 — Google SDK 内部错误（极少；通常 SDP 协商失败）。
    case offerFailed(String)

    /// 等 answer 超时 — 默认 30s（与 Android `WebRTCClient` Channel(1) 阻塞读
    /// 默认行为对齐；测试可 override）。
    case answerTimeout

    /// `setRemoteDescription` 失败 — 收到的 answer SDP 不合法。
    case invalidAnswer(String)

    /// ICE 协商失败 / `RTCIceConnectionState.failed` — 通常 NAT 双向对称且
    /// TURN 也不通。`TerminalRpcClient` 此时应 fallback signaling。
    case iceFailed

    /// DC `RTCDataChannelState.closed` 异常（非显式 disconnect）。
    case dataChannelClosed

    /// 进程未初始化 WebRTC SDK（不应该发生 — `WebRTCRuntime.shared` 自动 lazy init）。
    case runtimeNotInitialized
}
