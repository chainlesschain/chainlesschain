import XCTest
@testable import CoreP2P

/// Phase 6.5 — `HistoryCommands` typed wrapper 测试（8 method 桌面 case 集）。
final class HistoryCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: HistoryCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "hs-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: HistoryCommands(client: client), inbound: inbound, transport: transport)
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

    func testGetHistoryDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getHistory(pcPeerId: "pc", limit: 50) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "entries": [
                ["id": "H1", "command": "ls -la", "timestamp": 1700000000000,
                 "deviceId": "D1", "exitCode": 0, "durationMs": 30],
                ["id": "H2", "command": "git status", "timestamp": 1700000010000,
                 "exitCode": 0]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.entries.count, 2)
        XCTAssertEqual(r.entries[0].command, "ls -la")
        XCTAssertEqual(r.entries[0].timestamp, 1700000000000)
    }

    func testGetHistoryFallbackToHistoryArrayKey() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getHistory(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        // 桌面返 "history" key 而非 "entries" — 测试容忍 fallback
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 1,
            "history": [["id": "X1", "command": "echo hi", "timestamp": 1700000000000]]
        ])
        let r = try await task.value
        XCTAssertEqual(r.entries.count, 1)
        XCTAssertEqual(r.entries[0].command, "echo hi")
    }

    func testGetByIdEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getById(pcPeerId: "pc", id: "H1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["id"] as? String, "H1")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "entry": ["id": "H1", "command": "ls", "timestamp": 1700000000000]
        ])
        let r = try await task.value
        XCTAssertEqual(r.entry?.id, "H1")
    }

    func testGetByDeviceDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getByDevice(pcPeerId: "pc", deviceId: "D1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["deviceId"] as? String, "D1")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 1,
            "entries": [["id": "H1", "command": "x", "timestamp": 1700000000000, "deviceId": "D1"]]
        ])
        let r = try await task.value
        XCTAssertEqual(r.entries.count, 1)
    }

    func testGetByTimeRangeValidates() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.getByTimeRange(pcPeerId: "pc", startTime: 100, endTime: 50)
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetByTimeRangeDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getByTimeRange(pcPeerId: "pc", startTime: 1700000000000, endTime: 1700010000000)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["startTime"] as? Int64, 1700000000000)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 0, "entries": []
        ])
        let r = try await task.value
        XCTAssertEqual(r.total, 0)
    }

    func testSearchDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.search(pcPeerId: "pc", query: "git") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 1,
            "entries": [["id": "H2", "command": "git status", "timestamp": 1700000010000]]
        ])
        let r = try await task.value
        XCTAssertEqual(r.entries[0].command, "git status")
    }

    func testSearchEmptyThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.search(pcPeerId: "pc", query: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetStatsDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStats(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "totalEntries": 1024, "deviceCount": 3,
            "firstTimestamp": 1690000000000, "lastTimestamp": 1700000000000,
            "topCommands": ["ls", "cd", "git"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.totalEntries, 1024)
        XCTAssertEqual(r.topCommands.count, 3)
    }

    func testClearWithFilters() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.clear(pcPeerId: "pc", beforeTimestamp: 1700000000000, deviceId: "D1")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["beforeTimestamp"] as? Int64, 1700000000000)
        XCTAssertEqual(params["deviceId"] as? String, "D1")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "removed": 42, "message": "cleared"
        ])
        let r = try await task.value
        XCTAssertEqual(r.removed, 42)
    }

    func testExportEnvelopeAndValidation() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.export(pcPeerId: "pc", format: "csv", savePath: "/tmp/h.csv")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["format"] as? String, "csv")
        XCTAssertEqual(params["savePath"] as? String, "/tmp/h.csv")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "format": "csv", "path": "/tmp/h.csv",
            "size": 8192, "entries": 100
        ])
        let r = try await task.value
        XCTAssertEqual(r.format, "csv")
        XCTAssertEqual(r.entries, 100)
    }

    func testExportInvalidFormatThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.export(pcPeerId: "pc", format: "xml"); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }
}
