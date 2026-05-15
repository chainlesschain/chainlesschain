import XCTest
@testable import CoreP2P

/// Phase 2.4 — `TerminalListViewModel` 测试。
///
/// 用 `FakeWebRTCPeerConnectionTransport` + `FakeSignalClient` + 自建
/// `TerminalRpcClient` (closures fake-driven) 验证：handshake 触发 / sessions
/// 加载 / create / close / dataChannelReady 流转。
@MainActor
final class TerminalListViewModelTests: XCTestCase {

    // MARK: - Test harness

    /// 测试 inbound stream + writer pair（与 TerminalRpcClientTests 同模式）
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

    private func makeSetup(currentDID: String? = "did:cc:me", pcPeerId: String = "pc-1") -> Setup {
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
        let rpc = TerminalRpcClient(
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

    /// 抓 reqId from outbound DC envelope JSON
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
        let s = makeSetup()
        // 起 onAppear（async 内含等 answer 阻塞，所以放 Task）
        let appearTask = Task { await s.vm.onAppear() }
        try await Task.sleep(nanoseconds: 100_000_000)
        // 此时 webRTCClient.connect 在等 answer；触发 handshake state 进 .connecting
        XCTAssertEqual(s.vm.handshakeState, .connecting)

        // 模拟 answer 到达
        await s.webRTC.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "fake"))
        try await Task.sleep(nanoseconds: 50_000_000)

        // 触发 DC OPEN 让 dataChannelReady stream emit true
        await s.webRTCTransport.simulateDcStateChange(.open)
        try await Task.sleep(nanoseconds: 100_000_000)

        // 同时 refresh 调用了 list — 抓 outbound + 喂 response
        // (因为 dcReady=true 默认，list 走 DC)
        let outbound = s.rpcTransport.sentDC
        XCTAssertGreaterThanOrEqual(outbound.count, 1, "list should have been sent via DC")
        let reqId = try reqIdFrom(outbound[0])
        s.inbound.send(try responseRaw(reqId: reqId, result: ["sessions": []]))
        try await Task.sleep(nanoseconds: 100_000_000)

        await appearTask.value
        XCTAssertEqual(s.vm.handshakeState, .connectedDataChannel)
        XCTAssertEqual(s.vm.sessions.count, 0)
    }

    func testRefreshPopulatesSessions() async throws {
        let s = makeSetup()
        // 直接 refresh，跳过 handshake 复杂性
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
        let s = makeSetup()
        let createTask = Task { await s.vm.createSession(shell: "/bin/zsh") }
        try await Task.sleep(nanoseconds: 50_000_000)
        // 第一笔 outbound = create
        let createReqId = try reqIdFrom(s.rpcTransport.sentDC[0])
        s.inbound.send(try responseRaw(reqId: createReqId, result: [
            "sessionId": "new-1", "pid": 9999, "shell": "/bin/zsh", "createdAt": 1700000000000
        ]))
        try await Task.sleep(nanoseconds: 100_000_000)
        // 第二笔 outbound = refresh (list)
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
        let s = makeSetup()
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
        let s = makeSetup()
        let closeTask = Task { await s.vm.closeSession(sessionId: "sess-x") }
        try await Task.sleep(nanoseconds: 50_000_000)
        // 第一笔 = close
        let closeReqId = try reqIdFrom(s.rpcTransport.sentDC[0])
        s.inbound.send(try responseRaw(reqId: closeReqId, result: ["ok": true]))
        try await Task.sleep(nanoseconds: 100_000_000)
        // 第二笔 = refresh
        let listReqId = try reqIdFrom(s.rpcTransport.sentDC[1])
        s.inbound.send(try responseRaw(reqId: listReqId, result: ["sessions": []]))
        await closeTask.value
        XCTAssertEqual(s.vm.sessions.count, 0)
    }

    func testHandshakeFailsWhenNoDID() async {
        let s = makeSetup(currentDID: nil)
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
        let s = makeSetup()
        // 触发 handshake → state 经 dataChannelReady stream 转 .connectedDataChannel
        let appearTask = Task { await s.vm.onAppear() }
        try await Task.sleep(nanoseconds: 100_000_000)
        await s.webRTC.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "x"))
        try await Task.sleep(nanoseconds: 100_000_000)
        await s.webRTCTransport.simulateDcStateChange(.open)
        // 等 dataChannelReady 流 emit true
        try await Task.sleep(nanoseconds: 200_000_000)
        // 同时 list response
        if !s.rpcTransport.sentDC.isEmpty {
            let reqId = try reqIdFrom(s.rpcTransport.sentDC[0])
            s.inbound.send(try responseRaw(reqId: reqId, result: ["sessions": []]))
        }
        await appearTask.value
        XCTAssertEqual(s.vm.handshakeState, .connectedDataChannel)
    }
}
