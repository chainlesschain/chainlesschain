import XCTest
@testable import CoreP2P

/// Phase 6.1B3 — `NetworkCommands` typed wrapper 测试（11 method）。
final class NetworkCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: NetworkCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "nw-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: NetworkCommands(client: client), inbound: inbound, transport: transport)
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

    func testGetStatusDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "online": true,
            "primaryInterface": "en0", "gateway": "192.168.1.1",
            "dns": ["8.8.8.8", "1.1.1.1"]
        ])
        let r = try await task.value
        XCTAssertTrue(r.online)
        XCTAssertEqual(r.gateway, "192.168.1.1")
        XCTAssertEqual(r.dns, ["8.8.8.8", "1.1.1.1"])
    }

    func testGetInterfacesDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getInterfaces(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "interfaces": [
                ["name": "en0", "type": "wifi", "ipv4": "192.168.1.10",
                 "mac": "AA:BB:CC:DD:EE:FF", "mtu": 1500, "up": true],
                ["name": "lo0", "type": "loopback", "ipv4": "127.0.0.1", "up": true]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.interfaces.count, 2)
        XCTAssertEqual(r.interfaces[0].ipv4, "192.168.1.10")
        XCTAssertEqual(r.interfaces[0].mac, "AA:BB:CC:DD:EE:FF")
    }

    func testGetDNSDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getDNS(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "servers": ["8.8.8.8", "8.8.4.4"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.servers.count, 2)
    }

    func testGetPublicIPDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getPublicIP(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "ip": "203.0.113.42", "ipv4": "203.0.113.42"
        ])
        let r = try await task.value
        XCTAssertEqual(r.ip, "203.0.113.42")
    }

    func testGetWifiDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getWifi(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "wifi": ["connected": true, "ssid": "MyHome", "bssid": "AA:BB:CC:DD:EE:FF",
                     "signal": -45, "channel": 36, "frequency": 5180, "security": "WPA2"]
        ])
        let r = try await task.value
        XCTAssertTrue(r.wifi.connected)
        XCTAssertEqual(r.wifi.ssid, "MyHome")
        XCTAssertEqual(r.wifi.frequency, 5180)
    }

    func testGetBandwidthDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getBandwidth(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "interface": "en0",
            "downloadBytesPerSec": 1_500_000, "uploadBytesPerSec": 200_000
        ])
        let r = try await task.value
        XCTAssertEqual(r.downloadBytesPerSec, 1_500_000)
        XCTAssertEqual(r.uploadBytesPerSec, 200_000)
    }

    func testGetSpeedDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getSpeed(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "downloadMbps": 100.5, "uploadMbps": 25.3,
            "pingMs": 15, "server": "speedtest.net"
        ])
        let r = try await task.value
        XCTAssertEqual(r.downloadMbps, 100.5)
        XCTAssertEqual(r.pingMs, 15)
    }

    func testPingEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.ping(pcPeerId: "pc", host: "1.1.1.1", count: 4) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["host"] as? String, "1.1.1.1")
        XCTAssertEqual(params["count"] as? Int, 4)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "host": "1.1.1.1",
            "packetsSent": 4, "packetsReceived": 4,
            "packetLoss": 0.0, "avgRttMs": 12.5
        ])
        let r = try await task.value
        XCTAssertEqual(r.packetsReceived, 4)
        XCTAssertEqual(r.avgRttMs, 12.5)
    }

    func testPingEmptyHostThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.ping(pcPeerId: "pc", host: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testPingInvalidCountThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.ping(pcPeerId: "pc", host: "x", count: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.ping(pcPeerId: "pc", host: "x", count: 200); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testResolveDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.resolve(pcPeerId: "pc", host: "example.com") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "host": "example.com",
            "addresses": ["93.184.216.34", "2606:2800:220:1::1"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.addresses.count, 2)
    }

    func testTracerouteDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.traceroute(pcPeerId: "pc", host: "google.com", maxHops: 10) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "host": "google.com",
            "hops": [
                ["hop": 1, "host": "router.local", "ip": "192.168.1.1", "rttMs": 1.5],
                ["hop": 2, "ip": "10.0.0.1", "rttMs": 5.2],
                ["hop": 3, "host": "google.com", "ip": "172.217.16.46", "rttMs": 15.0]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.hops.count, 3)
        XCTAssertEqual(r.hops[0].host, "router.local")
        XCTAssertEqual(r.hops[2].rttMs, 15.0)
    }

    func testTracerouteInvalidMaxHopsThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.traceroute(pcPeerId: "pc", host: "x", maxHops: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.traceroute(pcPeerId: "pc", host: "x", maxHops: 100); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetConnectionsDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getConnections(pcPeerId: "pc", protocolFilter: "tcp")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["protocol"] as? String, "tcp")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 1,
            "connections": [
                ["protocol": "tcp", "localAddress": "192.168.1.10", "localPort": 53210,
                 "remoteAddress": "172.217.16.46", "remotePort": 443,
                 "state": "ESTABLISHED", "pid": 1234]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.connections.count, 1)
        XCTAssertEqual(r.connections[0].state, "ESTABLISHED")
        XCTAssertEqual(r.connections[0].pid, 1234)
    }
}
