import Foundation
import CoreP2P

/// 远程终端 DI container — Phase 2.4 (design doc §4.3)。
///
/// 单例模式：v0.1 同时只支持一台已配对桌面的远程终端会话（与 Android Plan A.1
/// v0.1 一致）。切换桌面前必须先 `disconnect()`。
///
/// **职责**：
/// 1. 从 [PairingDependencies] 接力构造 RemoteWebRTCClient + TerminalRpcClient
///    + PlanA1FeatureFlags
/// 2. 起一个长存 forwarding task：订阅 `pairingDeps.signalClient.forwardedMessages`
///    把 answer / ice-candidate / chainlesschain:* 路由到 RemoteWebRTCClient 的对应
///    handler — 这是 Phase 2.1 留的 wiring 缺口（没人喂 handleAnswerFromSignaling）
public final class RemoteDependencies: ObservableObject {
    public let webRTCClient: RemoteWebRTCClient
    public let terminalRpc: TerminalRpcClient
    public let featureFlags: PlanA1FeatureFlags

    private let pairingDeps: PairingDependencies
    private var forwardingTask: Task<Void, Never>?

    public init(pairingDeps: PairingDependencies) {
        self.pairingDeps = pairingDeps
        self.featureFlags = PlanA1FeatureFlags()

        let transport: WebRTCPeerConnectionTransport = GoogleWebRTCPeerConnectionTransport()
        let pairingStore = pairingDeps.pairedDesktopsStore

        let webRTC = RemoteWebRTCClient(
            signalingGate: pairingDeps.signalingGate,
            messageBus: pairingDeps.messageBus,
            transport: transport,
            iceServersProvider: { pcPeerId in
                let devices = await pairingStore.devices()
                return devices.first(where: { $0.pcPeerId == pcPeerId })?.iceServersJson
            }
        )
        self.webRTCClient = webRTC

        let flags = self.featureFlags
        self.terminalRpc = TerminalRpcClient(
            dataChannelSender: { text in
                try await webRTC.sendMessage(text)
            },
            signalingSender: { [weak pairingGate = pairingDeps.signalingGate] pcPeerId, envelopeJson in
                guard let gate = pairingGate else {
                    throw TerminalRpcError.allTransportsFailed(lastError: "signalingGate deallocated")
                }
                guard let data = envelopeJson.data(using: .utf8),
                      let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw TerminalRpcError.malformedResult(reqId: "", detail: "envelope not JSON")
                }
                try await gate.sendAck(toPeerId: pcPeerId, ackPayload: dict)
            },
            isDataChannelReady: { await webRTC.currentState == .ready },
            inboundMessages: webRTC.inboundMessages,
            featureFlags: flags
        )

        // 起 forwarding task — SignalClient.forwardedMessages → 路由到 webRTC
        let signalClient = pairingDeps.signalClient
        self.forwardingTask = Task { [weak webRTC] in
            let stream = signalClient.forwardedMessages
            for await raw in stream {
                guard let webRTC = webRTC else { return }
                await Self.routeForwardedToWebRTC(raw: raw, client: webRTC)
            }
        }
    }

    deinit {
        forwardingTask?.cancel()
    }

    /// 解析 forwarded 帧 + 路由到 RemoteWebRTCClient 的对应 handler。
    ///
    /// **路由规则**：
    /// - `payload.type == "answer"` → `handleAnswerFromSignaling`（PC 5 步握手第 5 步）
    /// - `payload.type == "ice-candidate"` → `handleRemoteIceCandidate`（trickle ICE）
    /// - `payload.type` 以 `chainlesschain:` 开头 → `emitInboundFromSignaling`
    ///   （Plan A.1 fallback 路径下 stdout/exit/response 会从 signaling 来）
    private static func routeForwardedToWebRTC(raw: String, client: RemoteWebRTCClient) async {
        guard let data = raw.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data),
              let dict = root as? [String: Any],
              let payload = dict["payload"] as? [String: Any],
              let type = payload["type"] as? String else {
            return
        }
        switch type {
        case "answer":
            // 桌面 wire 格式可能是 {"type":"answer","answer":{"type":"answer","sdp":"..."}}
            // 或简化 {"type":"answer","sdp":"..."}
            let sdp: String?
            if let nested = payload["answer"] as? [String: Any] {
                sdp = nested["sdp"] as? String
            } else {
                sdp = payload["sdp"] as? String
            }
            guard let answerSdp = sdp, !answerSdp.isEmpty else { return }
            await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: answerSdp))
        case "ice-candidate":
            // 桌面格式: {"type":"ice-candidate","candidate":{"candidate":"...","sdpMid":"0","sdpMLineIndex":0}}
            // 兼容 flat: {"type":"ice-candidate","candidate":"...","sdpMid":"0","sdpMLineIndex":0}
            let cSdp: String?
            let cMid: String?
            let cLine: Int?
            if let candObj = payload["candidate"] as? [String: Any] {
                cSdp = candObj["candidate"] as? String
                cMid = candObj["sdpMid"] as? String
                cLine = (candObj["sdpMLineIndex"] as? Int) ?? Int(candObj["sdpMLineIndex"] as? Int64 ?? 0)
            } else {
                cSdp = payload["candidate"] as? String
                cMid = payload["sdpMid"] as? String
                cLine = (payload["sdpMLineIndex"] as? Int) ?? 0
            }
            guard let sdp = cSdp, let mid = cMid, let line = cLine, !sdp.isEmpty else { return }
            try? await client.handleRemoteIceCandidate(
                OutboundIceCandidate(sdp: sdp, sdpMid: mid, sdpMLineIndex: Int32(line))
            )
        default:
            // chainlesschain:command:response / chainlesschain:event 等业务 envelope
            if type.hasPrefix("chainlesschain:") {
                // 转 inner payload 为完整 envelope 字符串再 emit（TerminalRpcClient 期望
                // 入站是 envelope JSON，而非 forwarded wrapper）
                let inner: [String: Any] = ["type": type, "payload": payload["payload"] ?? [:]]
                if let innerData = try? JSONSerialization.data(withJSONObject: inner),
                   let innerStr = String(data: innerData, encoding: .utf8) {
                    await client.emitInboundFromSignaling(innerStr)
                }
            }
            // 其它 type (pairing:* 等) 由各自订阅者处理
        }
    }
}
