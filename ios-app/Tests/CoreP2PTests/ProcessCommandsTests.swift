import XCTest
@testable import CoreP2P

/// Phase 6.1B3 — `ProcessCommands` typed wrapper 测试（6 method）。
final class ProcessCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: ProcessCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "ps-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: ProcessCommands(client: client), inbound: inbound, transport: transport)
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

    func testListDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.list(pcPeerId: "pc", limit: 50, sortBy: "cpu") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["sortBy"] as? String, "cpu")
        XCTAssertEqual(params["limit"] as? Int, 50)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "processes": [
                ["pid": 1, "name": "init", "cpu": 0.1, "memory": 8_000_000, "user": "root"],
                ["pid": 100, "name": "kernel", "cpu": 0.5, "memory": 200_000_000]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.processes.count, 2)
        XCTAssertEqual(r.processes[0].name, "init")
        XCTAssertEqual(r.processes[1].memory, 200_000_000)
    }

    func testListZeroLimitThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.list(pcPeerId: "pc", limit: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetByPidDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.get(pcPeerId: "pc", pid: 1234) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "process": ["pid": 1234, "name": "chrome", "cpu": 12.5, "memory": 800_000_000]
        ])
        let r = try await task.value
        XCTAssertEqual(r.process?.pid, 1234)
    }

    func testGetRequiresPidOrName() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.get(pcPeerId: "pc"); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testSearchDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.search(pcPeerId: "pc", query: "node") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "query": "node", "total": 1,
            "processes": [["pid": 5678, "name": "node"]]
        ])
        let r = try await task.value
        XCTAssertEqual(r.query, "node")
        XCTAssertEqual(r.processes[0].name, "node")
    }

    func testKillForceFlag() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.kill(pcPeerId: "pc", pid: 1234, force: true) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["force"] as? Bool, true)
        XCTAssertEqual(params["pid"] as? Int, 1234)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "pid": 1234, "force": true, "message": "killed"
        ])
        let r = try await task.value
        XCTAssertTrue(r.force)
    }

    func testKillInvalidPidThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.kill(pcPeerId: "pc", pid: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testStartWithArgsAndCwd() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.start(
                pcPeerId: "pc", command: "node",
                args: ["server.js", "--port", "3000"],
                cwd: "/tmp"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["command"] as? String, "node")
        XCTAssertEqual(params["args"] as? [String], ["server.js", "--port", "3000"])
        XCTAssertEqual(params["cwd"] as? String, "/tmp")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "pid": 9999, "command": "node", "message": "started"
        ])
        let r = try await task.value
        XCTAssertEqual(r.pid, 9999)
    }

    func testGetResourcesDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getResources(pcPeerId: "pc", pid: 1234) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "pid": 1234, "cpu": 25.5,
            "memory": 1_500_000_000, "memoryPercent": 18.3,
            "threads": 24, "handles": 500
        ])
        let r = try await task.value
        XCTAssertEqual(r.cpu, 25.5)
        XCTAssertEqual(r.memory, 1_500_000_000)
        XCTAssertEqual(r.threads, 24)
    }
}
