import XCTest
import Combine
@testable import CoreP2P

/// Phase 4.3 — `RemoteNotificationsViewModel` 测试。
///
/// 13 tests:
/// 1. loadHistory happy path → history 填 + unreadCount + isLoading flips
/// 2. loadHistory unreadOnly = true → outbound param 正确
/// 3. markAsRead 成功 → 本地 read=true + unreadCount -= 1 + outbound 1 笔
/// 4. markAsRead 失败 → 乐观回滚 + lastError + refresh 触发（outbound 共 2 笔）
/// 5. markAllAsRead 成功 → 全部 read + unreadCount=0 + dispatcher reset
/// 6. delete 成功 → item removed
/// 7. clearAll 成功 → history 空 + unreadCount=0
/// 8. DC 不通 + markAsRead → enqueue OfflineQueue + lastError 提示
/// 9. loadHistory error → lastError set + isLoading=false
/// 10. isLoading 状态机（true → false）
/// 11. loadDesktopSettings 填 desktopSettings
/// 12. clearError 清 lastError
/// 13. dispatcher.unreadCount 改 → VM.unreadCount mirror
@MainActor
final class RemoteNotificationsViewModelTests: XCTestCase {

    // MARK: - Test harness

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

    private final class EventChannel {
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
        var dcReadyValue: Bool = true
        var isDcReady: Bool {
            lock.lock(); defer { lock.unlock() }
            return dcReadyValue
        }
    }

    private final class FakePushTarget: RemoteNotificationPushTarget {
        var calls = 0
        func scheduleSystemNotification(title: String, body: String, userInfo: [String: Any]) async {
            calls += 1
        }
    }

    private struct Setup {
        let vm: RemoteNotificationsViewModel
        let inbound: InboundChannel
        let event: EventChannel
        let transport: FakeTransport
        let dispatcher: NotificationEventDispatcher
        let queue: OfflineCommandQueue
    }

    private func makeSetup(responseTimeoutSeconds: UInt64 = 2) async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let event = EventChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.isDcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "vmt-\(UUID())")!),
            responseTimeoutSeconds: responseTimeoutSeconds
        )
        await client.start()
        let cmds = NotificationCommands(client: client)
        let dispatcher = NotificationEventDispatcher(
            eventStream: event.stream,
            pushTarget: FakePushTarget()
        )
        let queue = OfflineCommandQueue(
            userDefaults: UserDefaults(suiteName: "vmt-q-\(UUID())")!,
            key: "queue", capacity: 100, maxRetries: 3
        )
        let vm = RemoteNotificationsViewModel(
            pcPeerId: "pc-1",
            commands: cmds,
            dispatcher: dispatcher,
            offlineQueue: queue,
            isDataChannelReady: { transport.isDcReady },
            currentDIDProvider: { "did:cc:me" }
        )
        return Setup(vm: vm, inbound: inbound, event: event, transport: transport, dispatcher: dispatcher, queue: queue)
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

    private func errorResponseRaw(reqId: String, error: String) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "error": error]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func sampleHistoryResultJson(items: [(String, Bool)] = [("n1", false), ("n2", true), ("n3", false)], unreadCount: Int = 2) -> [String: Any] {
        let notiList = items.map { (id, read) in
            [
                "id": id, "title": "t-\(id)", "body": "b-\(id)",
                "priority": "normal", "read": read, "source": "pc",
                "createdAt": 1_715_760_000_000
            ] as [String: Any]
        }
        return [
            "success": true,
            "notifications": notiList,
            "total": items.count,
            "unreadCount": unreadCount
        ]
    }

    // MARK: - Tests

    /// 1. loadHistory happy path
    func testLoadHistoryHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(s.vm.isLoading, "loadHistory 中 isLoading=true")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: sampleHistoryResultJson()))
        await task.value

        XCTAssertEqual(s.vm.history.count, 3)
        XCTAssertEqual(s.vm.history[0].id, "n1")
        XCTAssertEqual(s.vm.unreadCount, 2)
        XCTAssertFalse(s.vm.isLoading)
        XCTAssertNil(s.vm.lastError)
    }

    /// 2. loadHistory unreadOnly=true → outbound 含正确 param
    func testLoadHistoryUnreadOnlyParamPropagates() async throws {
        let s = await makeSetup()
        s.vm.unreadOnly = true
        let task = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)

        let dict = try JSONSerialization.jsonObject(with: Data(s.transport.dcSent[0].utf8)) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["unreadOnly"] as? Bool, true)

        // 喂响应让 task 完成
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: sampleHistoryResultJson(items: [("u1", false)], unreadCount: 1)))
        await task.value
        XCTAssertEqual(s.vm.history.count, 1)
    }

    /// 3. markAsRead 成功 → 本地 read=true + unreadCount -= 1
    func testMarkAsReadSuccessUpdatesLocally() async throws {
        let s = await makeSetup()
        // 先 load 让 history 有数据
        let loadTask = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: sampleHistoryResultJson()))
        await loadTask.value
        XCTAssertEqual(s.vm.unreadCount, 2)

        // markAsRead n1 (unread)
        let markTask = Task { await s.vm.markAsRead(id: "n1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let markId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: markId, result: ["success": true, "markedCount": 1]))
        await markTask.value

        let n1 = s.vm.history.first(where: { $0.id == "n1" })
        XCTAssertEqual(n1?.read, true)
        XCTAssertEqual(s.vm.unreadCount, 1)  // 2 → 1
    }

    /// 4. markAsRead 失败 → 乐观回滚 + lastError + refresh 触发
    func testMarkAsReadFailureRollsBackAndRefreshes() async throws {
        let s = await makeSetup()
        // 先 load
        let loadTask = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: sampleHistoryResultJson()))
        await loadTask.value

        // markAsRead n1 → 桌面端返 error
        let markTask = Task { await s.vm.markAsRead(id: "n1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let markId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try errorResponseRaw(reqId: markId, error: "permission denied"))
        try await Task.sleep(nanoseconds: 100_000_000)
        // markAsRead 失败后会调 refresh → 第 3 笔 outbound (loadHistory)
        XCTAssertEqual(s.transport.dcSent.count, 3)
        let refreshId = try reqIdFrom(s.transport.dcSent[2])
        s.inbound.send(try responseRaw(reqId: refreshId, result: sampleHistoryResultJson()))
        await markTask.value

        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError!.contains("permission denied"))
        // 回滚后 n1 仍 unread
        let n1 = s.vm.history.first(where: { $0.id == "n1" })
        XCTAssertEqual(n1?.read, false)
    }

    /// 5. markAllAsRead 成功
    func testMarkAllAsReadSuccess() async throws {
        let s = await makeSetup()
        let loadTask = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: sampleHistoryResultJson()))
        await loadTask.value

        let markTask = Task { await s.vm.markAllAsRead() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[1]), result: ["success": true, "markedCount": 2]))
        await markTask.value

        XCTAssertTrue(s.vm.history.allSatisfy { $0.read })
        XCTAssertEqual(s.vm.unreadCount, 0)
    }

    /// 6. delete 成功 → 本地 remove
    func testDeleteSuccess() async throws {
        let s = await makeSetup()
        let loadTask = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: sampleHistoryResultJson()))
        await loadTask.value
        XCTAssertEqual(s.vm.history.count, 3)

        let delTask = Task { await s.vm.delete(id: "n2") }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[1]), result: ["success": true]))
        await delTask.value

        XCTAssertEqual(s.vm.history.count, 2)
        XCTAssertNil(s.vm.history.first(where: { $0.id == "n2" }))
    }

    /// 7. clearAll 成功 → history 空 + unreadCount=0
    func testClearAllSuccess() async throws {
        let s = await makeSetup()
        let loadTask = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: sampleHistoryResultJson()))
        await loadTask.value

        let clearTask = Task { await s.vm.clearAll() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[1]), result: ["success": true, "clearedCount": 3]))
        await clearTask.value

        XCTAssertEqual(s.vm.history.count, 0)
        XCTAssertEqual(s.vm.unreadCount, 0)
    }

    /// 8. DC 不通 + markAsRead → enqueue 到 OfflineQueue
    func testMarkAsReadOfflineEnqueues() async throws {
        let s = await makeSetup()
        // 先 load (DC ready)
        let loadTask = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: sampleHistoryResultJson()))
        await loadTask.value

        // 切 DC 不通
        s.transport.lock.lock()
        s.transport.dcReadyValue = false
        s.transport.lock.unlock()
        let outboundCountBefore = s.transport.dcSent.count

        await s.vm.markAsRead(id: "n1")

        // 不应有新 outbound（直接 enqueue）
        XCTAssertEqual(s.transport.dcSent.count, outboundCountBefore)
        let queueCount = await s.queue.totalCount()
        XCTAssertEqual(queueCount, 1, "markAsRead 离线时应入队列")
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError!.contains("离线"), "应提示已加入离线队列")
        // 本地仍乐观更新 (n1 read=true)
        XCTAssertEqual(s.vm.history.first(where: { $0.id == "n1" })?.read, true)
    }

    /// 9. loadHistory error → lastError set + isLoading=false
    func testLoadHistoryErrorSetsLastError() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try errorResponseRaw(reqId: id, error: "桌面端通知服务未启动"))
        await task.value

        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError!.contains("桌面端"))
        XCTAssertFalse(s.vm.isLoading)
        XCTAssertEqual(s.vm.history.count, 0)
    }

    /// 10. isLoading 状态机 (start→true→true→...→false)
    func testIsLoadingStateMachine() async throws {
        let s = await makeSetup()
        var emissions: [Bool] = []
        let cancellable = s.vm.$isLoading.sink { emissions.append($0) }

        let task = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: sampleHistoryResultJson()))
        await task.value
        cancellable.cancel()

        // 至少 false (init) → true (started) → false (done)
        XCTAssertTrue(emissions.contains(true))
        XCTAssertEqual(emissions.last, false)
    }

    /// 11. loadDesktopSettings 填 desktopSettings
    func testLoadDesktopSettingsPopulatesField() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadDesktopSettings() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "enabled": false,
            "quietHoursEnabled": true,
            "quietHoursStart": "23:00",
            "quietHoursEnd": "07:00",
            "soundEnabled": true,
            "vibrationEnabled": false,
            "showPreview": true
        ]))
        await task.value

        XCTAssertNotNil(s.vm.desktopSettings)
        XCTAssertEqual(s.vm.desktopSettings?.enabled, false)
        XCTAssertEqual(s.vm.desktopSettings?.quietHoursStart, "23:00")
    }

    /// 12. clearError 清 lastError
    func testClearErrorClearsLastError() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadHistory() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try errorResponseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), error: "x"))
        await task.value
        XCTAssertNotNil(s.vm.lastError)

        s.vm.clearError()
        XCTAssertNil(s.vm.lastError)
    }

    /// 13. dispatcher.unreadCount 改 → VM.unreadCount mirror
    func testDispatcherUnreadCountMirror() async throws {
        let s = await makeSetup()
        // 初始 0
        XCTAssertEqual(s.vm.unreadCount, 0)

        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)
        let env: [String: Any] = [
            "type": "chainlesschain:event",
            "payload": [
                "event": "notification.received",
                "notificationId": "mirror-1", "title": "t", "body": "b",
                "priority": "normal", "source": "pc", "timestamp": 1_715_760_000_000
            ]
        ]
        let raw = String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
        s.event.send(raw)
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.dispatcher.unreadCount, 1)
        XCTAssertEqual(s.vm.unreadCount, 1, "VM 应 mirror dispatcher unreadCount")
    }
}
