import XCTest
@testable import CoreP2P

/// Phase 2.5 — `TerminalSessionViewModel` 测试。
///
/// 通过自建 `TerminalRpcClient` (closures) + 模拟 inbound stream 验证
/// stdout/exit 过滤路由 + onStdin/onResize/onReady 调 RPC + close lifecycle。
@MainActor
final class TerminalSessionViewModelTests: XCTestCase {

    // MARK: - Test harness

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
        var dcSendError: Error?
    }

    private struct Setup {
        let vm: TerminalSessionViewModel
        let rpc: TerminalRpcClient
        let inbound: InboundChannel
        let transport: FakeRpcTransport
    }

    private func makeSetup(
        sessionId: String = "sess-A",
        pcPeerId: String = "pc-1",
        shell: String = "/bin/zsh",
        currentDID: String? = "did:cc:me"
    ) async -> Setup {
        let transport = FakeRpcTransport()
        let inbound = InboundChannel()
        let rpc = TerminalRpcClient(
            dataChannelSender: { text in
                if let err = transport.dcSendError { throw err }
                transport.lock.lock()
                transport.sentDC.append(text)
                transport.lock.unlock()
            },
            signalingSender: { pid, json in
                transport.lock.lock()
                transport.sentSignaling.append((pid, json))
                transport.lock.unlock()
            },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "tsvm-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await rpc.start()  // 起 inbound 监听
        let vm = TerminalSessionViewModel(
            pcPeerId: pcPeerId,
            sessionId: sessionId,
            shell: shell,
            terminalRpc: rpc,
            currentDIDProvider: { currentDID }
        )
        return Setup(vm: vm, rpc: rpc, inbound: inbound, transport: transport)
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    private func responseRaw(reqId: String, result: [String: Any]) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func stdoutEventRaw(sessionId: String, data: String, seq: Int64) -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:event",
            "payload": [
                "event": "terminal.stdout",
                "sessionId": sessionId,
                "data": data,
                "seq": seq
            ]
        ]
        return String(data: try! JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func exitEventRaw(sessionId: String, exitCode: Int?, signal: String?) -> String {
        var payload: [String: Any] = [
            "event": "terminal.exit",
            "sessionId": sessionId
        ]
        payload["exitCode"] = exitCode ?? NSNull()
        payload["signal"] = signal ?? NSNull()
        let env: [String: Any] = [
            "type": "chainlesschain:event",
            "payload": payload
        ]
        return String(data: try! JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    // MARK: - Tests: stdout filtering

    func testStdoutForOwnSessionAppendedToPending() async throws {
        let s = await makeSetup(sessionId: "sess-A")
        await s.vm.onAppear()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.inbound.send(stdoutEventRaw(sessionId: "sess-A", data: "hello\n", seq: 1))
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.vm.pendingStdout, ["hello\n"])
    }

    func testStdoutForOtherSessionIgnored() async throws {
        let s = await makeSetup(sessionId: "sess-A")
        await s.vm.onAppear()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.inbound.send(stdoutEventRaw(sessionId: "sess-OTHER", data: "noise", seq: 1))
        s.inbound.send(stdoutEventRaw(sessionId: "sess-A", data: "real", seq: 1))
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.vm.pendingStdout, ["real"], "should only see own sessionId events")
    }

    func testMultipleStdoutChunksAccumulate() async throws {
        let s = await makeSetup(sessionId: "sess-A")
        await s.vm.onAppear()
        try await Task.sleep(nanoseconds: 30_000_000)

        for i in 0..<5 {
            s.inbound.send(stdoutEventRaw(sessionId: "sess-A", data: "chunk\(i)", seq: Int64(i)))
        }
        try await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertEqual(s.vm.pendingStdout.count, 5)
        XCTAssertEqual(s.vm.pendingStdout.first, "chunk0")
        XCTAssertEqual(s.vm.pendingStdout.last, "chunk4")
    }

    // MARK: - Tests: exit filtering

    func testExitForOwnSessionUpdatesState() async throws {
        let s = await makeSetup(sessionId: "sess-A")
        await s.vm.onAppear()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.inbound.send(exitEventRaw(sessionId: "sess-A", exitCode: 0, signal: nil))
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertNotNil(s.vm.pendingExit)
        XCTAssertEqual(s.vm.pendingExit?.exitCode, 0)
        XCTAssertTrue(s.vm.hasExited)
    }

    func testExitForOtherSessionIgnored() async throws {
        let s = await makeSetup(sessionId: "sess-A")
        await s.vm.onAppear()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.inbound.send(exitEventRaw(sessionId: "sess-OTHER", exitCode: 1, signal: "SIGTERM"))
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertNil(s.vm.pendingExit)
        XCTAssertFalse(s.vm.hasExited)
    }

    // MARK: - Tests: outbound (stdin/resize)

    func testOnStdinSendsCorrectInvoke() async throws {
        let s = await makeSetup()
        let stdinTask = Task { await s.vm.onStdin(data: "ls\n") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(s.transport.sentDC.count, 1)
        let outbound = s.transport.sentDC[0]
        let dict = try JSONSerialization.jsonObject(with: outbound.data(using: .utf8)!) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "terminal.stdin")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["sessionId"] as? String, "sess-A")
        XCTAssertEqual(params["data"] as? String, "ls\n")

        let reqId = try reqIdFrom(outbound)
        s.inbound.send(try responseRaw(reqId: reqId, result: ["ok": true]))
        await stdinTask.value
        XCTAssertNil(s.vm.lastError)
    }

    func testOnReadyTriggersInitialResize() async throws {
        let s = await makeSetup()
        let readyTask = Task { await s.vm.onReady(cols: 80, rows: 24) }
        try await Task.sleep(nanoseconds: 50_000_000)

        let outbound = s.transport.sentDC[0]
        let dict = try JSONSerialization.jsonObject(with: outbound.data(using: .utf8)!) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "terminal.resize")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["cols"] as? Int, 80)
        XCTAssertEqual(params["rows"] as? Int, 24)

        let reqId = try reqIdFrom(outbound)
        s.inbound.send(try responseRaw(reqId: reqId, result: ["ok": true]))
        await readyTask.value
        XCTAssertTrue(s.vm.isReady)
    }

    func testOnResizeSendsResize() async throws {
        let s = await makeSetup()
        let resizeTask = Task { await s.vm.onResize(cols: 132, rows: 50) }
        try await Task.sleep(nanoseconds: 50_000_000)

        let outbound = s.transport.sentDC[0]
        let dict = try JSONSerialization.jsonObject(with: outbound.data(using: .utf8)!) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["cols"] as? Int, 132)

        let reqId = try reqIdFrom(outbound)
        s.inbound.send(try responseRaw(reqId: reqId, result: ["ok": true]))
        await resizeTask.value
    }

    func testOnResizeIgnoredWhenZeroDimensions() async throws {
        let s = await makeSetup()
        await s.vm.onResize(cols: 0, rows: 24)
        await s.vm.onResize(cols: 80, rows: 0)
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(s.transport.sentDC.count, 0, "should skip resize with cols=0 or rows=0")
    }

    // MARK: - Tests: error handling

    func testStdinErrorSetsLastError() async throws {
        let s = await makeSetup()
        let stdinTask = Task { await s.vm.onStdin(data: "x") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try reqIdFrom(s.transport.sentDC[0])
        let errEnv: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "error": "session not found"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: errEnv), encoding: .utf8)!)
        await stdinTask.value
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("session not found") ?? false)
    }

    func testStdinSkippedWhenSessionExited() async throws {
        let s = await makeSetup()
        await s.vm.onAppear()
        try await Task.sleep(nanoseconds: 30_000_000)

        // 触发 exit
        s.inbound.send(exitEventRaw(sessionId: "sess-A", exitCode: 0, signal: nil))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(s.vm.hasExited)

        // 之后调 stdin 应被 guard 跳过
        await s.vm.onStdin(data: "after exit")
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(s.transport.sentDC.count, 0, "stdin after exit should be no-op")
    }

    // MARK: - Tests: lifecycle

    func testCloseSendsTerminalClose() async throws {
        let s = await makeSetup()
        let closeTask = Task { await s.vm.close() }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(s.transport.sentDC.count, 1)
        let outbound = s.transport.sentDC[0]
        let dict = try JSONSerialization.jsonObject(with: outbound.data(using: .utf8)!) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "terminal.close")

        let reqId = try reqIdFrom(outbound)
        s.inbound.send(try responseRaw(reqId: reqId, result: ["ok": true]))
        await closeTask.value
    }

    func testClearPendingMethodsResetState() async throws {
        let s = await makeSetup(sessionId: "sess-A")
        await s.vm.onAppear()
        try await Task.sleep(nanoseconds: 30_000_000)
        s.inbound.send(stdoutEventRaw(sessionId: "sess-A", data: "x", seq: 1))
        s.inbound.send(exitEventRaw(sessionId: "sess-A", exitCode: 0, signal: nil))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertFalse(s.vm.pendingStdout.isEmpty)
        XCTAssertNotNil(s.vm.pendingExit)

        s.vm.clearPendingStdout()
        s.vm.clearPendingExit()
        XCTAssertTrue(s.vm.pendingStdout.isEmpty)
        XCTAssertNil(s.vm.pendingExit)
    }

    func testOnAppearIsIdempotent() async throws {
        let s = await makeSetup()
        await s.vm.onAppear()
        await s.vm.onAppear()
        await s.vm.onAppear()
        try await Task.sleep(nanoseconds: 30_000_000)

        // 发一条 stdout — 只应 emit 一次（不重复 subscribe）
        s.inbound.send(stdoutEventRaw(sessionId: "sess-A", data: "once", seq: 1))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.pendingStdout, ["once"])
    }
}
