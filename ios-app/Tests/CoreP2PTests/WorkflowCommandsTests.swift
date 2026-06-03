import XCTest
@testable import CoreP2P

/// Phase 6.5 — `WorkflowCommands` typed wrapper 测试（10 method 桌面子集）。
final class WorkflowCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: WorkflowCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "wf-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: WorkflowCommands(client: client), inbound: inbound, transport: transport)
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
        let task = Task { try await s.cmds.list(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "workflows": [
                ["id": "W1", "name": "Build & Deploy", "description": "CI/CD",
                 "stepsCount": 5, "enabled": true],
                ["id": "W2", "name": "Backup", "stepsCount": 2, "enabled": false]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.workflows.count, 2)
        XCTAssertEqual(r.workflows[0].name, "Build & Deploy")
        XCTAssertFalse(r.workflows[1].enabled)
    }

    func testGetEmptyIdThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.get(pcPeerId: "pc", workflowId: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.get(pcPeerId: "pc", workflowId: "W1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "workflow": ["id": "W1", "name": "Build", "stepsCount": 5]
        ])
        let r = try await task.value
        XCTAssertEqual(r.workflow?.id, "W1")
    }

    func testCreateEnvelopeAndValidation() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.create(
                pcPeerId: "pc", name: "MyFlow",
                description: "test",
                definitionJson: "{\"steps\":[]}"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["name"] as? String, "MyFlow")
        XCTAssertEqual(params["definitionJson"] as? String, "{\"steps\":[]}")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "workflowId": "W42", "message": "created"
        ])
        let r = try await task.value
        XCTAssertEqual(r.workflowId, "W42")
    }

    func testCreateEmptyNameThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.create(pcPeerId: "pc", name: "", definitionJson: "{}")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testUpdateAndDelete() async throws {
        let s = await makeSetup()
        let t1 = Task {
            try await s.cmds.update(pcPeerId: "pc", workflowId: "W1", name: "Renamed", enabled: true)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id1 = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id1, result: [
            "success": true, "workflowId": "W1", "message": "updated"
        ])
        _ = try await t1.value

        let t2 = Task { try await s.cmds.delete(pcPeerId: "pc", workflowId: "W1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id2 = try reqId(s.transport.dcSent[1])
        try respond(s.inbound, reqId: id2, result: [
            "success": true, "workflowId": "W1", "message": "deleted"
        ])
        let r = try await t2.value
        XCTAssertEqual(r.workflowId, "W1")
    }

    func testExecuteDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.execute(pcPeerId: "pc", workflowId: "W1", inputJson: "{}")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "executionId": "E1", "workflowId": "W1",
            "status": "running", "message": "started"
        ])
        let r = try await task.value
        XCTAssertEqual(r.executionId, "E1")
        XCTAssertEqual(r.status, "running")
    }

    func testCancelAndGetStatus() async throws {
        let s = await makeSetup()
        let t1 = Task { try await s.cmds.cancel(pcPeerId: "pc", executionId: "E1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id1 = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id1, result: [
            "success": true, "executionId": "E1", "cancelled": true, "message": "ok"
        ])
        let r1 = try await t1.value
        XCTAssertTrue(r1.cancelled)

        let t2 = Task { try await s.cmds.getStatus(pcPeerId: "pc", executionId: "E1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id2 = try reqId(s.transport.dcSent[1])
        try respond(s.inbound, reqId: id2, result: [
            "success": true, "executionId": "E1", "status": "completed",
            "progress": 1.0, "completedSteps": 5, "totalSteps": 5
        ])
        let r2 = try await t2.value
        XCTAssertEqual(r2.status, "completed")
        XCTAssertEqual(r2.completedSteps, 5)
    }

    func testGetHistoryDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getHistory(pcPeerId: "pc", workflowId: "W1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 1,
            "executions": [
                ["executionId": "E1", "workflowId": "W1", "status": "completed",
                 "startedAt": "2026-05-18T10:00", "durationMs": 1500]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.executions.count, 1)
        XCTAssertEqual(r.executions[0].durationMs, 1500)
    }

    func testGetRunningDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getRunning(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "count": 2,
            "running": [
                ["executionId": "E1", "workflowId": "W1", "status": "running"],
                ["executionId": "E2", "workflowId": "W2", "status": "running"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.running.count, 2)
    }
}
