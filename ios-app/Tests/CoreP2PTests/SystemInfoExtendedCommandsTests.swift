import XCTest
@testable import CoreP2P

/// Phase 6.1B3 — `SystemInfoCommands` 扩展 10 个 `sysinfo.X` 方法测试。
/// 既有 Phase 3.5 `info()` 旧 method 的测试在 `SystemInfoCommandsTests.swift`（保留）。
final class SystemInfoExtendedCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: SystemInfoCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "si-ext-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: SystemInfoCommands(client: client), inbound: inbound, transport: transport)
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

    func testGetCPURoutesAndDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getCPU(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(try payload(s.transport.dcSent[0])["method"] as? String, "sysinfo.getCPU")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "cpu": ["brand": "Apple M3 Pro", "cores": 12, "threads": 12,
                    "speed": 3.0, "speedMax": 3.5, "usage": 25.5, "architecture": "arm64"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.brand, "Apple M3 Pro")
        XCTAssertEqual(r.cores, 12)
        XCTAssertEqual(r.architecture, "arm64")
    }

    func testGetMemoryDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getMemory(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "memory": ["totalBytes": 36_000_000_000, "freeBytes": 12_000_000_000,
                       "usedBytes": 24_000_000_000, "availableBytes": 15_000_000_000,
                       "usagePercent": 66.7, "swapTotalBytes": 4_000_000_000,
                       "swapUsedBytes": 500_000_000]
        ])
        let r = try await task.value
        XCTAssertEqual(r.totalBytes, 36_000_000_000)
        XCTAssertEqual(r.swapUsedBytes, 500_000_000)
    }

    func testGetOSDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getOS(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "os": ["platform": "darwin", "distro": "macOS Sequoia",
                   "release": "15.0", "kernel": "24.0.0",
                   "arch": "arm64", "hostname": "studio.local"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.platform, "darwin")
        XCTAssertEqual(r.distro, "macOS Sequoia")
    }

    func testGetUptimeDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getUptime(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "uptimeSeconds": 86400, "bootTime": "2026-05-17T14:00:00"
        ])
        let r = try await task.value
        XCTAssertEqual(r.uptimeSeconds, 86400)
        XCTAssertEqual(r.bootTime, "2026-05-17T14:00:00")
    }

    func testGetBatteryDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getBattery(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "battery": ["hasBattery": true, "percent": 85,
                        "isCharging": false, "timeRemainingMinutes": 240,
                        "acConnected": false]
        ])
        let r = try await task.value
        XCTAssertTrue(r.hasBattery)
        XCTAssertEqual(r.percent, 85)
        XCTAssertEqual(r.timeRemainingMinutes, 240)
    }

    func testGetTemperatureDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getTemperature(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "cpuCelsius": 65.5, "gpuCelsius": 70.0,
            "sensors": [
                ["name": "CPU-Core-0", "celsius": 64.0],
                ["name": "CPU-Core-1", "celsius": 67.0]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.cpuCelsius, 65.5)
        XCTAssertEqual(r.sensors.count, 2)
    }

    func testGetHardwareDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getHardware(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "hardware": ["manufacturer": "Apple", "model": "Mac15,7",
                         "serial": "XXXX", "uuid": "abcd-1234"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.manufacturer, "Apple")
        XCTAssertEqual(r.serial, "XXXX")
    }

    func testGetPerformanceDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getPerformance(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "performance": ["cpuUsage": 25.5, "memoryUsagePercent": 66.7,
                            "diskIoPercent": 5.0,
                            "networkIoBytesPerSec": 1_500_000,
                            "loadAvg1m": 1.5, "loadAvg5m": 2.0, "loadAvg15m": 1.8]
        ])
        let r = try await task.value
        XCTAssertEqual(r.cpuUsage, 25.5)
        XCTAssertEqual(r.networkIoBytesPerSec, 1_500_000)
        XCTAssertEqual(r.loadAvg5m, 2.0)
    }

    func testGetServicesEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getServices(pcPeerId: "pc", limit: 10) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["limit"] as? Int, 10)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "services": [
                ["name": "ssh", "displayName": "OpenSSH Daemon",
                 "state": "running", "startType": "auto"],
                ["name": "cron", "state": "running"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.services.count, 2)
        XCTAssertEqual(r.services[0].state, "running")
    }

    func testGetServicesZeroLimitThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.getServices(pcPeerId: "pc", limit: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetLogsWithFilters() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getLogs(pcPeerId: "pc", level: "error", source: "kernel", limit: 20)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["level"] as? String, "error")
        XCTAssertEqual(params["source"] as? String, "kernel")
        XCTAssertEqual(params["limit"] as? Int, 20)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 1,
            "logs": [
                ["timestamp": "2026-05-18T10:00:00", "level": "error",
                 "source": "kernel", "message": "page fault"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.logs.count, 1)
        XCTAssertEqual(r.logs[0].level, "error")
    }
}
