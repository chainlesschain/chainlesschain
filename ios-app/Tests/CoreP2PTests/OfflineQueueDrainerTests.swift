import XCTest
@testable import CoreP2P

/// Phase 3.2 — `OfflineQueueDrainer` 测试。
@MainActor
final class OfflineQueueDrainerTests: XCTestCase {

    private final class FakeRpcTransport: @unchecked Sendable {
        let lock = NSLock()
        var sentDC: [String] = []
        var dcReady: Bool = true
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

    private final class ReadyChannel {
        let stream: AsyncStream<Bool>
        let continuation: AsyncStream<Bool>.Continuation
        init() {
            var local: AsyncStream<Bool>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(8)) { c in local = c }
            self.continuation = local
        }
        func send(_ ready: Bool) { continuation.yield(ready) }
    }

    private struct Setup {
        let queue: OfflineCommandQueue
        let client: RemoteCommandClient
        let inbound: InboundChannel
        let ready: ReadyChannel
        let transport: FakeRpcTransport
    }

    private func makeSetup(currentPcPeerId: String? = "pc-x") async -> (Setup, OfflineQueueDrainer) {
        let suite = UserDefaults(suiteName: "drainer-\(UUID().uuidString)")!
        let queue = OfflineCommandQueue(userDefaults: suite, key: "test", capacity: 100, maxRetries: 3)
        let transport = FakeRpcTransport()
        let inbound = InboundChannel()
        let ready = ReadyChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
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
        let drainer = OfflineQueueDrainer(
            queue: queue,
            commandClient: client,
            pcPeerIdProvider: { currentPcPeerId },
            dataChannelReadyStream: ready.stream
        )
        return (Setup(queue: queue, client: client, inbound: inbound, ready: ready, transport: transport), drainer)
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    private func responseRaw(reqId: String) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": [:]]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    // MARK: - Tests

    func testFalseToTrueEdgeTriggersDrain() async throws {
        let (s, drainer) = await makeSetup()
        _ = await s.queue.enqueue(method: "test.op", paramsJson: "{}", mobileDid: nil)

        drainer.start()
        try await Task.sleep(nanoseconds: 30_000_000)
        // 初始状态 lastReady=false，发 true 应触发 drain
        s.ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.transport.sentDC.count, 1, "drain 应已 invoke 一次")
        // 喂 response 让 drain 完成
        let id = try reqIdFrom(s.transport.sentDC[0])
        s.inbound.send(try responseRaw(reqId: id))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(await s.queue.totalCount(), 0, "成功 entity 应被删除")
        drainer.stop()
    }

    func testRepeatedTrueDoesNotReTrigger() async throws {
        let (s, drainer) = await makeSetup()
        _ = await s.queue.enqueue(method: "x", paramsJson: "{}", mobileDid: nil)

        drainer.start()
        try await Task.sleep(nanoseconds: 30_000_000)
        s.ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)
        let firstSentCount = s.transport.sentDC.count

        // 再发几个 true — 不应触发新 drain（lastReady 已是 true）
        s.ready.send(true)
        s.ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.transport.sentDC.count, firstSentCount, "重复 true 不应再触发 drain")
        drainer.stop()
    }

    func testTrueToFalseToTrueRetriggers() async throws {
        let (s, drainer) = await makeSetup()
        _ = await s.queue.enqueue(method: "first", paramsJson: "{}", mobileDid: nil)

        drainer.start()
        try await Task.sleep(nanoseconds: 30_000_000)
        s.ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)

        // 喂 response 让第一次 drain 完成
        if !s.transport.sentDC.isEmpty {
            let id = try reqIdFrom(s.transport.sentDC[0])
            s.inbound.send(try responseRaw(reqId: id))
        }
        try await Task.sleep(nanoseconds: 100_000_000)

        // 入队第二条
        _ = await s.queue.enqueue(method: "second", paramsJson: "{}", mobileDid: nil)
        // false → true edge 再次触发
        s.ready.send(false)
        try await Task.sleep(nanoseconds: 30_000_000)
        s.ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.transport.sentDC.count, 2, "第二次 drain 应触发并 invoke 第二条")
        drainer.stop()
    }

    func testNilPcPeerIdSkipsDrain() async throws {
        let (s, drainer) = await makeSetup(currentPcPeerId: nil)
        _ = await s.queue.enqueue(method: "x", paramsJson: "{}", mobileDid: nil)

        drainer.start()
        try await Task.sleep(nanoseconds: 30_000_000)
        s.ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.transport.sentDC.count, 0, "无 active pcPeerId 时应跳过 drain")
        XCTAssertEqual(await s.queue.totalCount(), 1, "命令应留在队列")
        drainer.stop()
    }

    func testStopCancelsWatchTask() async throws {
        let (s, drainer) = await makeSetup()
        drainer.start()
        try await Task.sleep(nanoseconds: 30_000_000)
        drainer.stop()

        // stop 后发 true edge 不应触发
        _ = await s.queue.enqueue(method: "after-stop", paramsJson: "{}", mobileDid: nil)
        s.ready.send(true)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.transport.sentDC.count, 0, "stop 后不应再处理 stream events")
    }
}
