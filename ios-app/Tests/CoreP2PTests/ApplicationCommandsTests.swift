import XCTest
@testable import CoreP2P

/// Phase 6.1B1 — `ApplicationCommands` (`app` namespace) typed wrapper 测试（8 method）。
final class ApplicationCommandsTests: XCTestCase {

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
        let cmds: ApplicationCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "app-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: ApplicationCommands(client: client), inbound: inbound, transport: transport)
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
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    // MARK: - listInstalled

    func testListInstalledEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listInstalled(pcPeerId: "pc", limit: 50, filter: "git") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "app.listInstalled")
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["limit"] as? Int, 50)
        XCTAssertEqual(params["filter"] as? String, "git")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2, "returned": 2,
            "apps": [
                ["name": "Git", "publisher": "Software Freedom", "version": "2.45.0", "size": 100_000_000],
                ["name": "GitHub Desktop", "publisher": "GitHub", "version": "3.4.0"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.apps.count, 2)
        XCTAssertEqual(r.apps[0].name, "Git")
        XCTAssertEqual(r.apps[0].size, 100_000_000)
    }

    func testListInstalledZeroLimitThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.listInstalled(pcPeerId: "pc", limit: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - listRunning

    func testListRunningDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listRunning(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2, "returned": 2,
            "apps": [
                ["name": "Chrome", "pid": 1234, "cpu": 5.3, "memory": 800_000_000],
                ["name": "Code", "pid": 5678, "cpu": 1.1, "memory": 400_000_000]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.apps[0].pid, 1234)
        XCTAssertEqual(r.apps[1].memory, 400_000_000)
    }

    // MARK: - getInfo

    func testGetInfoRequiresNameOrPath() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.getInfo(pcPeerId: "pc"); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetInfoWithNameEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getInfo(pcPeerId: "pc", name: "Chrome") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["name"] as? String, "Chrome")
        XCTAssertNil(params["path"])

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "app": ["name": "Chrome", "version": "130.0", "bundleId": "com.google.Chrome"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.bundleId, "com.google.Chrome")
    }

    // MARK: - launch

    func testLaunchEnvelopeWithArgs() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.launch(pcPeerId: "pc", name: "Notes", args: ["-new"])
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["args"] as? [String], ["-new"])
        XCTAssertEqual(params["name"] as? String, "Notes")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "name": "Notes", "message": "launched"
        ])
        let r = try await task.value
        XCTAssertEqual(r.name, "Notes")
    }

    func testLaunchRequiresNameOrPath() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.launch(pcPeerId: "pc"); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - close

    func testCloseWithForceEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.close(pcPeerId: "pc", pid: 1234, force: true) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["pid"] as? Int, 1234)
        XCTAssertEqual(params["force"] as? Bool, true)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "pid": 1234, "force": true, "message": "killed"
        ])
        let r = try await task.value
        XCTAssertEqual(r.pid, 1234)
        XCTAssertTrue(r.force)
    }

    // MARK: - focus / search / getRecent

    func testFocusByName() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.focus(pcPeerId: "pc", name: "Slack") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "name": "Slack", "message": "focused"
        ])
        let r = try await task.value
        XCTAssertEqual(r.name, "Slack")
    }

    func testSearchDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.search(pcPeerId: "pc", query: "term") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "query": "term", "total": 1,
            "apps": [["name": "Terminal"]]
        ])
        let r = try await task.value
        XCTAssertEqual(r.query, "term")
        XCTAssertEqual(r.apps[0].name, "Terminal")
    }

    func testSearchEmptyQueryThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.search(pcPeerId: "pc", query: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetRecentDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getRecent(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "apps": [
                ["name": "Xcode", "path": "/Applications/Xcode.app"],
                ["name": "Code"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.apps[0].name, "Xcode")
        XCTAssertEqual(r.apps[0].path, "/Applications/Xcode.app")
        XCTAssertNil(r.apps[1].path)
    }
}
