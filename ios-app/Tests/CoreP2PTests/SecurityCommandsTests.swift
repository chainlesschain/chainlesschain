import XCTest
@testable import CoreP2P

/// Phase 6.1B1 — `SecurityCommands` typed wrapper 测试（8 method）。
final class SecurityCommandsTests: XCTestCase {

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
        let cmds: SecurityCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "sec-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: SecurityCommands(client: client), inbound: inbound, transport: transport)
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

    func testLockWorkstationEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.lockWorkstation(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(try payload(s.transport.dcSent[0])["method"] as? String,
                       "security.lockWorkstation")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true, "message": "locked"])
        let r = try await task.value
        XCTAssertTrue(r.success)
    }

    func testGetStatusDecodesSecuritySummary() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "security": [
                "firewallEnabled": true,
                "antivirusInstalled": true,
                "encryptionEnabled": false,
                "pendingUpdates": 3,
                "platform": "darwin"
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.security.firewallEnabled, true)
        XCTAssertEqual(r.security.pendingUpdates, 3)
        XCTAssertEqual(r.security.platform, "darwin")
    }

    func testGetActiveUsersDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getActiveUsers(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "count": 2, "currentUser": "longfa",
            "users": [
                ["username": "longfa", "terminal": "console", "loginTime": "2026-05-18T10:00:00"],
                ["username": "guest", "terminal": "ssh", "logonType": "remote"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.users.count, 2)
        XCTAssertEqual(r.currentUser, "longfa")
        XCTAssertEqual(r.users[1].logonType, "remote")
    }

    func testGetLoginHistoryWithLimit() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getLoginHistory(pcPeerId: "pc", limit: 10) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["limit"] as? Int, 10)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "count": 1,
            "history": [
                ["username": "longfa", "time": "2026-05-18T09:00:00", "type": "login"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.history.count, 1)
        XCTAssertEqual(r.history[0].type, "login")
    }

    func testGetLoginHistoryNegativeLimitThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.getLoginHistory(pcPeerId: "pc", limit: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetFirewallStatusDecodesProfiles() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getFirewallStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "enabled": true, "type": "Windows Defender Firewall",
            "ruleCount": 247,
            "profiles": [
                ["name": "Domain", "enabled": true],
                ["name": "Private", "enabled": true],
                ["name": "Public", "enabled": false]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.profiles.count, 3)
        XCTAssertEqual(r.profiles[2].name, "Public")
        XCTAssertFalse(r.profiles[2].enabled)
        XCTAssertEqual(r.ruleCount, 247)
    }

    func testGetAntivirusStatusDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getAntivirusStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "installed": true,
            "products": [
                ["name": "Windows Defender", "state": 397568, "builtin": true]
            ]
        ])
        let r = try await task.value
        XCTAssertTrue(r.installed ?? false)
        XCTAssertEqual(r.products[0].name, "Windows Defender")
        XCTAssertEqual(r.products[0].builtin, true)
    }

    func testGetEncryptionStatusDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getEncryptionStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "enabled": true, "type": "BitLocker",
            "percentage": 100, "algorithm": "XTS-AES-256",
            "driveName": "C:"
        ])
        let r = try await task.value
        XCTAssertEqual(r.type, "BitLocker")
        XCTAssertEqual(r.algorithm, "XTS-AES-256")
        XCTAssertEqual(r.percentage, 100)
    }

    func testGetUpdatesDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getUpdates(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "pendingCount": 2,
            "updates": [
                ["title": "2026-05 Cumulative Update", "kb": "KB5023774"],
                ["title": "Windows Defender Antimalware Update"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.pendingCount, 2)
        XCTAssertEqual(r.updates[0].kb, "KB5023774")
        XCTAssertNil(r.updates[1].kb)
    }

    func testEncryptionStatusErrorFieldDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getEncryptionStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": false, "error": "BitLocker not configured"
        ])
        let r = try await task.value
        XCTAssertFalse(r.success)
        XCTAssertEqual(r.error, "BitLocker not configured")
    }
}
