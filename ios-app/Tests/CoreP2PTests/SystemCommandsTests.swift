import XCTest
@testable import CoreP2P

/// Phase 6.5 — `SystemCommands` typed wrapper 测试（5 method 桌面子集）。
final class SystemCommandsTests: XCTestCase {

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
        let lock = NSLock(); var dcSent: [String] = []; var dcReady: Bool = true
    }

    private struct Setup { let cmds: SystemCommands; let inbound: InboundChannel; let transport: FakeTransport }

    private func makeSetup() async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock(); transport.dcSent.append(text); transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "sy-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: SystemCommands(client: client), inbound: inbound, transport: transport)
    }

    private func reqId(_ json: String) throws -> String {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return ((d["payload"] as! [String: Any])["id"] as! String)
    }

    private func payload(_ json: String) throws -> [String: Any] {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return d["payload"] as! [String: Any]
    }

    private func respond(_ inbound: InboundChannel, reqId: String, result: [String: Any]) throws {
        let env: [String: Any] = ["type": "chainlesschain:command:response",
                                  "payload": ["id": reqId, "result": result]]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    func testExecCommandEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.execCommand(
                pcPeerId: "pc", command: "ls", args: ["-la"],
                cwd: "/tmp", timeoutMs: 5000
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "system.execCommand")
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["command"] as? String, "ls")
        XCTAssertEqual(params["args"] as? [String], ["-la"])
        XCTAssertEqual(params["timeoutMs"] as? Int, 5000)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "exitCode": 0,
            "stdout": "total 0\n", "stderr": "",
            "durationMs": 30, "timedOut": false
        ])
        let r = try await task.value
        XCTAssertEqual(r.exitCode, 0)
        XCTAssertTrue(r.stdout.contains("total"))
    }

    func testExecCommandEmptyThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.execCommand(pcPeerId: "pc", command: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testExecCommandInvalidTimeoutThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.execCommand(pcPeerId: "pc", command: "ls", timeoutMs: 0)
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetInfoDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getInfo(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "info": ["platform": "darwin", "arch": "arm64",
                     "hostname": "studio.local", "uptime": 86400]
        ])
        let r = try await task.value
        XCTAssertEqual(r.platform, "darwin")
        XCTAssertEqual(r.uptime, 86400)
    }

    func testGetStatusDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "cpuPercent": 25.5, "memoryPercent": 66.7, "diskPercent": 80.0
        ])
        let r = try await task.value
        XCTAssertEqual(r.cpuPercent, 25.5)
        XCTAssertEqual(r.diskPercent, 80.0)
    }

    func testNotifyEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.notify(
                pcPeerId: "pc", title: "Hello", message: "from iPhone", urgency: "normal"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["title"] as? String, "Hello")
        XCTAssertEqual(params["urgency"] as? String, "normal")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "notificationId": "N1", "message": "shown"
        ])
        let r = try await task.value
        XCTAssertEqual(r.notificationId, "N1")
    }

    func testNotifyEmptyTitleThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.notify(pcPeerId: "pc", title: "", message: "x")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testScreenshotDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.screenshot(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "data": "iVBOR...", "format": "png", "size": 1024
        ])
        let r = try await task.value
        XCTAssertEqual(r.format, "png")
        XCTAssertEqual(r.size, 1024)
    }
}
