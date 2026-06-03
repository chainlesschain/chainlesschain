import XCTest
@testable import CoreP2P

/// Phase 3.5 — `SystemInfoViewModel` polling 测试。
@MainActor
final class SystemInfoViewModelTests: XCTestCase {

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

    private struct Setup {
        let vm: SystemInfoViewModel
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup(pollingInterval: TimeInterval = 0.2) async -> Setup {
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "sivm-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        let cmds = SystemInfoCommands(client: client)
        let vm = SystemInfoViewModel(
            pcPeerId: "pc-1",
            systemInfo: cmds,
            currentDIDProvider: { "did:cc:me" },
            pollingIntervalSeconds: pollingInterval
        )
        return Setup(vm: vm, inbound: inbound, transport: transport)
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

    // MARK: - Tests

    func testOnAppearTriggersImmediateFetch() async throws {
        let s = await makeSetup(pollingInterval: 5.0)  // 大间隔避免 polling 干扰
        s.vm.onAppear()
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(s.transport.dcSent.count, 1)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "cpu": ["usage": 25.0, "cores": 4]
        ]))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertNotNil(s.vm.info)
        XCTAssertEqual(s.vm.info?.cpu?.cores, 4)
        XCTAssertNotNil(s.vm.lastUpdated)
        s.vm.onDisappear()
    }

    func testPollingTriggersRepeatFetch() async throws {
        let s = await makeSetup(pollingInterval: 0.15)
        s.vm.onAppear()
        try await Task.sleep(nanoseconds: 50_000_000)
        // 喂第 1 次响应
        let id1 = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id1, result: ["cpu": ["usage": 10.0]]))
        try await Task.sleep(nanoseconds: 250_000_000)  // 等 polling tick

        // 应有第 2 笔 outbound（polling 触发）
        XCTAssertGreaterThanOrEqual(s.transport.dcSent.count, 2, "polling 应触发新 fetch")
        let id2 = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: id2, result: ["cpu": ["usage": 20.0]]))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.info?.cpu?.usagePercent, 20.0)
        s.vm.onDisappear()
    }

    func testOnDisappearStopsPolling() async throws {
        let s = await makeSetup(pollingInterval: 0.15)
        s.vm.onAppear()
        try await Task.sleep(nanoseconds: 50_000_000)
        let id1 = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id1, result: ["cpu": ["usage": 10.0]]))
        try await Task.sleep(nanoseconds: 100_000_000)

        s.vm.onDisappear()
        let countAfterDisappear = s.transport.dcSent.count
        // 等几个 tick 不应再拉新
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertEqual(s.transport.dcSent.count, countAfterDisappear, "stopPolling 后无新 fetch")
    }

    func testOnAppearIsIdempotent() async throws {
        let s = await makeSetup(pollingInterval: 5.0)
        s.vm.onAppear()
        s.vm.onAppear()
        s.vm.onAppear()
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(s.transport.dcSent.count, 1, "重复 onAppear 不应起重复 polling")
        s.vm.onDisappear()
    }

    func testRefreshTriggersImmediateFetch() async throws {
        let s = await makeSetup(pollingInterval: 100.0)  // 大到不会 tick
        Task { await s.vm.refresh() }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(s.transport.dcSent.count, 1)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["cpu": ["usage": 5.0]]))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertNotNil(s.vm.info)
    }
}
