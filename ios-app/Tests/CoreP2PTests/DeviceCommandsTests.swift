import XCTest
@testable import CoreP2P

/// Phase 6.1B3 — `DeviceCommands` typed wrapper 测试（4 method intersection）。
final class DeviceCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: DeviceCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "dv-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: DeviceCommands(client: client), inbound: inbound, transport: transport)
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

    func testRegisterEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.register(
                pcPeerId: "pc", deviceName: "iPhone-15", deviceType: "mobile",
                publicKey: "ed25519:AAAA"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["deviceName"] as? String, "iPhone-15")
        XCTAssertEqual(params["deviceType"] as? String, "mobile")
        XCTAssertEqual(params["publicKey"] as? String, "ed25519:AAAA")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "deviceId": "DEV-42",
            "registeredAt": "2026-05-18T14:00:00", "message": "registered"
        ])
        let r = try await task.value
        XCTAssertEqual(r.deviceId, "DEV-42")
    }

    func testRegisterEmptyNameThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.register(pcPeerId: "pc", deviceName: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testDisconnectEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.disconnect(pcPeerId: "pc", deviceId: "DEV-42") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "deviceId": "DEV-42", "message": "disconnected"
        ])
        let r = try await task.value
        XCTAssertEqual(r.deviceId, "DEV-42")
    }

    func testDisconnectEmptyDeviceIdThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.disconnect(pcPeerId: "pc", deviceId: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testSetPermissionValidValueDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.setPermission(pcPeerId: "pc", deviceId: "DEV-42", permission: "admin")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "deviceId": "DEV-42", "permission": "admin",
            "message": "permission set"
        ])
        let r = try await task.value
        XCTAssertEqual(r.permission, "admin")
    }

    func testSetPermissionInvalidValueThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.setPermission(
                pcPeerId: "pc", deviceId: "DEV-42", permission: "root"
            )
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testUpdateDeviceWithMetadataAndJson() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.updateDevice(
                pcPeerId: "pc", deviceId: "DEV-42",
                deviceName: "iPhone 15 Pro Max",
                metadata: ["color": "graphite", "storage": "256GB"]
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["deviceName"] as? String, "iPhone 15 Pro Max")
        let metadata = params["metadata"] as! [String: String]
        XCTAssertEqual(metadata["color"], "graphite")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "deviceId": "DEV-42", "message": "updated"
        ])
        let r = try await task.value
        XCTAssertEqual(r.deviceId, "DEV-42")
    }

    func testUpdateDeviceEmptyDeviceIdThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.updateDevice(pcPeerId: "pc", deviceId: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }
}
