import XCTest
@testable import CoreP2P

/// Phase 3.1 — `RemoteCommandClient` 测试。
///
/// 镜像 Phase 2 `TerminalRpcClientTests` 的 4 transport 组合 + response error
/// + timeout 路径。新增 events 流测试（非 response 入站 yield 到 events）。
final class RemoteCommandClientTests: XCTestCase {

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
        var dcSendError: Error?
        var sigSendError: Error?
    }

    private func makeClient(
        flags: PlanA1FeatureFlags? = nil,
        responseTimeoutSeconds: UInt64 = 2
    ) -> (RemoteCommandClient, FakeTransport, InboundChannel) {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let resolvedFlags = flags ?? PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "rcc-\(UUID())")!)
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                if let err = transport.dcSendError { throw err }
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { pid, json in
                if let err = transport.sigSendError { throw err }
                transport.lock.lock()
                transport.sigSent.append((pid, json))
                transport.lock.unlock()
            },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: resolvedFlags,
            responseTimeoutSeconds: responseTimeoutSeconds
        )
        return (client, transport, inbound)
    }

    private func reqId(from json: String) throws -> String {
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

    // MARK: - Tests

    func testInvokeViaDcWhenReadyAndFlagOn() async throws {
        let (client, transport, inbound) = makeClient()
        await client.start()
        let task = Task { try await client.invoke(pcPeerId: "pc", method: "clipboard.get", params: ["type": "text"]) }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(transport.dcSent.count, 1)
        XCTAssertEqual(transport.sigSent.count, 0)
        let id = try reqId(from: transport.dcSent[0])
        inbound.send(try responseRaw(reqId: id, result: ["content": "hello", "type": "text"]))
        let resp = try await task.value
        guard case .success(_, let json) = resp else { XCTFail(); return }
        XCTAssertTrue(json.contains("hello"))
    }

    func testInvokeViaSignalingWhenDcNotReady() async throws {
        let (client, transport, inbound) = makeClient()
        transport.dcReady = false
        await client.start()
        let task = Task { try await client.invoke(pcPeerId: "pc-x", method: "system.info", params: [:]) }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(transport.dcSent.count, 0)
        XCTAssertEqual(transport.sigSent.count, 1)
        let id = try reqId(from: transport.sigSent[0].1)
        inbound.send(try responseRaw(reqId: id, result: [:]))
        _ = try await task.value
    }

    func testInvokeFallsBackToSignalingWhenDcSendThrows() async throws {
        let (client, transport, inbound) = makeClient()
        struct E: Error {}
        transport.dcSendError = E()
        await client.start()
        let task = Task { try await client.invoke(pcPeerId: "pc-fb", method: "file.list", params: ["path": "/"]) }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(transport.sigSent.count, 1)
        let id = try reqId(from: transport.sigSent[0].1)
        inbound.send(try responseRaw(reqId: id, result: ["entries": []]))
        _ = try await task.value
    }

    func testInvokeRespectsFallbackDisabled() async {
        let suite = UserDefaults(suiteName: "rcc-flag-\(UUID())")!
        let flags = PlanA1FeatureFlags(defaults: suite)
        flags.fallbackOnDcFailure = false
        let (client, transport, _) = makeClient(flags: flags)
        struct E: Error {}
        transport.dcSendError = E()
        await client.start()

        do {
            _ = try await client.invoke(pcPeerId: "pc", method: "x", params: [:])
            XCTFail("expected throw")
        } catch TerminalRpcError.allTransportsFailed {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
        XCTAssertEqual(transport.sigSent.count, 0)
    }

    func testInvokeResponseErrorReturnsFailure() async throws {
        let (client, transport, inbound) = makeClient()
        await client.start()
        let task = Task { try await client.invoke(pcPeerId: "pc", method: "x", params: [:]) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(from: transport.dcSent[0])
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "error": "permission denied"]
        ]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
        let resp = try await task.value
        guard case .failure(_, let msg) = resp else { XCTFail(); return }
        XCTAssertEqual(msg, "permission denied")
    }

    func testInvokeTimeoutThrows() async {
        let (client, _, _) = makeClient(responseTimeoutSeconds: 1)
        await client.start()
        do {
            _ = try await client.invoke(pcPeerId: "pc", method: "slow.op", params: [:])
            XCTFail("expected timeout")
        } catch TerminalRpcError.timeout {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testEventsStreamReceivesNonResponseInbound() async throws {
        let (client, _, inbound) = makeClient()
        await client.start()
        let received = Task<String?, Never> {
            for await msg in await client.events {
                return msg
            }
            return nil
        }
        try await Task.sleep(nanoseconds: 30_000_000)
        let evt = #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s1","data":"x","seq":1}}"#
        inbound.send(evt)
        let result = await received.value
        XCTAssertNotNil(result)
        XCTAssertTrue(result?.contains("terminal.stdout") ?? false)
    }

    func testStopCancelsAllPending() async throws {
        let (client, _, _) = makeClient(responseTimeoutSeconds: 5)
        await client.start()
        let task = Task { try await client.invoke(pcPeerId: "pc", method: "x", params: [:]) }
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
