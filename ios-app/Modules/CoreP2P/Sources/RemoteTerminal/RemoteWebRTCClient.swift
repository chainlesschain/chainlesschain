import Foundation

/// 远程桌面终端 WebRTC 客户端 — Phase 2.1。
///
/// 镜像 Android `app/src/main/java/.../remote/webrtc/WebRTCClient.kt` 1:1，
/// 5 步 handshake：(1) signaling connect → (2) register → (3) createPC + DC →
/// (4) createOffer + send → (5) waitForAnswer + setRemoteDescription。
/// ICE candidates trickle 经 signaling forward 双向交换；DC 双方都 OPEN 后
/// state 进 `.ready` 才允许 send。
///
/// **关键不变量**（继承 Phase 1 echo-loop 防御 + Plan A.1 §3.7 不复用
/// :core-p2p DataChannelTransport 决定）：
/// - `localPeerId` 仅 `connect()` 入参传入，**不暴露 setter**
/// - `pcPeerId` 是 desktop target，所有 offer/ICE 经
///   `signalingGate.sendForwardedMessage(toPeerId: pcPeerId, ...)` 转发；
///   **禁止**改写 Phase 1 SignalClient 的 currentPeerId（grep
///   `currentPeerId\s*=` 必须只命中 register）
/// - `inboundMessages` AsyncStream 同时承接 DC 入站 + signaling forward 入站
///   （避开 Android Trap 1 单 listener 覆盖问题）
///
/// **Why actor**：DC delegate 回调跨任意线程；actor 串行化所有内部状态。
public actor RemoteWebRTCClient {

    // MARK: Dependencies

    private let signalingGate: PairingSignalingGate
    private let messageBus: PairingMessageBus
    private let transport: WebRTCPeerConnectionTransport
    private let iceServersProvider: @Sendable (String) async -> String?
    private let answerTimeoutSeconds: UInt64

    // MARK: State

    private var currentLocalPeerId: String?
    private var currentPcPeerId: String?
    private var pendingAnswer: CheckedContinuation<SdpDescription, Error>?

    private let stateContinuation: AsyncStream<RemoteWebRTCState>.Continuation
    private let dataChannelReadyContinuation: AsyncStream<Bool>.Continuation
    private let inboundContinuation: AsyncStream<String>.Continuation
    private let outboundIceContinuation: AsyncStream<OutboundIceCandidate>.Continuation

    /// State 流 — `.disconnected` → `.signalingConnected` → ... → `.ready` → `.failed`。
    public nonisolated let state: AsyncStream<RemoteWebRTCState>
    /// 派生流：state == .ready → true，其它 → false。
    public nonisolated let dataChannelReady: AsyncStream<Bool>
    /// DC 入站 + signaling 入站统一入口（与 Android `WebRTCClient.messages` 对齐）。
    public nonisolated let inboundMessages: AsyncStream<String>
    /// 本地 ICE candidate — caller 应消费此流，经 signaling 发给 desktop pcPeerId。
    public nonisolated let outboundIceCandidates: AsyncStream<OutboundIceCandidate>

    private(set) var currentState: RemoteWebRTCState = .disconnected

    // MARK: Init

    public init(
        signalingGate: PairingSignalingGate,
        messageBus: PairingMessageBus,
        transport: WebRTCPeerConnectionTransport,
        iceServersProvider: @escaping @Sendable (String) async -> String?,
        answerTimeoutSeconds: UInt64 = 30
    ) {
        self.signalingGate = signalingGate
        self.messageBus = messageBus
        self.transport = transport
        self.iceServersProvider = iceServersProvider
        self.answerTimeoutSeconds = answerTimeoutSeconds

        var stateLocal: AsyncStream<RemoteWebRTCState>.Continuation!
        self.state = AsyncStream(bufferingPolicy: .bufferingNewest(8)) { c in stateLocal = c }
        self.stateContinuation = stateLocal

        var dcLocal: AsyncStream<Bool>.Continuation!
        self.dataChannelReady = AsyncStream(bufferingPolicy: .bufferingNewest(8)) { c in dcLocal = c }
        self.dataChannelReadyContinuation = dcLocal

        var inLocal: AsyncStream<String>.Continuation!
        self.inboundMessages = AsyncStream(bufferingPolicy: .bufferingNewest(64)) { c in inLocal = c }
        self.inboundContinuation = inLocal

        var iceLocal: AsyncStream<OutboundIceCandidate>.Continuation!
        self.outboundIceCandidates = AsyncStream(bufferingPolicy: .bufferingNewest(64)) { c in iceLocal = c }
        self.outboundIceContinuation = iceLocal
    }

    // MARK: Public API

    /// 5 步 handshake 入口。idempotent — 已 ready 时是 no-op。
    ///
    /// - Parameter pcPeerId: desktop 的 peer-id（来自 Phase 1 PairedDesktop）
    /// - Parameter localPeerId: 本机 DID — **唯一 owner is 本方法**
    public func connect(pcPeerId: String, localPeerId: String) async throws {
        if currentState == .ready {
            return
        }
        currentLocalPeerId = localPeerId
        currentPcPeerId = pcPeerId

        do {
            // Step 1: signaling connect + register
            try await signalingGate.ensureRegistered(localPeerId: localPeerId)
            transit(to: .signalingConnected)
            transit(to: .registered)

            // Step 2: 拉 ICE servers from PairedDesktopsStore + setupPeerConnection
            let iceJson = await iceServersProvider(pcPeerId)
            let config = RemoteWebRTCConfig.parse(jsonString: iceJson)
            try await transport.setupPeerConnection(config: config, delegate: TransportDelegateProxy(client: self))

            // Step 3: createOffer
            transit(to: .creatingOffer)
            let offer = try await transport.createOffer()

            // Step 4: send offer via signaling
            try await sendSdpToPeer(sdp: offer, toPeerId: pcPeerId)
            transit(to: .waitingAnswer)

            // Step 5: wait for answer (caller must wire signaling-incoming → handleSignalingMessage)
            // 由 caller (TerminalRpcClient 或 Phase 2.5 wiring) 监听 PairingMessageBus
            // 等价物路径并把 answer 调进来。本方法这里 await 一个 continuation。
            let answer = try await waitForAnswer()
            try await transport.setRemoteAnswer(answer)
            transit(to: .iceConnecting)

            // 之后 DC OPEN 由 transport.delegate.onDataChannelStateChange 回调驱动
            // → handleDcStateChange 内 transit(.dataChannelOpen) → transit(.ready)。
        } catch {
            transit(to: .failed(reason: (error as NSError).localizedDescription))
            throw error
        }
    }

    /// 主动 disconnect — 清所有状态 + close transport。
    public func disconnect() async {
        await transport.close()
        currentLocalPeerId = nil
        currentPcPeerId = nil
        pendingAnswer?.resume(throwing: RemoteWebRTCError.dataChannelClosed)
        pendingAnswer = nil
        transit(to: .disconnected)
    }

    /// 经 DC 发文本 — 状态非 .ready 时抛 [RemoteWebRTCError.dataChannelNotOpen]，
    /// 让 [TerminalRpcClient] fallback 到 signaling 路径（design doc §3.4）。
    public func sendMessage(_ text: String) async throws {
        if currentState != .ready {
            throw RemoteWebRTCError.dataChannelNotOpen
        }
        try await transport.sendDataChannelMessage(text)
    }

    /// 是否有 pending answer continuation — 诊断用 + 单测验泄漏。
    public func hasPendingAnswer() -> Bool {
        pendingAnswer != nil
    }

    /// caller 收到 desktop 经 signaling 发回的 answer SDP 时调本方法。
    public func handleAnswerFromSignaling(_ answer: SdpDescription) {
        guard let cont = pendingAnswer else { return }
        pendingAnswer = nil
        cont.resume(returning: answer)
    }

    /// caller 收到 desktop 经 signaling 发的 ICE candidate 时调本方法。
    public func handleRemoteIceCandidate(_ candidate: OutboundIceCandidate) async throws {
        try await transport.addRemoteIceCandidate(candidate)
    }

    /// caller 收到 signaling forward 的 chainlesschain:* 业务 envelope 时
    /// 转发到 inboundMessages — 让 TerminalRpcClient 双路监听同一 stream。
    public func emitInboundFromSignaling(_ raw: String) {
        inboundContinuation.yield(raw)
    }

    // MARK: Private

    private func transit(to newState: RemoteWebRTCState) {
        currentState = newState
        stateContinuation.yield(newState)
        dataChannelReadyContinuation.yield(newState == .ready)
    }

    private func waitForAnswer() async throws -> SdpDescription {
        // 用 race pattern：waitForContinuation vs Task.sleep timeout
        do {
            return try await withThrowingTaskGroup(of: SdpDescription.self) { group in
                group.addTask { [self] in
                    try await withCheckedThrowingContinuation { cont in
                        Task { await self.setPendingAnswer(cont) }
                    }
                }
                group.addTask { [self] in
                    try await Task.sleep(nanoseconds: self.answerTimeoutSeconds * 1_000_000_000)
                    throw RemoteWebRTCError.answerTimeout
                }
                guard let result = try await group.next() else {
                    throw RemoteWebRTCError.answerTimeout
                }
                group.cancelAll()
                return result
            }
        } catch {
            // Continuation 泄漏防御 — timeout 路径不会自动 resume pendingAnswer；
            // 手动 resume 错误并清状态，下次 connect 才能正常 register 新 continuation
            if let cont = pendingAnswer {
                pendingAnswer = nil
                cont.resume(throwing: error)
            }
            throw error
        }
    }

    private func setPendingAnswer(_ cont: CheckedContinuation<SdpDescription, Error>) {
        pendingAnswer = cont
    }

    private func sendSdpToPeer(sdp: SdpDescription, toPeerId: String) async throws {
        let envelope: [String: Any] = [
            "type": sdp.type.rawValue,
            sdp.type.rawValue: ["type": sdp.type.rawValue, "sdp": sdp.sdp]
        ]
        try await signalingGate.sendAck(toPeerId: toPeerId, ackPayload: envelope)
    }

    fileprivate func handleTransportLocalIce(_ candidate: OutboundIceCandidate) async {
        // 1) 发出 outboundIceCandidates 让 caller wire 到 signaling
        outboundIceContinuation.yield(candidate)
        // 2) 同步主动 forward 也送一份（caller 不连 stream 时仍能传给 desktop）
        guard let pcPeerId = currentPcPeerId else { return }
        let envelope: [String: Any] = [
            "type": "ice-candidate",
            "candidate": [
                "candidate": candidate.sdp,
                "sdpMid": candidate.sdpMid,
                "sdpMLineIndex": candidate.sdpMLineIndex
            ]
        ]
        _ = try? await signalingGate.sendAck(toPeerId: pcPeerId, ackPayload: envelope)
    }

    fileprivate func handleTransportIceState(_ state: RTCIceConnectionStateMirror) {
        switch state {
        case .connected, .completed:
            // ICE 通了；DC 是否 OPEN 由 dc.delegate.onDataChannelStateChange 决定
            // 此时 currentState 可能是 .iceConnecting 或更后；不强转
            break
        case .failed:
            transit(to: .failed(reason: "ICE failed"))
        case .disconnected:
            // 暂不 transit — 短期 disconnect 可能自动恢复（reconnecting）
            break
        case .closed:
            transit(to: .disconnected)
        default:
            break
        }
    }

    fileprivate func handleTransportDcStateChange(_ state: DataChannelReadyState) {
        switch state {
        case .open:
            transit(to: .dataChannelOpen)
            // Plan A.1 简化：DC OPEN 即 ready；与 Android `setupDataChannel.onStateChange`
            // 对齐（无额外 handshake 步骤）。
            transit(to: .ready)
        case .closing, .closed:
            if currentState == .ready || currentState == .dataChannelOpen {
                transit(to: .failed(reason: "DataChannel closed"))
            }
        case .connecting:
            break
        }
    }

    fileprivate func handleTransportDcMessage(_ text: String) {
        inboundContinuation.yield(text)
    }
}

/// 内部 delegate proxy — 把 transport 回调路由进 actor 隔离。
///
/// **Why nested**：避免 RemoteWebRTCClient 自己 conform 到 delegate
/// （那样会暴露公共 protocol 方法）。proxy 持 weak ref 到 actor，转发时跨入
/// actor isolation 用 `await client?.handleXxx`。
private final class TransportDelegateProxy: WebRTCPeerConnectionTransportDelegate, @unchecked Sendable {
    weak var client: RemoteWebRTCClient?

    init(client: RemoteWebRTCClient) {
        self.client = client
    }

    func onLocalIceCandidate(_ candidate: OutboundIceCandidate) async {
        await client?.handleTransportLocalIce(candidate)
    }

    func onIceConnectionState(_ state: RTCIceConnectionStateMirror) async {
        await client?.handleTransportIceState(state)
    }

    func onDataChannelStateChange(_ state: DataChannelReadyState) async {
        await client?.handleTransportDcStateChange(state)
    }

    func onDataChannelMessage(_ text: String) async {
        await client?.handleTransportDcMessage(text)
    }
}
