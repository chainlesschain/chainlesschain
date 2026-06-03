import Foundation
import WebRTC

/// `RemoteWebRTCClient` 与 Google WebRTC SDK 之间的抽象层 — Phase 2.1。
///
/// **目的**：让 `RemoteWebRTCClient` 单测时不需要真 `RTCPeerConnection`
/// （Google SDK 强依赖系统 WebRTC dylib，CI 上配置烦）。生产用
/// [GoogleWebRTCPeerConnectionTransport]，测试用 `FakeWebRTCPeerConnectionTransport`。
///
/// **架构对齐**：与 Phase 1 `WebSocketTransport` 同模式（protocol + 真 impl +
/// fake impl）。`RemoteWebRTCClient` 只依赖 protocol，所有 Sendable 边界在
/// 协议方法签名上手动收紧（Google SDK 类型不是 Sendable）。
public protocol WebRTCPeerConnectionTransport: AnyObject, Sendable {
    /// 创建 PeerConnection 并 attach 一个 DataChannel。idempotent — 第二次
    /// 调用前必须 `close()`。delegate 会在 PC/DC 状态变化、入站消息到来时被
    /// 异步调用。
    func setupPeerConnection(
        config: RemoteWebRTCConfig,
        delegate: WebRTCPeerConnectionTransportDelegate
    ) async throws

    /// `peerConnection.createOffer + setLocalDescription` — 返回 offer SDP
    /// 给 caller 经 signaling 发到 desktop。
    func createOffer() async throws -> SdpDescription

    /// `peerConnection.setRemoteDescription(answer)` — caller 从 signaling
    /// 收到 desktop 的 answer 后调本方法。
    func setRemoteAnswer(_ answer: SdpDescription) async throws

    /// 添加 desktop 经 signaling 转发来的 ICE candidate。
    func addRemoteIceCandidate(_ candidate: OutboundIceCandidate) async throws

    /// 通过 DataChannel 发文本 — DC 非 OPEN 时抛 [RemoteWebRTCError.dataChannelNotOpen]。
    func sendDataChannelMessage(_ text: String) async throws

    /// 关闭 PC + DC，清理资源。idempotent。
    func close() async
}

/// `RemoteWebRTCClient` 接收 PC/DC 状态变化和入站消息的回调接口。
///
/// **线程**：Google SDK 在内部 worker 线程触发回调；本 protocol 的方法都是
/// `async` 让 caller 在 actor isolation 内消费（避免 Sendable 警告）。
public protocol WebRTCPeerConnectionTransportDelegate: AnyObject, Sendable {
    /// 本地 ICE candidate 已生成，需经 signaling 发给 desktop。
    func onLocalIceCandidate(_ candidate: OutboundIceCandidate) async

    /// PeerConnection 的 ICE 连接态变化（CONNECTED / DISCONNECTED / FAILED 等）。
    func onIceConnectionState(_ state: RTCIceConnectionStateMirror) async

    /// DataChannel state 变化。
    func onDataChannelStateChange(_ state: DataChannelReadyState) async

    /// DataChannel 入站文本消息。
    func onDataChannelMessage(_ text: String) async
}

/// `RTCIceConnectionState` 的 Sendable 镜像（Google SDK 类型不是 Sendable）。
public enum RTCIceConnectionStateMirror: Sendable, Equatable {
    case new
    case checking
    case connected
    case completed
    case failed
    case disconnected
    case closed
    case count

    public init(_ raw: RTCIceConnectionState) {
        switch raw {
        case .new: self = .new
        case .checking: self = .checking
        case .connected: self = .connected
        case .completed: self = .completed
        case .failed: self = .failed
        case .disconnected: self = .disconnected
        case .closed: self = .closed
        case .count: self = .count
        @unknown default: self = .new
        }
    }
}

// MARK: - Production impl (Google WebRTC SDK)

/// 生产实现 — 包 `RTCPeerConnection` + `RTCDataChannel`。
///
/// **使用流程**：
/// 1. `setupPeerConnection(config:, delegate:)` — 建 PC + DC + 装 delegate
/// 2. `createOffer()` — 拿 offer SDP
/// 3. caller 经 signaling 发 offer 给 desktop
/// 4. caller 收到 answer → `setRemoteAnswer(_:)`
/// 5. ICE 协商自动进行（双方 trickle candidate 经 delegate.onLocalIceCandidate
///    + caller `addRemoteIceCandidate`）
/// 6. DC OPEN → delegate.onDataChannelStateChange(.open)
/// 7. caller `sendDataChannelMessage` 发数据
public final class GoogleWebRTCPeerConnectionTransport: NSObject, WebRTCPeerConnectionTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var peerConnection: RTCPeerConnection?
    private var dataChannel: RTCDataChannel?
    private weak var delegate: WebRTCPeerConnectionTransportDelegate?
    private var pcDelegate: PeerConnectionDelegateBridge?
    private var dcDelegate: DataChannelDelegateBridge?

    public override init() {
        super.init()
    }

    public func setupPeerConnection(
        config: RemoteWebRTCConfig,
        delegate: WebRTCPeerConnectionTransportDelegate
    ) async throws {
        let factory = await WebRTCRuntime.shared.peerConnectionFactory()
        let rtcConfig = RTCConfiguration()
        rtcConfig.iceServers = config.iceServers.map { srv in
            RTCIceServer(urlStrings: srv.urls, username: srv.username, credential: srv.credential)
        }
        rtcConfig.sdpSemantics = .unifiedPlan
        rtcConfig.continualGatheringPolicy = .gatherContinually

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
        )

        let pcDelegate = PeerConnectionDelegateBridge(forward: delegate)
        guard let pc = factory.peerConnection(with: rtcConfig, constraints: constraints, delegate: pcDelegate) else {
            throw RemoteWebRTCError.runtimeNotInitialized
        }

        let dcConfig = RTCDataChannelConfiguration()
        dcConfig.isOrdered = true
        guard let dc = pc.dataChannel(forLabel: "chainlesschain-terminal", configuration: dcConfig) else {
            pc.close()
            throw RemoteWebRTCError.offerFailed("dataChannel(forLabel:) returned nil")
        }
        let dcDelegate = DataChannelDelegateBridge(forward: delegate)
        dc.delegate = dcDelegate

        lock.lock()
        self.peerConnection = pc
        self.dataChannel = dc
        self.delegate = delegate
        self.pcDelegate = pcDelegate
        self.dcDelegate = dcDelegate
        lock.unlock()
    }

    public func createOffer() async throws -> SdpDescription {
        lock.lock()
        let pc = self.peerConnection
        lock.unlock()
        guard let pc = pc else { throw RemoteWebRTCError.offerFailed("peerConnection not initialized") }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<SdpDescription, Error>) in
            pc.offer(for: constraints) { sdp, error in
                if let error = error {
                    cont.resume(throwing: RemoteWebRTCError.offerFailed(error.localizedDescription))
                    return
                }
                guard let sdp = sdp else {
                    cont.resume(throwing: RemoteWebRTCError.offerFailed("offer returned nil"))
                    return
                }
                pc.setLocalDescription(sdp) { setError in
                    if let setError = setError {
                        cont.resume(throwing: RemoteWebRTCError.offerFailed("setLocalDescription failed: \(setError.localizedDescription)"))
                        return
                    }
                    cont.resume(returning: SdpDescription(type: .offer, sdp: sdp.sdp))
                }
            }
        }
    }

    public func setRemoteAnswer(_ answer: SdpDescription) async throws {
        lock.lock()
        let pc = self.peerConnection
        lock.unlock()
        guard let pc = pc else { throw RemoteWebRTCError.invalidAnswer("peerConnection not initialized") }
        let rtcAnswer = RTCSessionDescription(type: .answer, sdp: answer.sdp)
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            pc.setRemoteDescription(rtcAnswer) { error in
                if let error = error {
                    cont.resume(throwing: RemoteWebRTCError.invalidAnswer(error.localizedDescription))
                } else {
                    cont.resume()
                }
            }
        }
    }

    public func addRemoteIceCandidate(_ candidate: OutboundIceCandidate) async throws {
        lock.lock()
        let pc = self.peerConnection
        lock.unlock()
        guard let pc = pc else { throw RemoteWebRTCError.iceFailed }
        let rtcCandidate = RTCIceCandidate(
            sdp: candidate.sdp,
            sdpMLineIndex: candidate.sdpMLineIndex,
            sdpMid: candidate.sdpMid
        )
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            pc.add(rtcCandidate) { error in
                if let error = error {
                    cont.resume(throwing: RemoteWebRTCError.iceFailed)
                    _ = error  // logged internally by SDK
                } else {
                    cont.resume()
                }
            }
        }
    }

    public func sendDataChannelMessage(_ text: String) async throws {
        lock.lock()
        let dc = self.dataChannel
        lock.unlock()
        guard let dc = dc, dc.readyState == .open else {
            throw RemoteWebRTCError.dataChannelNotOpen
        }
        let buffer = RTCDataBuffer(data: Data(text.utf8), isBinary: false)
        if !dc.sendData(buffer) {
            throw RemoteWebRTCError.dataChannelNotOpen
        }
    }

    public func close() async {
        lock.lock()
        let pc = self.peerConnection
        let dc = self.dataChannel
        self.peerConnection = nil
        self.dataChannel = nil
        self.delegate = nil
        self.pcDelegate = nil
        self.dcDelegate = nil
        lock.unlock()
        dc?.close()
        pc?.close()
    }
}

// MARK: - Delegate bridges (Google SDK delegate → Sendable async)

/// 桥接 `RTCPeerConnectionDelegate` 到 Sendable async delegate。
private final class PeerConnectionDelegateBridge: NSObject, RTCPeerConnectionDelegate {
    weak var forward: WebRTCPeerConnectionTransportDelegate?

    init(forward: WebRTCPeerConnectionTransportDelegate) {
        self.forward = forward
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        let mirrored = RTCIceConnectionStateMirror(newState)
        Task { [weak forward] in
            await forward?.onIceConnectionState(mirrored)
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        let outbound = OutboundIceCandidate(
            sdp: candidate.sdp,
            sdpMid: candidate.sdpMid ?? "0",
            sdpMLineIndex: candidate.sdpMLineIndex
        )
        Task { [weak forward] in
            await forward?.onLocalIceCandidate(outbound)
        }
    }
}

/// 桥接 `RTCDataChannelDelegate` 到 Sendable async delegate。
private final class DataChannelDelegateBridge: NSObject, RTCDataChannelDelegate {
    weak var forward: WebRTCPeerConnectionTransportDelegate?

    init(forward: WebRTCPeerConnectionTransportDelegate) {
        self.forward = forward
    }

    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let mirrored: DataChannelReadyState
        switch dataChannel.readyState {
        case .connecting: mirrored = .connecting
        case .open: mirrored = .open
        case .closing: mirrored = .closing
        case .closed: mirrored = .closed
        @unknown default: mirrored = .closed
        }
        Task { [weak forward] in
            await forward?.onDataChannelStateChange(mirrored)
        }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard !buffer.isBinary, let text = String(data: buffer.data, encoding: .utf8) else {
            return
        }
        Task { [weak forward] in
            await forward?.onDataChannelMessage(text)
        }
    }
}
