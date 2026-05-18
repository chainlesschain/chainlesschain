import XCTest
import Combine
@testable import CoreP2P

/// Phase 4.2 — `NotificationEventDispatcher` 测试。
///
/// 8 tests per Phase 4 design §6.2：
/// - happy path: event raw → schedule called once
/// - LRU dedup: 同 id 第二次 silent drop
/// - 非 notification.received event: silent drop
/// - malformed envelope: silent drop（不 crash）
/// - PushTarget=nil 不 crash + 仍维护 unreadCount
/// - start/stop idempotent
/// - @Published latestPush 改触发订阅
/// - unreadCount 增量正确（多条 + reset）
@MainActor
final class NotificationEventDispatcherTests: XCTestCase {

    // MARK: - Test harness

    /// 模拟 PushNotificationManager — 仅记录调用，不真触 iOS UN center。
    private final class FakePushTarget: RemoteNotificationPushTarget {
        var calls: [(title: String, body: String, userInfo: [String: Any])] = []

        func scheduleSystemNotification(
            title: String,
            body: String,
            userInfo: [String: Any]
        ) async {
            calls.append((title, body, userInfo))
        }
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

    private struct Setup {
        let dispatcher: NotificationEventDispatcher
        let channel: EventChannel
        let push: FakePushTarget
    }

    private func makeSetup() -> Setup {
        let channel = EventChannel()
        let push = FakePushTarget()
        let dispatcher = NotificationEventDispatcher(
            eventStream: channel.stream,
            pushTarget: push
        )
        return Setup(dispatcher: dispatcher, channel: channel, push: push)
    }

    private func validEnvelope(
        notificationId: String,
        title: String = "t",
        body: String = "b",
        priority: String = "normal",
        source: String = "pc",
        timestamp: Int64 = 1715760000000
    ) -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:event",
            "payload": [
                "event": "notification.received",
                "notificationId": notificationId,
                "title": title,
                "body": body,
                "priority": priority,
                "source": source,
                "timestamp": timestamp
            ]
        ]
        return String(data: try! JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    // MARK: - Tests

    /// 1. happy path: valid envelope → PushTarget.scheduleSystemNotification 调用 + 状态更新
    func testValidEnvelopeTriggersSchedule() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(validEnvelope(notificationId: "n1", title: "提醒", body: "桌面 build 完成"))
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.push.calls.count, 1)
        XCTAssertEqual(s.push.calls[0].title, "提醒")
        XCTAssertEqual(s.push.calls[0].body, "桌面 build 完成")
        XCTAssertEqual(s.push.calls[0].userInfo["remote_notification_id"] as? String, "n1")
        XCTAssertEqual(s.push.calls[0].userInfo["remote_source"] as? String, "pc")
        XCTAssertEqual(s.push.calls[0].userInfo["remote_priority"] as? String, "normal")

        XCTAssertEqual(s.dispatcher.unreadCount, 1)
        XCTAssertNotNil(s.dispatcher.latestPush)
        XCTAssertEqual(s.dispatcher.latestPush?.id, "n1")
        XCTAssertEqual(s.dispatcher.latestPush?.title, "提醒")
    }

    /// 2. LRU dedup: 同 id 第二次 silent drop
    func testLruDedupSameIdSecondTimeSilentDrop() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(validEnvelope(notificationId: "dup-1", title: "原"))
        s.channel.send(validEnvelope(notificationId: "dup-1", title: "改"))  // 同 id 不同 title
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.push.calls.count, 1, "重复 id 仅 schedule 1 次")
        XCTAssertEqual(s.push.calls[0].title, "原", "第一次 win")
        XCTAssertEqual(s.dispatcher.unreadCount, 1)
        XCTAssertTrue(s.dispatcher._testHasSeenId("dup-1"))
    }

    /// 3. 非 notification.received event silent drop（不调 schedule、不增 unreadCount）
    func testWrongEventNameSilentDrop() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        // terminal.stdout 不是 notification.received
        let terminalEvent = #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s1","data":"x","seq":1}}"#
        s.channel.send(terminalEvent)
        // command response 也是 dispatcher 应忽略的
        let commandResp = #"{"type":"chainlesschain:command:response","payload":{"id":"x","result":{}}}"#
        s.channel.send(commandResp)
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.push.calls.count, 0, "非 notification.received 不应 schedule")
        XCTAssertEqual(s.dispatcher.unreadCount, 0)
        XCTAssertNil(s.dispatcher.latestPush)
    }

    /// 4. malformed envelope silent drop（不 crash dispatcher 流）
    func testMalformedEnvelopeSilentDrop() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send("not a json at all")
        s.channel.send("{}")  // 空 dict
        s.channel.send(#"{"type":"chainlesschain:event"}"#)  // 缺 payload
        s.channel.send(#"{"type":"chainlesschain:event","payload":{"event":"notification.received"}}"#)  // 缺必要字段
        // 然后送一个有效的 — dispatcher 应仍在工作
        s.channel.send(validEnvelope(notificationId: "after-malformed"))
        try await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertEqual(s.push.calls.count, 1, "malformed 全部 drop，最后一条有效仍 schedule")
        XCTAssertEqual(s.push.calls[0].userInfo["remote_notification_id"] as? String, "after-malformed")
        XCTAssertEqual(s.dispatcher.unreadCount, 1)
    }

    /// 5. pushTarget=nil 不 crash + 仍维护 unreadCount
    func testNilPushTargetStillMaintainsUnreadCount() async throws {
        let channel = EventChannel()
        let dispatcher = NotificationEventDispatcher(
            eventStream: channel.stream,
            pushTarget: nil  // 不注入
        )
        dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        channel.send(validEnvelope(notificationId: "no-push-1"))
        channel.send(validEnvelope(notificationId: "no-push-2"))
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(dispatcher.unreadCount, 2, "无 push target 仍累计 unread + dedup 仍工作")
        XCTAssertNotNil(dispatcher.latestPush)
        XCTAssertEqual(dispatcher.latestPush?.id, "no-push-2")
    }

    /// 6. start/stop idempotent — 重复 start 不重复订阅；stop 后再 start 起新订阅
    func testStartStopIdempotent() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        s.dispatcher.start()  // 第二次应 no-op
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(validEnvelope(notificationId: "idem-1"))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.push.calls.count, 1, "重复 start 不应导致 event 被处理多次")

        // stop 后再 start
        s.dispatcher.stop()
        s.dispatcher.stop()  // idempotent
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(validEnvelope(notificationId: "idem-2"))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.push.calls.count, 2, "stop 后 start 应仍可处理新事件")
    }

    /// 7. @Published latestPush 改触发 SwiftUI 订阅（验 Combine publisher emit）
    func testLatestPushPublisherEmitsOnReceive() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        var emissions: [ReceivedNotification?] = []
        let cancellable = s.dispatcher.$latestPush
            .sink { value in emissions.append(value) }

        // 初始 nil emission
        s.channel.send(validEnvelope(notificationId: "pub-1", title: "first"))
        try await Task.sleep(nanoseconds: 100_000_000)
        s.channel.send(validEnvelope(notificationId: "pub-2", title: "second"))
        try await Task.sleep(nanoseconds: 100_000_000)

        cancellable.cancel()

        // 应至少 3 emission：初始 nil + 2 valid
        XCTAssertGreaterThanOrEqual(emissions.count, 3)
        let nonNil = emissions.compactMap { $0 }
        XCTAssertGreaterThanOrEqual(nonNil.count, 2)
        XCTAssertEqual(nonNil.last?.id, "pub-2")
        XCTAssertEqual(nonNil.last?.title, "second")
    }

    /// 8. unreadCount 增量正确 + resetUnreadCount 清零
    func testUnreadCountIncrementAndReset() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        for i in 1...5 {
            s.channel.send(validEnvelope(notificationId: "inc-\(i)"))
        }
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(s.dispatcher.unreadCount, 5)

        s.dispatcher.resetUnreadCount()
        XCTAssertEqual(s.dispatcher.unreadCount, 0)

        // reset 后新事件继续累计
        s.channel.send(validEnvelope(notificationId: "inc-6"))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.dispatcher.unreadCount, 1)
    }

    /// (额外) ReceivedNotification.from timestamp 转 Date 正确
    func testReceivedNotificationFromEventConvertsTimestamp() {
        let event = NotificationReceivedEvent(
            notificationId: "ts-1",
            title: "t", body: "b",
            priority: .urgent,
            source: "pc",
            timestamp: 1715760000000  // 2024-05-15 ish UTC
        )
        let received = ReceivedNotification.from(event: event)
        XCTAssertEqual(received.id, "ts-1")
        XCTAssertEqual(received.priority, .urgent)
        // Date 检查粗 — 验 Date 对象有效（年份合理）
        let calendar = Calendar(identifier: .gregorian)
        let year = calendar.component(.year, from: received.receivedAt)
        XCTAssertGreaterThan(year, 2020)
        XCTAssertLessThan(year, 2030)
    }

    /// (额外) ReceivedNotification.from timestamp=0 兜底为现在
    func testReceivedNotificationFromZeroTimestampFallsBackToNow() {
        let event = NotificationReceivedEvent(
            notificationId: "zero",
            title: "t", body: "b",
            timestamp: 0
        )
        let received = ReceivedNotification.from(event: event)
        // 与 Date() 的差应 < 1s
        let diff = abs(received.receivedAt.timeIntervalSinceNow)
        XCTAssertLessThan(diff, 1.0)
    }
}
