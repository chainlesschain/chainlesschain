import XCTest
@testable import CoreP2P

/// Phase 2.2 — `TerminalRpcClient` 双路径 routing + LRU dedup + 6 method
/// wrapper 测试。
///
/// 通过 closures 注入 fake DC + signaling sender + readiness provider，
/// 不需真 `RemoteWebRTCClient`。响应通过测试自己驱动 inboundStream 模拟。
final class TerminalRpcClientTests: XCTestCase {

    // MARK: - Test harness

    /// 测试用 inbound stream + writer pair。
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

    /// Fake transport state。所有 send 行为可配置。
    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock()
        var dcSentMessages: [String] = []
        var signalingSentMessages: [(pcPeerId: String, json: String)] = []
        var dcReady: Bool = true

        // 失败注入
        var dcSendError: Error?
        var signalingSendError: Error?

        func reset() {
            lock.lock(); defer { lock.unlock() }
            dcSentMessages.removeAll()
            signalingSentMessages.removeAll()
        }
    }

    private func makeClient(
        transport: FakeTransport,
        inbound: InboundChannel,
        flags: PlanA1FeatureFlags? = nil,
        responseTimeoutSeconds: UInt64 = 2,
        uuidGen: @Sendable @escaping () -> String = { UUID().uuidString }
    ) -> TerminalRpcClient {
        let resolvedFlags = flags ?? PlanA1FeatureFlags(
            defaults: UserDefaults(suiteName: "test-rpc-\(UUID().uuidString)")!
        )
        return TerminalRpcClient(
            dataChannelSender: { text in
                if let err = transport.dcSendError { throw err }
                transport.lock.lock()
                transport.dcSentMessages.append(text)
                transport.lock.unlock()
            },
            signalingSender: { pcPeerId, json in
                if let err = transport.signalingSendError { throw err }
                transport.lock.lock()
                transport.signalingSentMessages.append((pcPeerId, json))
                transport.lock.unlock()
            },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: resolvedFlags,
            responseTimeoutSeconds: responseTimeoutSeconds,
            uuidGen: uuidGen
        )
    }

    private func extractReqId(fromOutbound json: String) throws -> String {
        guard let data = json.data(using: .utf8),
              let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payload = dict["payload"] as? [String: Any],
              let id = payload["id"] as? String else {
            throw NSError(domain: "extractReqId", code: 0)
        }
        return id
    }

    private func makeResponseRaw(reqId: String, result: [String: Any]) throws -> String {
        let envelope: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        let data = try JSONSerialization.data(withJSONObject: envelope)
        return String(data: data, encoding: .utf8)!
    }

    // MARK: - Transport routing (4 combos)

    func testInvokeDataChannelReadyAndFlagOnUsesDC() async throws {
        let transport = FakeTransport(); transport.dcReady = true
        let inbound = InboundChannel()
        let flags = PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "t-\(UUID())")!)
        flags.preferDataChannel = true
        let client = makeClient(transport: transport, inbound: inbound, flags: flags)
        await client.start()

        let task = Task { try await client.invoke(pcPeerId: "pc-1", method: "terminal.list", params: [:]) }
        try await Task.sleep(nanoseconds: 50_000_000)

        // 抓出 reqId
        XCTAssertEqual(transport.dcSentMessages.count, 1)
        XCTAssertEqual(transport.signalingSentMessages.count, 0)
        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])

        // 模拟响应
        inbound.send(try makeResponseRaw(reqId: reqId, result: ["sessions": []]))
        let resp = try await task.value
        if case .success = resp { /* ok */ } else { XCTFail("expected success") }
    }

    func testInvokeDataChannelReadyButFlagOffUsesSignaling() async throws {
        let transport = FakeTransport(); transport.dcReady = true
        let inbound = InboundChannel()
        let flags = PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "t-\(UUID())")!)
        flags.preferDataChannel = false  // <-- key
        let client = makeClient(transport: transport, inbound: inbound, flags: flags)
        await client.start()

        let task = Task { try await client.invoke(pcPeerId: "pc-x", method: "terminal.list", params: [:]) }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(transport.dcSentMessages.count, 0)
        XCTAssertEqual(transport.signalingSentMessages.count, 1)
        XCTAssertEqual(transport.signalingSentMessages[0].pcPeerId, "pc-x")
        let reqId = try extractReqId(fromOutbound: transport.signalingSentMessages[0].json)
        inbound.send(try makeResponseRaw(reqId: reqId, result: ["sessions": []]))
        _ = try await task.value
    }

    func testInvokeDataChannelClosedUsesSignaling() async throws {
        let transport = FakeTransport(); transport.dcReady = false
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.invoke(pcPeerId: "pc-c", method: "terminal.list", params: [:]) }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(transport.dcSentMessages.count, 0)
        XCTAssertEqual(transport.signalingSentMessages.count, 1)
        let reqId = try extractReqId(fromOutbound: transport.signalingSentMessages[0].json)
        inbound.send(try makeResponseRaw(reqId: reqId, result: ["sessions": []]))
        _ = try await task.value
    }

    func testInvokeDataChannelThrowsFallsBackToSignaling() async throws {
        let transport = FakeTransport(); transport.dcReady = true
        struct DCErr: Error {}
        transport.dcSendError = DCErr()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.invoke(pcPeerId: "pc-fb", method: "terminal.list", params: [:]) }
        try await Task.sleep(nanoseconds: 50_000_000)

        // DC 抛错，应触发 signaling fallback
        XCTAssertEqual(transport.signalingSentMessages.count, 1)
        let reqId = try extractReqId(fromOutbound: transport.signalingSentMessages[0].json)
        inbound.send(try makeResponseRaw(reqId: reqId, result: ["sessions": []]))
        _ = try await task.value
    }

    func testInvokeDataChannelThrowsAndFallbackDisabled() async throws {
        let transport = FakeTransport(); transport.dcReady = true
        struct DCErr: Error {}
        transport.dcSendError = DCErr()
        let inbound = InboundChannel()
        let flags = PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "t-\(UUID())")!)
        flags.fallbackOnDcFailure = false
        let client = makeClient(transport: transport, inbound: inbound, flags: flags)
        await client.start()

        do {
            _ = try await client.invoke(pcPeerId: "pc-x", method: "terminal.list", params: [:])
            XCTFail("expected throw")
        } catch TerminalRpcError.allTransportsFailed {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
        XCTAssertEqual(transport.signalingSentMessages.count, 0, "fallback disabled — signaling should not be tried")
    }

    // MARK: - Response handling

    func testResponseErrorTransitsToFailureCase() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.invoke(pcPeerId: "pc", method: "terminal.create", params: ["shell": "/x"]) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])

        let raw = """
        {"type":"chainlesschain:command:response","payload":{"id":"\(reqId)","error":"shell not found"}}
        """
        inbound.send(raw)
        let resp = try await task.value
        if case .failure(_, let msg) = resp {
            XCTAssertEqual(msg, "shell not found")
        } else { XCTFail("expected failure") }
    }

    func testResponseTimeoutThrowsTimeout() async {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound, responseTimeoutSeconds: 1)
        await client.start()

        do {
            _ = try await client.invoke(pcPeerId: "pc", method: "terminal.list", params: [:])
            XCTFail("expected timeout")
        } catch TerminalRpcError.timeout {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    // MARK: - LRU dedup

    func testStdoutDedupSamesidSeqOnce() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        // 起 collector
        let collected = Task<[StdoutEvent], Never> {
            var v: [StdoutEvent] = []
            for await e in await client.stdoutEvents {
                v.append(e)
                if v.count >= 2 { return v }
            }
            return v
        }

        let raw = #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s1","data":"hi","seq":7}}"#
        inbound.send(raw)
        inbound.send(raw)  // 重复
        let raw2 = #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s1","data":"world","seq":8}}"#
        inbound.send(raw2)

        try await Task.sleep(nanoseconds: 200_000_000)
        collected.cancel()
        let result = await collected.value
        XCTAssertEqual(result.count, 2, "duplicate (s1, 7) should be deduped")
        XCTAssertEqual(result[0].seq, 7)
        XCTAssertEqual(result[1].seq, 8)
    }

    func testExitDedupSamesidOnce() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let collected = Task<Int, Never> {
            var count = 0
            for await _ in await client.exitEvents {
                count += 1
                if count >= 2 { return count }
            }
            return count
        }

        let raw = #"{"type":"chainlesschain:event","payload":{"event":"terminal.exit","sessionId":"s9","exitCode":0,"signal":null}}"#
        inbound.send(raw)
        inbound.send(raw)  // 重复
        try await Task.sleep(nanoseconds: 200_000_000)
        collected.cancel()
        let count = await collected.value
        XCTAssertEqual(count, 1)
    }

    // MARK: - Method wrappers (representative coverage)

    func testCreateMethodWrapper() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.create(pcPeerId: "pc", shell: "/bin/zsh", mobileDid: "did:cc:m") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])

        // 验证 outbound 含 mobileDid auth
        let outDict = try JSONSerialization.jsonObject(with: Data(transport.dcSentMessages[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        XCTAssertEqual((payload["auth"] as? [String: Any])?["mobileDid"] as? String, "did:cc:m")
        XCTAssertEqual(payload["method"] as? String, "terminal.create")

        let raw = try makeResponseRaw(reqId: reqId, result: [
            "sessionId": "s-1", "pid": 4321, "shell": "/bin/zsh", "createdAt": 1700000000000
        ])
        inbound.send(raw)
        let cs = try await task.value
        XCTAssertEqual(cs.sessionId, "s-1")
        XCTAssertEqual(cs.pid, 4321)
    }

    func testListMethodWrapper() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.list(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])

        let raw = try makeResponseRaw(reqId: reqId, result: [
            "sessions": [
                ["id": "a", "shell": "/bin/zsh", "cwd": "/h", "alive": true, "lastSeq": 5]
            ]
        ])
        inbound.send(raw)
        let list = try await task.value
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0].id, "a")
    }

    func testStdinMethodWrapper() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.stdin(pcPeerId: "pc", sessionId: "s1", data: "ls\n") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])
        inbound.send(try makeResponseRaw(reqId: reqId, result: ["ok": true]))
        try await task.value
    }

    func testStdinThrowsWhenOkFalse() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.stdin(pcPeerId: "pc", sessionId: "s1", data: "x") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])
        inbound.send(try makeResponseRaw(reqId: reqId, result: ["ok": false]))

        do {
            try await task.value
            XCTFail("expected throw")
        } catch TerminalRpcError.malformedResult {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testResizeMethodWrapper() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.resize(pcPeerId: "pc", sessionId: "s1", cols: 80, rows: 24) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])
        inbound.send(try makeResponseRaw(reqId: reqId, result: ["ok": true]))
        try await task.value
    }

    func testCloseMethodWrapper() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.close(pcPeerId: "pc", sessionId: "s1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])
        inbound.send(try makeResponseRaw(reqId: reqId, result: ["ok": true]))
        try await task.value
    }

    func testHistoryMethodWrapper() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound)
        await client.start()

        let task = Task { try await client.history(pcPeerId: "pc", sessionId: "s1", fromSeq: 10) }
        try await Task.sleep(nanoseconds: 50_000_000)
        // 验证 fromSeq 出现在 params
        let outDict = try JSONSerialization.jsonObject(with: Data(transport.dcSentMessages[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["sessionId"] as? String, "s1")
        XCTAssertNotNil(params["fromSeq"])

        let reqId = try extractReqId(fromOutbound: transport.dcSentMessages[0])
        inbound.send(try makeResponseRaw(reqId: reqId, result: [
            "chunks": [["seq": 10, "data": "log line"]],
            "truncated": false
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.chunks.count, 1)
        XCTAssertFalse(resp.truncated)
    }

    // MARK: - stop()

    func testStopFailsAllPending() async throws {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = makeClient(transport: transport, inbound: inbound, responseTimeoutSeconds: 5)
        await client.start()

        let task = Task { try await client.invoke(pcPeerId: "pc", method: "terminal.list", params: [:]) }
        try await Task.sleep(nanoseconds: 50_000_000)
        await client.stop()

        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch TerminalRpcError.allTransportsFailed {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }
}
