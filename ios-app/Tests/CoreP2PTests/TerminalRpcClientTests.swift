import XCTest
@testable import CoreP2P

/// Phase 2.2 TerminalRpcClient 测试 — Phase 3.3 refactor 后**精简版**。
///
/// **Phase 3.3 改动**：
/// - 通用 invoke / transport routing 测试 → 已迁移到 RemoteCommandClientTests
/// - TerminalRpcClient 仅保留 6 method wrapper + LRU dedup + lifecycle 相关测试
/// - 测试 setup 改为：建 RemoteCommandClient (closures) → 包 TerminalRpcClient
///   (commandClient + eventStream)
final class TerminalRpcClientTests: XCTestCase {

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

    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock()
        var dcSent: [String] = []
        var sigSent: [(String, String)] = []
        var dcReady: Bool = true
    }

    private struct Setup {
        let rpc: TerminalRpcClient
        let commandClient: RemoteCommandClient
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup() async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let cmdClient = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { pid, json in
                transport.lock.lock()
                transport.sigSent.append((pid, json))
                transport.lock.unlock()
            },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "trpc-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await cmdClient.start()
        let rpc = TerminalRpcClient(commandClient: cmdClient, eventStream: cmdClient.events)
        await rpc.start()
        return Setup(rpc: rpc, commandClient: cmdClient, inbound: inbound, transport: transport)
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
        var payload: [String: Any] = ["event": "terminal.exit", "sessionId": sessionId]
        payload["exitCode"] = exitCode ?? NSNull()
        payload["signal"] = signal ?? NSNull()
        let env: [String: Any] = ["type": "chainlesschain:event", "payload": payload]
        return String(data: try! JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    // MARK: - Method wrappers (代表性覆盖：4 个 of 6)

    func testCreateMethodWrapper() async throws {
        let s = await makeSetup()
        let task = Task { try await s.rpc.create(pcPeerId: "pc", shell: "/bin/zsh", mobileDid: "did:cc:m") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let outbound = s.transport.dcSent[0]
        let dict = try JSONSerialization.jsonObject(with: outbound.data(using: .utf8)!) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "terminal.create")
        XCTAssertEqual((payload["auth"] as? [String: Any])?["mobileDid"] as? String, "did:cc:m")

        let reqId = try reqIdFrom(outbound)
        s.inbound.send(try responseRaw(reqId: reqId, result: [
            "sessionId": "s-1", "pid": 4321, "shell": "/bin/zsh", "createdAt": 1700000000000
        ]))
        let cs = try await task.value
        XCTAssertEqual(cs.sessionId, "s-1")
        XCTAssertEqual(cs.pid, 4321)
    }

    func testListMethodWrapper() async throws {
        let s = await makeSetup()
        let task = Task { try await s.rpc.list(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: reqId, result: [
            "sessions": [["id": "a", "shell": "/bin/zsh", "cwd": "/h", "alive": true, "lastSeq": 5]]
        ]))
        let list = try await task.value
        XCTAssertEqual(list.count, 1)
    }

    func testStdinThrowsWhenOkFalse() async throws {
        let s = await makeSetup()
        let task = Task { try await s.rpc.stdin(pcPeerId: "pc", sessionId: "s1", data: "x") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: reqId, result: ["ok": false]))
        do {
            try await task.value
            XCTFail("expected throw")
        } catch TerminalRpcError.malformedResult {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testHistoryMethodWrapper() async throws {
        let s = await makeSetup()
        let task = Task { try await s.rpc.history(pcPeerId: "pc", sessionId: "s1", fromSeq: 10) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let outDict = try JSONSerialization.jsonObject(with: Data(s.transport.dcSent[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["sessionId"] as? String, "s1")
        XCTAssertNotNil(params["fromSeq"])

        let reqId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: reqId, result: [
            "chunks": [["seq": 10, "data": "log line"]],
            "truncated": false
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.chunks.count, 1)
    }

    // MARK: - LRU dedup (Phase 2 关键功能保留测试)

    func testStdoutDedupSameSidSeqOnce() async throws {
        let s = await makeSetup()
        let collected = Task<[StdoutEvent], Never> {
            var v: [StdoutEvent] = []
            for await e in await s.rpc.stdoutEvents {
                v.append(e)
                if v.count >= 2 { return v }
            }
            return v
        }
        let raw = stdoutEventRaw(sessionId: "s1", data: "hi", seq: 7)
        s.inbound.send(raw)
        s.inbound.send(raw)  // 重复
        s.inbound.send(stdoutEventRaw(sessionId: "s1", data: "world", seq: 8))
        try await Task.sleep(nanoseconds: 200_000_000)
        collected.cancel()
        let result = await collected.value
        XCTAssertEqual(result.count, 2)
    }

    func testExitDedupSameSidOnce() async throws {
        let s = await makeSetup()
        let collected = Task<Int, Never> {
            var count = 0
            for await _ in await s.rpc.exitEvents {
                count += 1
                if count >= 2 { return count }
            }
            return count
        }
        let raw = exitEventRaw(sessionId: "s9", exitCode: 0, signal: nil)
        s.inbound.send(raw)
        s.inbound.send(raw)  // 重复
        try await Task.sleep(nanoseconds: 200_000_000)
        collected.cancel()
        XCTAssertEqual(await collected.value, 1)
    }

    // MARK: - Lifecycle

    func testStopCancelsInboundTask() async throws {
        let s = await makeSetup()
        await s.rpc.stop()
        // stop 后 send event 不应 emit
        let collected = Task<Int, Never> {
            var count = 0
            for await _ in await s.rpc.stdoutEvents {
                count += 1
            }
            return count
        }
        s.inbound.send(stdoutEventRaw(sessionId: "x", data: "after-stop", seq: 1))
        try await Task.sleep(nanoseconds: 100_000_000)
        collected.cancel()
        XCTAssertEqual(await collected.value, 0)
    }
}
