import Foundation
@testable import CoreP2P

/// In-memory fake `WebRTCPeerConnectionTransport` — 单测用。让
/// `RemoteWebRTCClient` 测试不需要真 Google WebRTC SDK / 真 PC / 真 DC。
///
/// 测试侧可：
/// - 读 `setupCalls / sentMessages` 验证 client 出向行为
/// - 调 `simulateIceState(_:)` / `simulateDcStateChange(_:)` /
///   `simulateDcMessage(_:)` / `simulateLocalIceCandidate(_:)` 模拟 transport
///   回调
/// - 注入 `setupErrorToThrow / offerErrorToThrow / sendErrorToThrow` 模拟错误
final class FakeWebRTCPeerConnectionTransport: WebRTCPeerConnectionTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _delegate: WebRTCPeerConnectionTransportDelegate?
    private var _setupCalls: [RemoteWebRTCConfig] = []
    private var _sentMessages: [String] = []
    private var _addedRemoteCandidates: [OutboundIceCandidate] = []
    private var _setRemoteAnswerCalls: [SdpDescription] = []
    private var _closeCount = 0

    var setupErrorToThrow: Error?
    var offerErrorToThrow: Error?
    var setRemoteAnswerErrorToThrow: Error?
    var sendErrorToThrow: Error?
    var addRemoteCandidateErrorToThrow: Error?

    /// 模拟 createOffer 返回的 SDP。默认 "fake-offer-sdp"。
    var offerSdpToReturn: String = "v=0\r\no=- fake offer sdp\r\n"

    var setupCalls: [RemoteWebRTCConfig] {
        lock.lock(); defer { lock.unlock() }
        return _setupCalls
    }
    var sentMessages: [String] {
        lock.lock(); defer { lock.unlock() }
        return _sentMessages
    }
    var addedRemoteCandidates: [OutboundIceCandidate] {
        lock.lock(); defer { lock.unlock() }
        return _addedRemoteCandidates
    }
    var setRemoteAnswerCalls: [SdpDescription] {
        lock.lock(); defer { lock.unlock() }
        return _setRemoteAnswerCalls
    }
    var closeCount: Int {
        lock.lock(); defer { lock.unlock() }
        return _closeCount
    }

    // MARK: WebRTCPeerConnectionTransport

    func setupPeerConnection(
        config: RemoteWebRTCConfig,
        delegate: WebRTCPeerConnectionTransportDelegate
    ) async throws {
        if let err = setupErrorToThrow { throw err }
        lock.lock()
        _setupCalls.append(config)
        _delegate = delegate
        lock.unlock()
    }

    func createOffer() async throws -> SdpDescription {
        if let err = offerErrorToThrow { throw err }
        return SdpDescription(type: .offer, sdp: offerSdpToReturn)
    }

    func setRemoteAnswer(_ answer: SdpDescription) async throws {
        if let err = setRemoteAnswerErrorToThrow { throw err }
        lock.lock()
        _setRemoteAnswerCalls.append(answer)
        lock.unlock()
    }

    func addRemoteIceCandidate(_ candidate: OutboundIceCandidate) async throws {
        if let err = addRemoteCandidateErrorToThrow { throw err }
        lock.lock()
        _addedRemoteCandidates.append(candidate)
        lock.unlock()
    }

    func sendDataChannelMessage(_ text: String) async throws {
        if let err = sendErrorToThrow { throw err }
        lock.lock()
        _sentMessages.append(text)
        lock.unlock()
    }

    func close() async {
        lock.lock()
        _closeCount += 1
        _delegate = nil
        lock.unlock()
    }

    // MARK: Test triggers

    func simulateLocalIceCandidate(_ candidate: OutboundIceCandidate) async {
        await _delegate?.onLocalIceCandidate(candidate)
    }

    func simulateIceState(_ state: RTCIceConnectionStateMirror) async {
        await _delegate?.onIceConnectionState(state)
    }

    func simulateDcStateChange(_ state: DataChannelReadyState) async {
        await _delegate?.onDataChannelStateChange(state)
    }

    func simulateDcMessage(_ text: String) async {
        await _delegate?.onDataChannelMessage(text)
    }
}
