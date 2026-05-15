import XCTest
@testable import CoreP2P

/// Phase 3.2 — `OfflineCommandQueue` 测试。
final class OfflineCommandQueueTests: XCTestCase {

    private final class FakeRpcTransport: @unchecked Sendable {
        let lock = NSLock()
        var sentDC: [String] = []
        var dcReady: Bool = true
        var dcSendError: Error?
    }

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

    private struct Setup {
        let queue: OfflineCommandQueue
        let client: RemoteCommandClient
        let inbound: InboundChannel
        let transport: FakeRpcTransport
        let userDefaults: UserDefaults
        let key: String
    }

    private func makeSetup(capacity: Int = 100, maxRetries: Int = 3) async -> Setup {
        let suite = UserDefaults(suiteName: "ofq-\(UUID().uuidString)")!
        let key = "test-queue"
        let queue = OfflineCommandQueue(
            userDefaults: suite, key: key,
            capacity: capacity, maxRetries: maxRetries
        )
        let transport = FakeRpcTransport()
        let inbound = InboundChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                if let err = transport.dcSendError { throw err }
                transport.lock.lock()
                transport.sentDC.append(text)
                transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "fl-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(queue: queue, client: client, inbound: inbound, transport: transport, userDefaults: suite, key: key)
    }

    private func responseRaw(reqId: String, result: [String: Any] = [:]) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func errorResponseRaw(reqId: String, error: String) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "error": error]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    // MARK: - enqueue

    func testEnqueueAddsEntity() async {
        let s = await makeSetup()
        let id = await s.queue.enqueue(method: "clipboard.set", paramsJson: "{\"x\":1}", mobileDid: "did:cc:me")
        XCTAssertFalse(id.isEmpty)
        let count = await s.queue.totalCount()
        XCTAssertEqual(count, 1)
        let pending = await s.queue.pendingCount()
        XCTAssertEqual(pending, 1)
    }

    func testEnqueueAtCapacityDropsOldestPending() async {
        let s = await makeSetup(capacity: 3)
        for i in 0..<3 {
            _ = await s.queue.enqueue(method: "m\(i)", paramsJson: "{}", mobileDid: nil)
        }
        XCTAssertEqual(await s.queue.totalCount(), 3)
        // 第 4 条 → 应丢最老的 (m0)
        let newId = await s.queue.enqueue(method: "m3", paramsJson: "{}", mobileDid: nil)
        XCTAssertEqual(await s.queue.totalCount(), 3)
        let all = await s.queue.all()
        XCTAssertFalse(all.contains(where: { $0.method == "m0" }), "oldest pending should be evicted")
        XCTAssertTrue(all.contains(where: { $0.method == "m3" }))
        XCTAssertTrue(all.contains(where: { $0.id == newId }))
    }

    // MARK: - drain happy

    func testDrainAllPendingSucceeds() async throws {
        let s = await makeSetup()
        _ = await s.queue.enqueue(method: "clipboard.get", paramsJson: "{}", mobileDid: nil)
        _ = await s.queue.enqueue(method: "system.info", paramsJson: "{}", mobileDid: nil)

        let drainTask = Task { await s.queue.drain(client: s.client, pcPeerId: "pc-1") }
        try await Task.sleep(nanoseconds: 100_000_000)

        // RemoteCommandClient 已 send 2 个 envelope；模拟 2 个响应
        XCTAssertEqual(s.transport.sentDC.count, 2)
        for outbound in s.transport.sentDC {
            let id = try reqIdFrom(outbound)
            s.inbound.send(try responseRaw(reqId: id))
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        let result = await drainTask.value
        XCTAssertEqual(result.succeeded, 2)
        XCTAssertEqual(result.failed, 0)
        let count = await s.queue.totalCount()
        XCTAssertEqual(count, 0, "成功的 entity 应被删除")
    }

    // MARK: - drain partial fail

    func testDrainPartialFailIncrementsRetries() async throws {
        let s = await makeSetup()
        _ = await s.queue.enqueue(method: "ok.op", paramsJson: "{}", mobileDid: nil)
        _ = await s.queue.enqueue(method: "fail.op", paramsJson: "{}", mobileDid: nil)

        let drainTask = Task { await s.queue.drain(client: s.client, pcPeerId: "pc-1") }
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.transport.sentDC.count, 2)
        // 第 1 条 success，第 2 条 error 响应
        let id1 = try reqIdFrom(s.transport.sentDC[0])
        let id2 = try reqIdFrom(s.transport.sentDC[1])
        s.inbound.send(try responseRaw(reqId: id1))
        s.inbound.send(try errorResponseRaw(reqId: id2, error: "permission denied"))
        try await Task.sleep(nanoseconds: 100_000_000)

        let result = await drainTask.value
        XCTAssertEqual(result.succeeded, 1)
        XCTAssertEqual(result.failed, 1)
        let all = await s.queue.all()
        XCTAssertEqual(all.count, 1, "失败的 entity 应留下")
        XCTAssertEqual(all[0].status, .failed)
        XCTAssertEqual(all[0].retries, 1)
        XCTAssertEqual(all[0].errorMessage, "permission denied")
    }

    // MARK: - drain skips at maxRetries

    func testDrainSkipsFailedAtMaxRetries() async throws {
        let s = await makeSetup(maxRetries: 2)
        // 手动注入一个已 failed maxRetries 的 entity
        let suite = s.userDefaults
        let entity = OfflineCommandEntity(
            id: "old-failed", method: "x", paramsJson: "{}", mobileDid: nil,
            timestamp: 1000, status: .failed, retries: 2, errorMessage: "had it"
        )
        let data = try JSONEncoder().encode([entity])
        suite.set(data, forKey: s.key)
        // 重新 init queue 让它从 disk 读
        let queue2 = OfflineCommandQueue(userDefaults: suite, key: s.key, maxRetries: 2)
        let countBefore = await queue2.totalCount()
        XCTAssertEqual(countBefore, 1)

        let result = await queue2.drain(client: s.client, pcPeerId: "pc-1")
        XCTAssertEqual(result.succeeded, 0)
        XCTAssertEqual(result.failed, 0, "已到 maxRetries 不参与 drain")
        // entity 仍在
        let countAfter = await queue2.totalCount()
        XCTAssertEqual(countAfter, 1)
    }

    // MARK: - persist round-trip

    func testPersistAcrossInstances() async {
        let suiteName = "persist-\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        let key = "p-key"
        let queue1 = OfflineCommandQueue(userDefaults: suite, key: key)
        _ = await queue1.enqueue(method: "saved.method", paramsJson: "{\"a\":1}", mobileDid: "did:cc:p")

        let queue2 = OfflineCommandQueue(userDefaults: suite, key: key)
        let all = await queue2.all()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all[0].method, "saved.method")
        XCTAssertEqual(all[0].mobileDid, "did:cc:p")
    }

    // MARK: - sending → pending recovery on init

    func testSendingStatusMigratesToPendingOnInit() async throws {
        let suite = UserDefaults(suiteName: "migrate-\(UUID().uuidString)")!
        let key = "m-key"
        // 注入一个 sending 状态 entity（模拟崩溃）
        let entity = OfflineCommandEntity(
            id: "stuck", method: "x", paramsJson: "{}", mobileDid: nil,
            timestamp: 1000, status: .sending, retries: 0
        )
        suite.set(try JSONEncoder().encode([entity]), forKey: key)

        let queue = OfflineCommandQueue(userDefaults: suite, key: key)
        let all = await queue.all()
        XCTAssertEqual(all[0].status, .pending, "残留 sending 应迁移到 pending 重试")
    }

    // MARK: - clearOldFailed

    func testClearOldFailedRemovesOnlyFailedAndOlder() async throws {
        let suite = UserDefaults(suiteName: "old-\(UUID().uuidString)")!
        let key = "k"
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let entities = [
            OfflineCommandEntity(id: "old-failed", method: "x", paramsJson: "{}", mobileDid: nil,
                                  timestamp: now - 7200_000, status: .failed, retries: 5),
            OfflineCommandEntity(id: "new-failed", method: "x", paramsJson: "{}", mobileDid: nil,
                                  timestamp: now - 1000, status: .failed, retries: 1),
            OfflineCommandEntity(id: "old-pending", method: "x", paramsJson: "{}", mobileDid: nil,
                                  timestamp: now - 7200_000, status: .pending, retries: 0),
        ]
        suite.set(try JSONEncoder().encode(entities), forKey: key)
        let queue = OfflineCommandQueue(userDefaults: suite, key: key)
        await queue.clearOldFailed(olderThanMs: 3600_000)  // 1h
        let all = await queue.all()
        XCTAssertEqual(all.count, 2, "应删 old-failed，留 new-failed + old-pending")
        XCTAssertFalse(all.contains(where: { $0.id == "old-failed" }))
        XCTAssertTrue(all.contains(where: { $0.id == "new-failed" }))
        XCTAssertTrue(all.contains(where: { $0.id == "old-pending" }))
    }

    // MARK: - count helpers

    func testCountHelpers() async throws {
        let s = await makeSetup()
        _ = await s.queue.enqueue(method: "p1", paramsJson: "{}", mobileDid: nil)
        _ = await s.queue.enqueue(method: "p2", paramsJson: "{}", mobileDid: nil)
        // 手动注入一个 failed
        let suite = s.userDefaults
        let existing = await s.queue.all()
        let withFailed = existing + [
            OfflineCommandEntity(id: "f1", method: "f", paramsJson: "{}", mobileDid: nil,
                                  timestamp: 0, status: .failed, retries: 1)
        ]
        suite.set(try JSONEncoder().encode(withFailed), forKey: s.key)
        let queue2 = OfflineCommandQueue(userDefaults: suite, key: s.key)

        XCTAssertEqual(await queue2.totalCount(), 3)
        XCTAssertEqual(await queue2.pendingCount(), 2)
        XCTAssertEqual(await queue2.failedCount(), 1)
    }

    // MARK: - remove + clear

    func testRemoveDeletesEntity() async {
        let s = await makeSetup()
        let id = await s.queue.enqueue(method: "x", paramsJson: "{}", mobileDid: nil)
        XCTAssertEqual(await s.queue.totalCount(), 1)
        await s.queue.remove(id: id)
        XCTAssertEqual(await s.queue.totalCount(), 0)
    }

    func testClearEmptiesAll() async {
        let s = await makeSetup()
        _ = await s.queue.enqueue(method: "x", paramsJson: "{}", mobileDid: nil)
        _ = await s.queue.enqueue(method: "y", paramsJson: "{}", mobileDid: nil)
        await s.queue.clear()
        XCTAssertEqual(await s.queue.totalCount(), 0)
    }
}
