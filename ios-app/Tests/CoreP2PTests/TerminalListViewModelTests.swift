import XCTest
@testable import CoreP2P

/// Phase 2.4 — `TerminalListViewModel` 测试。
/// **Phase 3.3 refactor 适配**：TerminalRpcClient 改 commandClient 注入。
@MainActor
final class TerminalListViewModelTests: XCTestCase {

    private final class InboundChannel {
        let stream: AsyncStream<String>
        let continuation: AsyncStream<String>.Continuation
        init() {
            var local: AsyncStream<String>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(64)) { c in local = c }
            self.continuation = local
        }
        func send(_ raw: String) { continuation.yield(raw) }
    }

    private final class FakeRpcTransport: @unchecked Sendable {
        let lock = NSLock()
        var sentDC: [String] = []
        var sentSignaling: [(String, String)] = []
        var dcReady = true
    }

    private struct Setup {
        let vm: TerminalListViewModel
        let webRTC: RemoteWebRTCClient
        let webRTCTransport: FakeWebRTCPeerConnectionTransport
        let rpc: TerminalRpcClient
        let inbound: InboundChannel
        let rpcTransport: FakeRpcTransport
        let signalClient: FakeSignalClient
    }

    private func makeSetup(currentDID: String? = "did:cc:me", pcPeerId: String = "pc-1") async -> Setup {
        let signalClient = FakeSignalClient()
        let signalingGate = DefaultPairingSignalingGate(signalClient: signalClient)
        let bus = DefaultPairingMessageBus()
        let webRTCTransport = FakeWebRTCPeerConnectionTransport()
        let webRTC = RemoteWebRTCClient(
            signalingGate: signalingGate,
            messageBus: bus,
            transport: webRTCTransport,
            iceServersProvider: { _ in nil },
            answerTimeoutSeconds: 5
        )
        let rpcTransport = FakeRpcTransport()
        let inbound = InboundChannel()
        // Phase 3.3 refactor: 先建 RemoteCommandClient (closures)，再包 TerminalRpcClient
        let commandClient = RemoteCommandClient(
            dataChannelSender: { text in
                rpcTransport.lock.lock()
                rpcTransport.sentDC.append(text)
                rpcTransport.lock.unlock()
            },
            signalingSender: { pid, json in
                rpcTransport.lock.lock()
                rpcTransport.sentSignaling.append((pid, json))
                rpcTransport.lock.unlock()
            },
            isDataChannelReady: { rpcTransport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "tlvm-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await commandClient.start()
        let rpc = TerminalRpcClient(commandClient: commandClient, eventStream: commandClient.events)
        let vm = TerminalListViewModel(
            pcPeerId: pcPeerId,
            webRTCClient: webRTC,
            terminalRpc: rpc,
            currentDIDProvider: { currentDID }
        )
        return Setup(vm: vm, webRTC: webRTC, webRTCTransport: webRTCTransport,
                     rpc: rpc, inbound: inbound, rpcTransport: rpcTransport,
                     signalClient: signalClient)
    }

    private func reqIdFrom(_ json: String) throws -> String {
        guard let data = json.data(using: .utf8),
              let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payload = dict["payload"] as? [String: Any],
              let id = payload["id"] as? String else {
            throw NSError(domain: "test", code: 0)
        }
        return id
    }

    private func responseRaw(reqId: String, result: [String: Any]) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    // MARK: - Tests

    func testOnAppearTriggersHandshakeAndRefresh() async throws {
        let s = await makeSetup()
        let appearTask = Task { await s.vm.onAppear() }
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.handshakeState, .connecting)

        await s.webRTC.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "fake"))
        try await Task.sleep(nanoseconds: 50_000_000)
        await s.webRTCTransport.simulateDcStateChange(.open)
        try await Task.sleep(nanoseconds: 100_000_000)

        let outbound = s.rpcTransport.sentDC
        XCTAssertGreaterThanOrEqual(outbound.count, 1)
        let reqId = try reqIdFrom(outbound[0])
        s.inbound.send(try responseRaw(reqId: reqId, result: ["sessions": []]))
        try await Task.sleep(nanoseconds: 100_000_000)

        await appearTask.value
        XCTAssertEqual(s.vm.handshakeState, .connectedDataChannel)
        XCTAssertEqual(s.vm.sessions.count, 0)
    }

    func testRefreshPopulatesSessions() async throws {
        let s = await makeSetup()
        let refreshTask = Task { await s.vm.refresh() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try reqIdFrom(s.rpcTransport.sentDC[0])
        s.inbound.send(try responseRaw(reqId: reqId, result: [
            "sessions": [
                ["id": "sess-1", "shell": "/bin/zsh", "cwd": "/home", "alive": true, "lastSeq": 5],
                ["id": "sess-2", "shell": "/bin/bash", "cwd": NSNull(), "alive": false, "lastSeq": 0]
            ]
        ]))
        await refreshTask.value
        XCTAssertEqual(s.vm.sessions.count, 2)
        XCTAssertEqual(s.vm.sessions[0].id, "sess-1")
        XCTAssertEqual(s.vm.sessions[1].alive, false)
        XCTAssertNil(s.vm.lastError)
    }

    func testCreateSessionReturnsCreatedAndRefreshes() async throws {
        let s = await makeSetup()
        let createTask = Task { await s.vm.createSession(shell: "/bin/zsh") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let createReqId = try reqIdFrom(s.rpcTransport.sentDC[0])
        s.inbound.send(try responseRaw(reqId: createReqId, result: [
            "sessionId": "new-1", "pid": 9999, "shell": "/bin/zsh", "createdAt": 1700000000000
        ]))
        try await Task.sleep(nanoseconds: 100_000_000)
        let listReqId = try reqIdFrom(s.rpcTransport.sentDC[1])
        s.inbound.send(try responseRaw(reqId: listReqId, result: [
            "sessions": [["id": "new-1", "shell": "/bin/zsh", "cwd": NSNull(), "alive": true, "lastSeq": 0]]
        ]))
        let created = await createTask.value
        XCTAssertNotNil(created)
        XCTAssertEqual(created?.sessionId, "new-1")
        XCTAssertEqual(s.vm.sessions.count, 1)
    }

    func testCreateFailureSetsLastError() async throws {
        let s = await makeSetup()
        let createTask = Task { await s.vm.createSession(shell: "/bin/x") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try reqIdFrom(s.rpcTransport.sentDC[0])
        let errEnv: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "error": "shell not found"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: errEnv), encoding: .utf8)!)
        let result = await createTask.value
        XCTAssertNil(result)
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("shell not found") ?? false)
    }

    func testCloseSessionFlow() async throws {
        let s = await makeSetup()
        let closeTask = Task { await s.vm.closeSession(sessionId: "sess-x") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let closeReqId = try reqIdFrom(s.rpcTransport.sentDC[0])
        s.inbound.send(try responseRaw(reqId: closeReqId, result: ["ok": true]))
        try await Task.sleep(nanoseconds: 100_000_000)
        let listReqId = try reqIdFrom(s.rpcTransport.sentDC[1])
        s.inbound.send(try responseRaw(reqId: listReqId, result: ["sessions": []]))
        await closeTask.value
        XCTAssertEqual(s.vm.sessions.count, 0)
    }

    func testHandshakeFailsWhenNoDID() async {
        let s = await makeSetup(currentDID: nil)
        let appearTask = Task { await s.vm.onAppear() }
        try? await Task.sleep(nanoseconds: 100_000_000)
        if case .failed(let reason) = s.vm.handshakeState {
            XCTAssertTrue(reason.contains("DID"))
        } else {
            XCTFail("expected .failed, got \(s.vm.handshakeState)")
        }
        appearTask.cancel()
    }

    func testDataChannelReadyStreamUpdatesHandshakeState() async throws {
        let s = await makeSetup()
        let appearTask = Task { await s.vm.onAppear() }
        try await Task.sleep(nanoseconds: 100_000_000)
        await s.webRTC.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "x"))
        try await Task.sleep(nanoseconds: 100_000_000)
        await s.webRTCTransport.simulateDcStateChange(.open)
        try await Task.sleep(nanoseconds: 200_000_000)
        if !s.rpcTransport.sentDC.isEmpty {
            let reqId = try reqIdFrom(s.rpcTransport.sentDC[0])
            s.inbound.send(try responseRaw(reqId: reqId, result: ["sessions": []]))
        }
        await appearTask.value
        XCTAssertEqual(s.vm.handshakeState, .connectedDataChannel)
    }
}
