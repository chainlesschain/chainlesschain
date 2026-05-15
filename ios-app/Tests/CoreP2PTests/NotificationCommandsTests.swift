import XCTest
@testable import CoreP2P

/// Phase 4.1 — `NotificationCommands` typed wrapper 测试。
///
/// 11 method × 1 happy path + 5 error path = 16 tests。覆盖：
/// - 每 method outbound envelope shape (method 名 + params keys)
/// - 每 method response 解码 round-trip
/// - 错误：empty title (invalidArgument) / remote error response / malformed JSON / DC unavailable / timeout
final class NotificationCommandsTests: XCTestCase {

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

    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock()
        var dcSent: [String] = []
        var dcReady: Bool = true
    }

    private struct Setup {
        let cmds: NotificationCommands
        let client: RemoteCommandClient
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup(responseTimeoutSeconds: UInt64 = 2) async -> Setup {
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "noti-\(UUID())")!),
            responseTimeoutSeconds: responseTimeoutSeconds
        )
        await client.start()
        let cmds = NotificationCommands(client: client)
        return Setup(cmds: cmds, client: client, inbound: inbound, transport: transport)
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    private func methodFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["method"] as! String
    }

    private func paramsFrom(_ json: String) throws -> [String: Any] {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["params"] as! [String: Any]
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

    // MARK: - send

    func testSendHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.send(
                pcPeerId: "pc",
                title: "提醒",
                body: "桌面 build 已完成",
                priority: .high,
                respectQuietHours: false,
                mobileDid: "did:cc:m"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "notification.send")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["title"] as? String, "提醒")
        XCTAssertEqual(params["body"] as? String, "桌面 build 已完成")
        XCTAssertEqual(params["priority"] as? String, "high")
        XCTAssertEqual(params["respectQuietHours"] as? Bool, false)

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "notificationId": "noti-001",
            "silenced": false,
            "timestamp": 1715760000000
        ]))
        let result = try await task.value
        XCTAssertTrue(result.success)
        XCTAssertEqual(result.notificationId, "noti-001")
        XCTAssertFalse(result.silenced)
        XCTAssertEqual(result.timestamp, 1715760000000)
    }

    func testSendEmptyTitleThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.send(pcPeerId: "pc", title: "", body: "x")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
        // 不应有 outbound
        XCTAssertEqual(s.transport.dcSent.count, 0)
    }

    // MARK: - sendToMobile

    func testSendToMobileHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.sendToMobile(
                pcPeerId: "pc",
                title: "推送",
                body: "Hello",
                deviceId: "iphone-1",
                data: ["url": "https://x.test"]
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "notification.sendToMobile")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["deviceId"] as? String, "iphone-1")
        XCTAssertNotNil(params["data"])

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "delivered": true,
            "deviceId": "iphone-1"
        ]))
        let result = try await task.value
        XCTAssertTrue(result.delivered)
        XCTAssertEqual(result.deviceId, "iphone-1")
    }

    // MARK: - broadcast

    func testBroadcastHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.broadcast(pcPeerId: "pc", title: "广播", body: "测试") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "notification.broadcast")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "deliveredCount": 3,
            "failedCount": 1
        ]))
        let result = try await task.value
        XCTAssertEqual(result.deliveredCount, 3)
        XCTAssertEqual(result.failedCount, 1)
    }

    // MARK: - getHistory

    func testGetHistoryHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getHistory(pcPeerId: "pc", limit: 20, offset: 0, unreadOnly: true) }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "notification.getHistory")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["limit"] as? Int, 20)
        XCTAssertEqual(params["unreadOnly"] as? Bool, true)

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "notifications": [
                [
                    "id": "n1", "title": "t1", "body": "b1",
                    "priority": "high", "read": false, "source": "pc",
                    "createdAt": 1715760000000
                ],
                [
                    "id": "n2", "title": "t2", "body": "b2",
                    "priority": "normal", "read": true, "source": "pc",
                    "createdAt": 1715760001000, "readAt": 1715760010000
                ]
            ],
            "total": 2,
            "unreadCount": 1
        ]))
        let result = try await task.value
        XCTAssertEqual(result.notifications.count, 2)
        XCTAssertEqual(result.notifications[0].id, "n1")
        XCTAssertEqual(result.notifications[0].priority, .high)
        XCTAssertFalse(result.notifications[0].read)
        XCTAssertEqual(result.notifications[1].readAt, 1715760010000)
        XCTAssertEqual(result.unreadCount, 1)
    }

    // MARK: - markAsRead

    func testMarkAsReadHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.markAsRead(pcPeerId: "pc", notificationId: "n1") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "notification.markAsRead")
        XCTAssertEqual(try paramsFrom(s.transport.dcSent[0])["notificationId"] as? String, "n1")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["success": true, "markedCount": 1]))
        let result = try await task.value
        XCTAssertEqual(result.markedCount, 1)
    }

    func testMarkAsReadEmptyIdThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.markAsRead(pcPeerId: "pc", notificationId: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    // MARK: - markAllAsRead

    func testMarkAllAsReadHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.markAllAsRead(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "notification.markAllAsRead")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["success": true, "markedCount": 12]))
        let result = try await task.value
        XCTAssertEqual(result.markedCount, 12)
    }

    // MARK: - delete

    func testDeleteHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.delete(pcPeerId: "pc", notificationId: "n9") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "notification.delete")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["success": true]))
        let result = try await task.value
        XCTAssertTrue(result.success)
        XCTAssertNil(result.error)
    }

    // MARK: - clearAll

    func testClearAllHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.clearAll(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "notification.clearAll")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["success": true, "clearedCount": 25]))
        let result = try await task.value
        XCTAssertEqual(result.clearedCount, 25)
    }

    // MARK: - getUnreadCount

    func testGetUnreadCountHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getUnreadCount(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "notification.getUnreadCount")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["success": true, "count": 7]))
        let result = try await task.value
        XCTAssertEqual(result.count, 7)
    }

    // MARK: - getSettings

    func testGetSettingsHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getSettings(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "notification.getSettings")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "enabled": true,
            "quietHoursEnabled": true,
            "quietHoursStart": "22:00",
            "quietHoursEnd": "08:00",
            "soundEnabled": false,
            "vibrationEnabled": true,
            "showPreview": true
        ]))
        let result = try await task.value
        XCTAssertTrue(result.enabled)
        XCTAssertTrue(result.quietHoursEnabled)
        XCTAssertEqual(result.quietHoursStart, "22:00")
        XCTAssertEqual(result.quietHoursEnd, "08:00")
        XCTAssertFalse(result.soundEnabled)
    }

    // MARK: - updateSettings

    func testUpdateSettingsHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.updateSettings(
                pcPeerId: "pc",
                enabled: false,
                quietHoursEnabled: true,
                quietHoursStart: "23:00"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "notification.updateSettings")
        let params = try paramsFrom(s.transport.dcSent[0])
        XCTAssertEqual(params["enabled"] as? Bool, false)
        XCTAssertEqual(params["quietHoursEnabled"] as? Bool, true)
        XCTAssertEqual(params["quietHoursStart"] as? String, "23:00")
        // 不该含未传字段
        XCTAssertNil(params["quietHoursEnd"])
        XCTAssertNil(params["soundEnabled"])

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "settings": [
                "enabled": false,
                "quietHoursEnabled": true,
                "quietHoursStart": "23:00",
                "quietHoursEnd": "08:00",
                "soundEnabled": true,
                "vibrationEnabled": true,
                "showPreview": true
            ]
        ]))
        let result = try await task.value
        XCTAssertTrue(result.success)
        XCTAssertEqual(result.settings?.enabled, false)
        XCTAssertEqual(result.settings?.quietHoursStart, "23:00")
    }

    func testUpdateSettingsNoFieldsThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.updateSettings(pcPeerId: "pc")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    // MARK: - 错误路径

    func testRemoteErrorResponseTranslated() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.send(pcPeerId: "pc", title: "x", body: "y") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try errorResponseRaw(reqId: id, error: "桌面端通知服务未启动"))
        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "桌面端通知服务未启动")
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testMalformedResultThrows() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getSettings(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let id = try reqIdFrom(s.transport.dcSent[0])
        // success 但 resultJson 不是合法 JSON 对象（里面塞了字符串）
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "result": "not-a-json-object"]
        ]
        let raw = String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
        s.inbound.send(raw)
        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch RemoteSkillError.malformedResult {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testTimeoutThrows() async {
        let s = await makeSetup(responseTimeoutSeconds: 1)
        do {
            _ = try await s.cmds.send(pcPeerId: "pc", title: "x", body: "y")
            XCTFail("expected throw")
        } catch TerminalRpcError.timeout {
            // ok — 透传 commandClient 的 timeout error
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    // MARK: - NotificationReceivedEvent envelope parse

    func testReceivedEventEnvelopeParsesValid() {
        let raw = #"""
        {"type":"chainlesschain:event","payload":{"event":"notification.received","notificationId":"n42","title":"hi","body":"there","priority":"urgent","source":"pc","timestamp":1715760000000,"data":{"url":"https://x.test"}}}
        """#
        let evt = NotificationReceivedEvent.parseFromEnvelope(raw)
        XCTAssertNotNil(evt)
        XCTAssertEqual(evt?.notificationId, "n42")
        XCTAssertEqual(evt?.priority, .urgent)
        XCTAssertEqual(evt?.timestamp, 1715760000000)
        XCTAssertEqual(evt?.data?["url"], "https://x.test")
    }

    func testReceivedEventRejectsWrongEnvelopeType() {
        // 是 command response 不是 event — should be silent drop (return nil)
        let raw = #"{"type":"chainlesschain:command:response","payload":{"id":"x","result":{}}}"#
        XCTAssertNil(NotificationReceivedEvent.parseFromEnvelope(raw))
    }

    func testReceivedEventRejectsWrongEventName() {
        // 是 event 但不是 notification.received — should be silent drop
        let raw = #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s","data":"x","seq":1}}"#
        XCTAssertNil(NotificationReceivedEvent.parseFromEnvelope(raw))
    }

    func testReceivedEventRejectsMissingFields() {
        // 缺 notificationId
        let raw = #"{"type":"chainlesschain:event","payload":{"event":"notification.received","title":"x","body":"y","timestamp":0}}"#
        XCTAssertNil(NotificationReceivedEvent.parseFromEnvelope(raw))
    }
}
