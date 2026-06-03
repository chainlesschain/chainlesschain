import Foundation

/// `PairingSignalingGate` 默认实现 — Phase 1.2。
///
/// 镜像 Android `app/.../remote/webrtc/WebSocketPairingSignalingGate.kt`。包
/// [SignalClient] 的 connect + register 调用，提供 idempotent ensureRegistered
/// 给 ViewModel 用，让 mobile signaling WS 在 startPairing 时就连上来，能监听
/// desktop 经信令发的 `pairing:confirmation`。
///
/// **Why actor**：同时多个 caller 调 ensureRegistered（如反复点 startPairing）
/// 会引发 race condition 多次连接；actor 串行化 + state flag 让重复调真 no-op。
public actor DefaultPairingSignalingGate: PairingSignalingGate {
    private let signalClient: SignalClient
    private var registeredPeerId: String?

    public init(signalClient: SignalClient) {
        self.signalClient = signalClient
    }

    public func ensureRegistered(localPeerId: String) async throws {
        // Short-circuit 仅在仍记得已 register 同 peer-id 时有效。WebSocketSignalClient
        // 的 reconnect 路径会在 onOpen 自动重发上次 register（见 WebSocketSignalClient
        // openOnce）。所以这里 short-circuit 安全 — 即使 WS 断过、reconnect 后
        // server 仍认得这个 peer。
        if registeredPeerId == localPeerId {
            return
        }
        try await signalClient.connect()
        try await signalClient.register(
            peerId: localPeerId,
            metadata: [
                "name": "iOS Device",  // Phase 1.3 替换为 PairingDeviceInfoProvider.name()
                "platform": "ios",
                "role": "pairing-listener"
            ]
        )
        registeredPeerId = localPeerId
    }

    public func sendAck(toPeerId: String, ackPayload: [String: Any]) async throws {
        // 自己 register peer-id 优先级（与 Android line 84-96 一致）：
        //   1. ackPayload.mobileDid — pair-ack 路径会带（W3.7 Flow B）
        //   2. registeredPeerId — 已经注册过就复用
        //   3. 兜底 mobile-${ts} — 首次且无 DID 的极少数情况
        let selfPeerId: String
        if let did = ackPayload["mobileDid"] as? String, !did.isEmpty {
            selfPeerId = did
        } else if let prev = registeredPeerId {
            selfPeerId = prev
        } else {
            selfPeerId = "mobile-\(Int(Date().timeIntervalSince1970 * 1000))"
        }
        try await ensureRegistered(localPeerId: selfPeerId)
        try await signalClient.sendForwardedMessage(toPeerId: toPeerId, payload: ackPayload)
    }

    public func reset() async {
        await signalClient.disconnect()
        registeredPeerId = nil
    }
}
