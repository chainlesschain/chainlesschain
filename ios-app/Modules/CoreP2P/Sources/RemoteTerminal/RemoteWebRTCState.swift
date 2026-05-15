import Foundation

/// `RemoteWebRTCClient` 8-态状态机 — Phase 2.1，与 Android `P2PConnectionState` 对齐。
///
/// **关键语义区分**：
/// - `.dataChannelOpen` = ICE 已 connected，DC 物理 OPEN（`RTCDataChannelState.open`），
///   但 desktop 端可能还未确认 — **不一定能 send**
/// - `.ready` = `.dataChannelOpen` + 双方握手完，**真正可 send**
///
/// 判断 DC 可用性应 grep `state == .ready`，**不是 .dataChannelOpen**（与
/// Android line 314-383 同陷阱）。
public enum RemoteWebRTCState: Sendable, Equatable {
    case disconnected
    case signalingConnected     // signaling WS open + register 完成
    case registered              // server 回 type=registered
    case creatingOffer
    case waitingAnswer
    case iceConnecting           // 拿到 answer + setRemoteDescription，ICE 协商中
    case dataChannelOpen         // ICE connected + DC `RTCDataChannelState.open`
    case ready                   // DC 真正可 send（dataChannelOpen + 握手交换完）
    case failed(reason: String)
}

/// `RTCDataChannelState` 的 Sendable 镜像（Google SDK 类型不是 Sendable）。
public enum DataChannelReadyState: Sendable, Equatable {
    case connecting
    case open
    case closing
    case closed
}

/// 出站 ICE candidate — 经 signaling forward 给 desktop 用。
public struct OutboundIceCandidate: Sendable, Equatable {
    public let sdp: String
    public let sdpMid: String
    public let sdpMLineIndex: Int32

    public init(sdp: String, sdpMid: String, sdpMLineIndex: Int32) {
        self.sdp = sdp
        self.sdpMid = sdpMid
        self.sdpMLineIndex = sdpMLineIndex
    }
}

/// SDP 描述 — actor boundary 上传送 string + type 而非 RTCSessionDescription
/// （后者非 Sendable）。
public struct SdpDescription: Sendable, Equatable {
    public enum SdpType: String, Sendable {
        case offer
        case answer
    }
    public let type: SdpType
    public let sdp: String

    public init(type: SdpType, sdp: String) {
        self.type = type
        self.sdp = sdp
    }
}
