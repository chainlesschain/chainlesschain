import XCTest
@testable import CoreP2P

/// Phase 6.1B3 — `StorageCommands` typed wrapper 测试（10 method）。
final class StorageCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: StorageCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "st-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: StorageCommands(client: client), inbound: inbound, transport: transport)
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

    func testGetDisksDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getDisks(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "disks": [
                ["name": "/dev/disk0", "mountPoint": "/", "totalBytes": 500_000_000_000,
                 "usedBytes": 350_000_000_000, "freeBytes": 150_000_000_000,
                 "filesystem": "APFS", "type": "ssd", "usagePercent": 70.0]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.disks.count, 1)
        XCTAssertEqual(r.disks[0].totalBytes, 500_000_000_000)
        XCTAssertEqual(r.disks[0].type, "ssd")
    }

    func testGetPartitionsDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getPartitions(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "partitions": [
                ["name": "/dev/disk0s1", "totalBytes": 100_000_000,
                 "usedBytes": 50_000_000, "freeBytes": 50_000_000, "usagePercent": 50.0],
                ["name": "/dev/disk0s2", "totalBytes": 499_900_000_000,
                 "usedBytes": 349_950_000_000, "freeBytes": 149_950_000_000, "usagePercent": 70.0]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.partitions.count, 2)
    }

    func testGetUsageEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getUsage(pcPeerId: "pc", path: "/Users") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["path"] as? String, "/Users")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "path": "/Users",
            "totalBytes": 100_000_000_000, "usedBytes": 50_000_000_000,
            "freeBytes": 50_000_000_000, "usagePercent": 50.0
        ])
        let r = try await task.value
        XCTAssertEqual(r.path, "/Users")
        XCTAssertEqual(r.usagePercent, 50.0)
    }

    func testGetUsageEmptyPathThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.getUsage(pcPeerId: "pc", path: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetFolderSizeDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getFolderSize(pcPeerId: "pc", path: "/tmp") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "path": "/tmp",
            "totalBytes": 1_000_000, "fileCount": 42, "directoryCount": 5
        ])
        let r = try await task.value
        XCTAssertEqual(r.fileCount, 42)
        XCTAssertEqual(r.directoryCount, 5)
    }

    func testGetLargeFilesDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getLargeFiles(
                pcPeerId: "pc", path: "/Users", limit: 10, minSizeBytes: 100_000_000
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["minSizeBytes"] as? Int64, 100_000_000)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "files": [
                ["path": "/Users/me/video.mp4", "sizeBytes": 2_000_000_000,
                 "modifiedAt": "2026-05-10T10:00:00"],
                ["path": "/Users/me/dataset.zip", "sizeBytes": 500_000_000]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.files.count, 2)
        XCTAssertEqual(r.files[0].sizeBytes, 2_000_000_000)
    }

    func testGetRecentFilesDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getRecentFiles(pcPeerId: "pc", path: "/Users", sinceDaysAgo: 7)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 1,
            "files": [["path": "/Users/me/note.md", "sizeBytes": 1024,
                       "modifiedAt": "2026-05-18T08:00:00"]]
        ])
        let r = try await task.value
        XCTAssertEqual(r.files[0].path, "/Users/me/note.md")
    }

    func testGetStatsDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStats(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "totalDisks": 2,
            "totalBytes": 1_000_000_000_000, "usedBytes": 600_000_000_000,
            "freeBytes": 400_000_000_000
        ])
        let r = try await task.value
        XCTAssertEqual(r.totalDisks, 2)
    }

    func testGetDriveHealthDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getDriveHealth(pcPeerId: "pc", drive: "/dev/disk0") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "drive": "/dev/disk0",
            "healthy": true, "temperature": 42, "powerOnHours": 1000
        ])
        let r = try await task.value
        XCTAssertTrue(r.healthy ?? false)
        XCTAssertEqual(r.temperature, 42)
    }

    func testGetDriveHealthEmptyDriveThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.getDriveHealth(pcPeerId: "pc", drive: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testCleanupDryRunDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.cleanup(
                pcPeerId: "pc", categories: ["cache", "logs"], dryRun: true
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["dryRun"] as? Bool, true)
        XCTAssertEqual(params["categories"] as? [String], ["cache", "logs"])

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "bytesFreed": 500_000_000, "itemsRemoved": 42,
            "message": "Dry run: would free 500MB"
        ])
        let r = try await task.value
        XCTAssertEqual(r.bytesFreed, 500_000_000)
    }

    func testEmptyTrashDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.emptyTrash(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "bytesFreed": 1_000_000_000, "itemsRemoved": 100
        ])
        let r = try await task.value
        XCTAssertEqual(r.itemsRemoved, 100)
    }
}
