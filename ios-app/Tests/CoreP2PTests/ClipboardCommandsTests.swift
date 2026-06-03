import XCTest
@testable import CoreP2P

/// Phase 3.3 — `ClipboardCommands` typed wrapper 测试。
final class ClipboardCommandsTests: XCTestCase {

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
        var dcReady: Bool = true
    }

    private struct Setup {
        let cmds: ClipboardCommands
        let client: RemoteCommandClient
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup() async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "cb-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        let cmds = ClipboardCommands(client: client)
        return Setup(cmds: cmds, client: client, inbound: inbound, transport: transport)
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

    // MARK: - get

    func testGetTextContentDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.get(pcPeerId: "pc", type: .text, mobileDid: "did:cc:m") }
        try await Task.sleep(nanoseconds: 50_000_000)

        // 验证 outbound 含正确 method + params
        let outDict = try JSONSerialization.jsonObject(with: Data(s.transport.dcSent[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "clipboard.get")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["type"] as? String, "text")

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "content": "hello world",
            "type": "text",
            "timestamp": 1700000000000
        ]))
        let content = try await task.value
        XCTAssertEqual(content.content, "hello world")
        XCTAssertEqual(content.type, .text)
        XCTAssertEqual(content.timestamp, 1700000000000)
    }

    func testGetWithMissingTimestampDefaultsNil() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.get(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["content": "x", "type": "text"]))
        let content = try await task.value
        XCTAssertNil(content.timestamp)
    }

    func testGetThrowsRemoteErrorOnFailure() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.get(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        let err: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "error": "permission denied"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: err), encoding: .utf8)!)

        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "permission denied")
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    // MARK: - set

    func testSetTextContentEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.set(pcPeerId: "pc", content: "send-me", type: .text) }
        try await Task.sleep(nanoseconds: 50_000_000)

        let outDict = try JSONSerialization.jsonObject(with: Data(s.transport.dcSent[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "clipboard.set")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["type"] as? String, "text")
        XCTAssertEqual(params["content"] as? String, "send-me")

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["ok": true, "bytesWritten": 7]))
        let resp = try await task.value
        XCTAssertTrue(resp.ok)
        XCTAssertEqual(resp.bytesWritten, 7)
    }

    func testSetEmptyContentThrowsInvalidArgument() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.set(pcPeerId: "pc", content: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }
}
