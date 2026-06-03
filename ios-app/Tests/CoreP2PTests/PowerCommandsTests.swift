import XCTest
@testable import CoreP2P

/// Phase 6.1B3 — `PowerCommands` typed wrapper 测试（10 method）。
final class PowerCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: PowerCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "pw-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: PowerCommands(client: client), inbound: inbound, transport: transport)
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

    func testShutdownConfirmFlowDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.shutdown(pcPeerId: "pc", delay: 30, force: false) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "power.shutdown")
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["delay"] as? Int, 30)
        XCTAssertEqual(params["confirm"] as? Bool, true)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "action": "shutdown",
            "requiresConfirmation": true, "confirmId": "C123",
            "message": "Confirm required"
        ])
        let r = try await task.value
        XCTAssertTrue(r.requiresConfirmation)
        XCTAssertEqual(r.confirmId, "C123")
    }

    func testShutdownNegativeDelayThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.shutdown(pcPeerId: "pc", delay: -5); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testRestartSleepHibernateLockLogoutRouted() async throws {
        let s = await makeSetup()
        var idx = 0
        let actions: [(String, () async throws -> PowerActionResponse)] = [
            ("power.restart", { try await s.cmds.restart(pcPeerId: "pc") }),
            ("power.sleep", { try await s.cmds.sleep(pcPeerId: "pc") }),
            ("power.hibernate", { try await s.cmds.hibernate(pcPeerId: "pc") }),
            ("power.lock", { try await s.cmds.lock(pcPeerId: "pc") }),
            ("power.logout", { try await s.cmds.logout(pcPeerId: "pc") })
        ]
        for (expectMethod, fn) in actions {
            let task = Task { try await fn() }
            try await Task.sleep(nanoseconds: 50_000_000)
            let p = try payload(s.transport.dcSent[idx])
            XCTAssertEqual(p["method"] as? String, expectMethod)
            let id = try reqId(s.transport.dcSent[idx])
            try respond(s.inbound, reqId: id, result: [
                "success": true, "action": expectMethod.replacingOccurrences(of: "power.", with: ""),
                "message": "ok"
            ])
            _ = try await task.value
            idx += 1
        }
    }

    func testScheduleShutdownDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.scheduleShutdown(pcPeerId: "pc", scheduledTime: "2026-05-20T22:00:00")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "taskId": "T42", "action": "shutdown",
            "scheduledTime": "2026-05-20T22:00:00",
            "message": "scheduled"
        ])
        let r = try await task.value
        XCTAssertEqual(r.taskId, "T42")
    }

    func testScheduleShutdownInvalidActionThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.scheduleShutdown(
                pcPeerId: "pc", scheduledTime: "X", action: "format-disk"
            )
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testScheduleShutdownEmptyTimeThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.scheduleShutdown(pcPeerId: "pc", scheduledTime: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetScheduleDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getSchedule(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "tasks": [
                ["taskId": "T1", "action": "shutdown", "scheduledTime": "2026-05-20T22:00"],
                ["taskId": "T2", "action": "restart", "scheduledTime": "2026-05-21T03:00"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.tasks.count, 2)
        XCTAssertEqual(r.tasks[1].action, "restart")
    }

    func testCancelScheduleEmptyTaskIdThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.cancelSchedule(pcPeerId: "pc", taskId: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testCancelScheduleDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.cancelSchedule(pcPeerId: "pc", taskId: "T42") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "taskId": "T42", "message": "cancelled"
        ])
        let r = try await task.value
        XCTAssertEqual(r.taskId, "T42")
    }

    func testConfirmDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.confirm(pcPeerId: "pc", confirmId: "C123") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "action": "shutdown", "message": "executing"
        ])
        let r = try await task.value
        XCTAssertEqual(r.action, "shutdown")
    }
}
