import XCTest
@testable import CoreP2P

/// `DefaultPairingSignalingGate` Phase 1.2 集成测试 — gate + FakeSignalClient
/// 验证 idempotent ensureRegistered / sendAck mobileDid 优先级 / reset 真清状态。
final class DefaultPairingSignalingGateTests: XCTestCase {

    // MARK: ensureRegistered

    func testEnsureRegisteredCallsConnectAndRegister() async throws {
        let fake = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        try await gate.ensureRegistered(localPeerId: "did:cc:abc")

        let connectCount = await fake.connectCount
        let registers = await fake.registerCalls
        XCTAssertEqual(connectCount, 1)
        XCTAssertEqual(registers.count, 1)
        XCTAssertEqual(registers[0].peerId, "did:cc:abc")
        XCTAssertEqual(registers[0].metadata["platform"], "ios")
        XCTAssertEqual(registers[0].metadata["role"], "pairing-listener")
    }

    func testEnsureRegisteredIsIdempotentForSamePeerId() async throws {
        let fake = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        try await gate.ensureRegistered(localPeerId: "did:cc:abc")
        try await gate.ensureRegistered(localPeerId: "did:cc:abc")
        try await gate.ensureRegistered(localPeerId: "did:cc:abc")

        let connectCount = await fake.connectCount
        let registers = await fake.registerCalls
        XCTAssertEqual(connectCount, 1, "ensureRegistered same peer-id should not reconnect")
        XCTAssertEqual(registers.count, 1, "ensureRegistered same peer-id should not re-register")
    }

    func testEnsureRegisteredDifferentPeerIdReregisters() async throws {
        let fake = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        try await gate.ensureRegistered(localPeerId: "did:cc:abc")
        try await gate.ensureRegistered(localPeerId: "did:cc:xyz")

        let registers = await fake.registerCalls
        XCTAssertEqual(registers.count, 2)
        XCTAssertEqual(registers[1].peerId, "did:cc:xyz")
    }

    func testEnsureRegisteredPropagatesConnectError() async {
        let fake = FakeSignalClient()
        struct E: Error {}
        await fake.setConnectError(E())
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        do {
            try await gate.ensureRegistered(localPeerId: "did:cc:abc")
            XCTFail("expected throw")
        } catch is E {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    // MARK: sendAck

    func testSendAckUsesMobileDidAsSelfPeerId() async throws {
        let fake = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        try await gate.sendAck(
            toPeerId: "pc-target",
            ackPayload: [
                "type": "pair-ack",
                "pairingCode": "123456",
                "mobileDid": "did:cc:my-iphone",
                "timestamp": 1_700_000_000_000
            ]
        )
        let registers = await fake.registerCalls
        let sent = await fake.sentForwardedMessages
        XCTAssertEqual(registers.count, 1)
        XCTAssertEqual(registers[0].peerId, "did:cc:my-iphone", "mobileDid 应作为 self peer-id register")
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0].toPeerId, "pc-target")
    }

    func testSendAckReusesRegisteredPeerIdWhenNoMobileDid() async throws {
        let fake = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        try await gate.ensureRegistered(localPeerId: "did:cc:pre-existing")
        try await gate.sendAck(
            toPeerId: "pc-target",
            ackPayload: ["type": "pair-ack", "pairingCode": "123456"]
            // 故意无 mobileDid
        )
        let registers = await fake.registerCalls
        XCTAssertEqual(registers.count, 1, "已 register 同 peer-id 不应再 register")
        XCTAssertEqual(registers[0].peerId, "did:cc:pre-existing")
    }

    func testSendAckFallsBackToTimestampPeerIdWhenNoDidAndNoPriorRegister() async throws {
        let fake = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        try await gate.sendAck(
            toPeerId: "pc-target",
            ackPayload: ["type": "pair-ack"]
        )
        let registers = await fake.registerCalls
        XCTAssertEqual(registers.count, 1)
        XCTAssertTrue(registers[0].peerId.hasPrefix("mobile-"),
                      "fallback peer-id 应为 mobile-<ts>")
    }

    func testSendAckEnvelopeIsExactPayload() async throws {
        let fake = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        try await gate.sendAck(
            toPeerId: "pc-x",
            ackPayload: ["type": "pair-ack", "pairingCode": "999000", "mobileDid": "did:cc:abc"]
        )
        let sent = await fake.sentForwardedMessages
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0].payload["type"] as? String, "pair-ack")
        XCTAssertEqual(sent[0].payload["pairingCode"] as? String, "999000")
    }

    // MARK: reset

    func testResetClearsRegisteredPeerIdAndDisconnects() async throws {
        let fake = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fake)
        try await gate.ensureRegistered(localPeerId: "did:cc:abc")
        await gate.reset()

        let disconnectCount = await fake.disconnectCount
        XCTAssertEqual(disconnectCount, 1)

        // reset 后再次 ensureRegistered 应走完整路径（connect + register）
        try await gate.ensureRegistered(localPeerId: "did:cc:abc")
        let connectCount = await fake.connectCount
        let registers = await fake.registerCalls
        XCTAssertEqual(connectCount, 2, "reset 后应重新 connect")
        XCTAssertEqual(registers.count, 2, "reset 后应重新 register")
    }
}

// MARK: - Fake SignalClient

actor FakeSignalClient: SignalClient {
    struct RegisterCall {
        let peerId: String
        let metadata: [String: String]
    }
    struct ForwardedCall {
        let toPeerId: String
        let payload: [String: Any]
    }

    private(set) var connectCount = 0
    private(set) var disconnectCount = 0
    private(set) var registerCalls: [RegisterCall] = []
    private(set) var sentForwardedMessages: [ForwardedCall] = []

    // Phase 2.4 — SignalClient.forwardedMessages 多订阅流；fake 让测试可手动 emit
    nonisolated let forwardedMessages: AsyncStream<String>
    private nonisolated let forwardedContinuation: AsyncStream<String>.Continuation

    init() {
        var local: AsyncStream<String>.Continuation!
        self.forwardedMessages = AsyncStream(bufferingPolicy: .bufferingNewest(64)) { c in local = c }
        self.forwardedContinuation = local
    }

    /// 测试触发：模拟 server 发来一条 forwarded message。
    nonisolated func simulateForwarded(_ raw: String) {
        forwardedContinuation.yield(raw)
    }

    private var connectErrorToThrow: Error?
    private var registerErrorToThrow: Error?
    private var sendErrorToThrow: Error?
    private var failNextSends: Int = 0

    func setConnectError(_ err: Error?) { connectErrorToThrow = err }
    func setRegisterError(_ err: Error?) { registerErrorToThrow = err }
    func setSendError(_ err: Error?) { sendErrorToThrow = err }
    /// 让接下来 N 次 sendForwardedMessage 抛 error（用于 LAN→relay fallback 测试）
    func setFailNextSends(_ n: Int) { failNextSends = n }

    func connect() async throws {
        if let err = connectErrorToThrow { throw err }
        connectCount += 1
    }

    func disconnect() async {
        disconnectCount += 1
    }

    func register(peerId: String, metadata: [String: String]) async throws {
        if let err = registerErrorToThrow { throw err }
        registerCalls.append(RegisterCall(peerId: peerId, metadata: metadata))
    }

    func sendForwardedMessage(toPeerId: String, payload: [String: Any]) async throws {
        if let err = sendErrorToThrow { throw err }
        if failNextSends > 0 {
            failNextSends -= 1
            // 仍记录这次调用（调用方用 sentForwardedMessages.count 验 LAN+relay 共调 2 次）
            sentForwardedMessages.append(ForwardedCall(toPeerId: toPeerId, payload: payload))
            struct E: Error {}
            throw E()
        }
        sentForwardedMessages.append(ForwardedCall(toPeerId: toPeerId, payload: payload))
    }
}
