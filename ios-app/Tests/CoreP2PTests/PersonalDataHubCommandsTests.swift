import XCTest
@testable import CoreP2P

/// Phase 14.2 — `PersonalDataHubCommands` typed wrapper 测试。
///
/// 22 happy-path + 6 input-guard = 28 tests，1:1 mirror Android
/// `PersonalDataHubCommandsTest.kt` 的 22 method 覆盖（外加 Swift-specific
/// guard 测试）。harness 复用 `AIChatCommandsTests` 模式（FakeTransport +
/// InboundChannel + real RemoteCommandClient）。
///
/// **重点**：每个 method 单测都断言 wire `method` 名是 **kebab-case** —— 这是
/// Android Phase 14.1 真踩过的 camelCase / kebab-case mismatch 的回归保护
/// (docs/internal/hidden-risk-traps.md #17)。
final class PersonalDataHubCommandsTests: XCTestCase {

    // MARK: - Test harness (mirror AIChatCommandsTests)

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
        let cmds: PersonalDataHubCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "pdh-\(UUID())")!),
            responseTimeoutSeconds: responseTimeoutSeconds
        )
        await client.start()
        let cmds = PersonalDataHubCommands(client: client)
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

    private func responseRaw(reqId: String, result: Any) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func waitForOutbound() async throws {
        try await Task.sleep(nanoseconds: 50_000_000)
    }

    // MARK: - 1. ask

    func testAskHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.ask(pcPeerId: "pc", question: "上月在淘宝花了多少",
                                  acceptNonLocal: false, useRag: true, topK: 10)
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.ask")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["question"] as? String, "上月在淘宝花了多少")
        let opts = params["options"] as? [String: Any]
        XCTAssertEqual(opts?["acceptNonLocal"] as? Bool, false)
        XCTAssertEqual(opts?["useRag"] as? Bool, true)
        XCTAssertEqual(opts?["topK"] as? Int, 10)

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "answer": "1234.56 元",
            "citations": [["eventId": "evt-1"]],
            "llmName": "qwen2.5:7b",
            "isLocal": true
        ]))
        let r = try await task.value
        XCTAssertEqual(r.answer, "1234.56 元")
        XCTAssertEqual(r.citations.count, 1)
        XCTAssertEqual(r.citations.first?.eventId, "evt-1")
        XCTAssertTrue(r.isLocal)
    }

    func testAskEmptyQuestionThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.ask(pcPeerId: "pc", question: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch { XCTFail("wrong: \(error)") }
        XCTAssertEqual(s.transport.dcSent.count, 0)
    }

    // MARK: - 2. health

    func testHealthHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.health(pcPeerId: "pc") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.health")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "vault": ["ok": true, "schemaVersion": 7],
            "llm": ["ok": true, "isLocal": true, "name": "qwen2.5:7b"],
            "kgSink": ["ok": true],
            "ragSink": ["ok": true]
        ]))
        let r = try await task.value
        XCTAssertTrue(r.vault.ok)
        XCTAssertEqual(r.vault.schemaVersion, 7)
        XCTAssertTrue(r.llm.isLocal)
        XCTAssertTrue(r.kgSink.ok)
    }

    // MARK: - 3. stats

    func testStatsHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.stats(pcPeerId: "pc") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.stats")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "vault": ["events": 100, "persons": 20, "places": 5, "items": 30, "topics": 8],
            "adapters": [["name": "email-imap", "version": "1.0.0", "sensitivity": "high"]],
            "hubDir": "/u/.chainlesschain/hub"
        ]))
        let r = try await task.value
        XCTAssertEqual(r.events, 100)
        XCTAssertEqual(r.adapters.count, 1)
        XCTAssertEqual(r.adapters.first?.name, "email-imap")
        XCTAssertEqual(r.hubDir, "/u/.chainlesschain/hub")
    }

    // MARK: - 4. listAdapters

    func testListAdaptersHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listAdapters(pcPeerId: "pc") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.list-adapters")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            ["name": "email-imap", "version": "1.0"],
            ["name": "alipay-bill", "version": "1.0"]
        ]))
        let r = try await task.value
        XCTAssertEqual(r.adapters.count, 2)
    }

    // MARK: - 5. syncAdapter

    func testSyncAdapterHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.syncAdapter(pcPeerId: "pc", name: "email-imap",
                                          options: ["since": 1700000000])
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.sync-adapter")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["name"] as? String, "email-imap")
        XCTAssertNotNil(params["options"])

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "ingested": 42, "kgTriples": 100, "ragDocs": 42, "durationMs": 1234
        ]))
        let r = try await task.value
        XCTAssertEqual(r.ingested, 42)
        XCTAssertEqual(r.durationMs, 1234)
    }

    func testSyncAdapterEmptyNameThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.syncAdapter(pcPeerId: "pc", name: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - 6. syncAll

    func testSyncAllHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.syncAll(pcPeerId: "pc") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.sync-all")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            ["ingested": 10],
            ["ingested": 20]
        ]))
        let r = try await task.value
        XCTAssertEqual(r.reports.count, 2)
        XCTAssertEqual(r.reports[0].ingested, 10)
        XCTAssertEqual(r.reports[1].ingested, 20)
    }

    // MARK: - 7. syncAdapterStream

    func testSyncAdapterStreamHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.syncAdapterStream(pcPeerId: "pc", name: "email-imap")
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.sync-adapter-stream")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "streamId": "stream-xyz", "name": "email-imap"
        ]))
        let r = try await task.value
        XCTAssertEqual(r.streamId, "stream-xyz")
        XCTAssertEqual(r.name, "email-imap")
    }

    // MARK: - 8. syncAllStream

    func testSyncAllStreamHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.syncAllStream(pcPeerId: "pc") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.sync-all-stream")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["streamId": "all-stream-1"]))
        let r = try await task.value
        XCTAssertEqual(r.streamId, "all-stream-1")
        XCTAssertNil(r.name)
    }

    // MARK: - 9. queryEvents

    func testQueryEventsHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.queryEvents(pcPeerId: "pc", subtype: "order",
                                          since: 1700000000, limit: 50)
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.query-events")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["subtype"] as? String, "order")
        XCTAssertEqual(params["limit"] as? Int, 50)

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            ["id": "e1", "subtype": "order", "content": ["title": "买耳机"], "source": ["adapter": "taobao"]],
            ["id": "e2", "subtype": "order", "content": ["title": "买书"], "source": ["adapter": "jd"]]
        ]))
        let r = try await task.value
        XCTAssertEqual(r.events.count, 2)
        XCTAssertEqual(r.events[0].title, "买耳机")
        XCTAssertEqual(r.events[1].adapter, "jd")
    }

    // MARK: - 10. recentAudit

    func testRecentAuditHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.recentAudit(pcPeerId: "pc", action: "sync", limit: 20)
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.recent-audit")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            ["at": 1700000000, "action": "sync", "adapter": "email-imap"]
        ]))
        let r = try await task.value
        XCTAssertEqual(r.rows.count, 1)
        XCTAssertEqual(r.rows[0].action, "sync")
    }

    // MARK: - 11. eventDetail

    func testEventDetailHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.eventDetail(pcPeerId: "pc", eventId: "evt-1") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.event-detail")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["eventId"] as? String, "evt-1")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "event": ["id": "evt-1", "subtype": "order", "content": ["title": "买"], "source": ["adapter": "taobao"]],
            "classification": ["template": "order", "confidence": 0.95, "labels": ["shopping"]],
            "extraction": ["template": "order", "fields": ["price": "100"]]
        ]))
        let r = try await task.value
        XCTAssertEqual(r.event.id, "evt-1")
        XCTAssertEqual(r.classification?.template, "order")
        XCTAssertEqual(r.extraction?.fields["price"], "100")
    }

    func testEventDetailEmptyIdThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.eventDetail(pcPeerId: "pc", eventId: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - 12. registerEmail

    func testRegisterEmailHappyPath() async throws {
        let s = await makeSetup()
        let acct = HubEmailAccount(provider: "qq", email: "u@qq.com", authCode: "abc")
        let task = Task { try await s.cmds.registerEmail(pcPeerId: "pc", account: acct) }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.register-email")
        let params = try paramsFrom(raw)
        let account = params["account"] as? [String: Any]
        XCTAssertEqual(account?["email"] as? String, "u@qq.com")
        XCTAssertEqual(account?["authCode"] as? String, "abc")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "name": "email-imap", "version": "1.0", "sensitivity": "high"
        ]))
        let r = try await task.value
        XCTAssertEqual(r.name, "email-imap")
        XCTAssertEqual(r.sensitivity, "high")
    }

    func testRegisterEmailEmptyAuthCodeThrows() async {
        let s = await makeSetup()
        let bad = HubEmailAccount(provider: "qq", email: "u@qq.com", authCode: "")
        do {
            _ = try await s.cmds.registerEmail(pcPeerId: "pc", account: bad)
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - 13. unregisterEmail

    func testUnregisterEmailHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.unregisterEmail(pcPeerId: "pc", email: "u@qq.com") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.unregister-email")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["ok": true, "removed": "u@qq.com"]))
        let r = try await task.value
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.removed, "u@qq.com")
    }

    // MARK: - 14. testEmailAuth

    func testTestEmailAuthHappyPath() async throws {
        let s = await makeSetup()
        let acct = HubEmailAccount(provider: "qq", email: "u@qq.com", authCode: "abc")
        let task = Task { try await s.cmds.testEmailAuth(pcPeerId: "pc", account: acct) }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.test-email-auth")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["ok": true]))
        let r = try await task.value
        XCTAssertTrue(r.ok)
        XCTAssertNil(r.error)
    }

    // MARK: - 15. listEmailAccounts

    func testListEmailAccountsHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listEmailAccounts(pcPeerId: "pc") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.list-email-accounts")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            ["email": "u@qq.com", "provider": "qq", "registeredAt": 1700000000]
        ]))
        let r = try await task.value
        XCTAssertEqual(r.accounts.count, 1)
        XCTAssertEqual(r.accounts[0].provider, "qq")
    }

    // MARK: - 16. registerAlipay

    func testRegisterAlipayHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.registerAlipay(pcPeerId: "pc", email: "u@a.com", zipPassword: "p")
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.register-alipay")
        let params = try paramsFrom(raw)
        let account = params["account"] as? [String: Any]
        XCTAssertEqual(account?["email"] as? String, "u@a.com")
        XCTAssertEqual(account?["zipPassword"] as? String, "p")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["name": "alipay-bill"]))
        let r = try await task.value
        XCTAssertEqual(r.name, "alipay-bill")
    }

    // MARK: - 17. unregisterAlipay

    func testUnregisterAlipayHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.unregisterAlipay(pcPeerId: "pc", email: "u@a.com") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.unregister-alipay")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["ok": true]))
        let r = try await task.value
        XCTAssertTrue(r.ok)
    }

    // MARK: - 18. importAlipayBill

    func testImportAlipayBillHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.importAlipayBill(pcPeerId: "pc", zipPath: "/tmp/bill.zip", zipPassword: "p")
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.import-alipay-bill")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["zipPath"] as? String, "/tmp/bill.zip")
        XCTAssertEqual(params["zipPassword"] as? String, "p")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["ingested": 10]))
        let r = try await task.value
        XCTAssertEqual(r.ingested, 10)
    }

    func testImportAlipayBillNoPathThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.importAlipayBill(pcPeerId: "pc")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - 19. listAlipayAccounts

    func testListAlipayAccountsHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listAlipayAccounts(pcPeerId: "pc") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.list-alipay-accounts")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            ["email": "u@a.com", "hasZipPassword": true, "registeredAt": 1700000000]
        ]))
        let r = try await task.value
        XCTAssertEqual(r.accounts.count, 1)
        XCTAssertTrue(r.accounts[0].hasZipPassword)
    }

    // MARK: - 20. registerMock

    func testRegisterMockHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.registerMock(pcPeerId: "pc", name: "mock-1", count: 5, seed: 42)
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.register-mock")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["name"] as? String, "mock-1")
        XCTAssertEqual(params["count"] as? Int, 5)

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["name": "mock-1"]))
        let r = try await task.value
        XCTAssertEqual(r.name, "mock-1")
    }

    // MARK: - 21. unregister

    func testUnregisterHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.unregister(pcPeerId: "pc", name: "email-imap") }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.unregister")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["ok": true]))
        let r = try await task.value
        XCTAssertTrue(r.ok)
    }

    // MARK: - 22. runSkill

    func testRunSkillHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.runSkill(pcPeerId: "pc", name: "analysis.spending",
                                       options: ["since": 1700000000])
        }
        try await waitForOutbound()

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "personal-data-hub.run-skill")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["name"] as? String, "analysis.spending")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "skill": "analysis.spending", "total": 1234.56
        ]))
        let r = try await task.value
        XCTAssertEqual(r.skillName, "analysis.spending")
        XCTAssertFalse(r.rawJson.isEmpty)
    }

    func testRunSkillEmptyNameThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.runSkill(pcPeerId: "pc", name: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch { XCTFail("wrong: \(error)") }
    }
}
