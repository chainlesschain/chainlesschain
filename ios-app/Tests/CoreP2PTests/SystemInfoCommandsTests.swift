import XCTest
@testable import CoreP2P

/// Phase 3.5 — `SystemInfoCommands` + `SystemInfo.decode` 测试。
final class SystemInfoCommandsTests: XCTestCase {

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
        var dcReady = true
    }

    private func makeClient() async -> (SystemInfoCommands, InboundChannel, FakeTransport) {
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "si-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return (SystemInfoCommands(client: client), inbound, transport)
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    private func responseRaw(reqId: String, result: [String: Any]) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    func testInfoDecodesAllFourSubBlocks() async throws {
        let (cmds, inbound, transport) = await makeClient()
        let task = Task { try await cmds.info(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let id = try reqIdFrom(transport.dcSent[0])
        inbound.send(try responseRaw(reqId: id, result: [
            "cpu": ["usage": 42.5, "cores": 8, "model": "Apple M1", "speedMhz": 3200],
            "memory": ["total": 16_000_000_000, "used": 8_000_000_000, "free": 8_000_000_000],
            "disk": ["total": 500_000_000_000, "used": 250_000_000_000, "free": 250_000_000_000, "mountPoint": "/"],
            "network": ["interface": "en0", "ipv4": "192.168.1.10", "bytesSent": 1024, "bytesReceived": 2048],
            "uptime": 3600,
            "timestamp": 1700000000000
        ]))
        let info = try await task.value
        XCTAssertEqual(info.cpu?.usagePercent, 42.5)
        XCTAssertEqual(info.cpu?.cores, 8)
        XCTAssertEqual(info.cpu?.model, "Apple M1")
        XCTAssertEqual(info.memory?.totalBytes, 16_000_000_000)
        XCTAssertEqual(info.memory?.usagePercent, 50)
        XCTAssertEqual(info.disk?.mountPoint, "/")
        XCTAssertEqual(info.network?.ipv4, "192.168.1.10")
        XCTAssertEqual(info.uptime, 3600)
    }

    func testInfoToleratesMissingSubBlocks() async throws {
        let (cmds, inbound, transport) = await makeClient()
        let task = Task { try await cmds.info(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(transport.dcSent[0])
        inbound.send(try responseRaw(reqId: id, result: [
            "cpu": ["usage": 30.0, "cores": 4]
            // memory / disk / network 缺 — 平台不支持时
        ]))
        let info = try await task.value
        XCTAssertNotNil(info.cpu)
        XCTAssertNil(info.memory)
        XCTAssertNil(info.disk)
        XCTAssertNil(info.network)
    }

    func testMemoryUsagePercentCalculation() {
        let mem = MemoryInfo(totalBytes: 100, usedBytes: 75, freeBytes: 25)
        XCTAssertEqual(mem.usagePercent, 75)
    }

    func testDiskUsagePercentNilWhenTotalZero() {
        let disk = DiskInfo(totalBytes: nil, usedBytes: 100, freeBytes: nil, mountPoint: nil)
        XCTAssertNil(disk.usagePercent)
    }

    func testInfoErrorThrowsRemoteError() async throws {
        let (cmds, inbound, transport) = await makeClient()
        let task = Task { try await cmds.info(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(transport.dcSent[0])
        let err: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "error": "system unavailable"]
        ]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: err), encoding: .utf8)!)
        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "system unavailable")
        } catch {
            XCTFail("wrong: \(error)")
        }
    }
}
