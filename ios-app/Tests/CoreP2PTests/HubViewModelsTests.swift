import XCTest
@testable import CoreP2P

/// Phase 14.2.2-4 + 14.3.2 — `HubAskViewModel` / `HubAdaptersViewModel` /
/// `HubAuditViewModel` 单元测试，mirror Android Phase 14.1/14.3.3 VM 测试.
///
/// Harness: real `RemoteCommandClient` + real `PersonalDataHubCommands` actor
/// + fake `FakeTransport` (collects DC outbound) + `InboundChannel` (yields
/// command responses). 与 `PersonalDataHubCommandsTests` 同模式 (shared
/// helper duplication acceptable — each test file owns its harness).
@MainActor
final class HubViewModelsTests: XCTestCase {

    // MARK: - Harness

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
        func snapshot() -> [String] {
            lock.lock(); defer { lock.unlock() }
            return dcSent
        }
    }

    private struct Setup {
        let cmds: PersonalDataHubCommands
        let client: RemoteCommandClient
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup() async -> Setup {
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "vm-\(UUID())")!),
            responseTimeoutSeconds: 2
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

    private func successResponse(reqId: String, result: Any) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func errorResponse(reqId: String, message: String) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "error": ["message": message, "code": -32603]]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func tick(_ ms: UInt64 = 50) async throws {
        try await Task.sleep(nanoseconds: ms * 1_000_000)
    }

    /// Drain the initial health call that HubAskViewModel.init fires.
    /// Inject a simple health response so the VM's task doesn't leave it pending.
    private func drainInitialHealth(_ s: Setup) async throws {
        try await tick()
        // The health call goes first; find + respond. May not exist if VM not Ask.
        for raw in s.transport.snapshot() {
            if (try? methodFrom(raw)) == "personal-data-hub.health" {
                let id = try reqIdFrom(raw)
                s.inbound.send(try successResponse(reqId: id, result: [
                    "vault": ["ok": true, "schemaVersion": 1],
                    "llm": ["ok": true, "isLocal": true, "name": "ollama:qwen2.5"],
                    "kgSink": ["ok": true],
                    "ragSink": ["ok": true]
                ]))
                try await tick()
                return
            }
        }
    }

    /// Helper: find the LAST outbound matching method and respond.
    private func respondToLast(
        _ s: Setup, method: String, result: Any
    ) async throws -> [String: Any] {
        try await tick()
        let outbound = s.transport.snapshot()
        // Find the most recent matching method (skip already-responded ones if any)
        for raw in outbound.reversed() {
            if (try? methodFrom(raw)) == method {
                let id = try reqIdFrom(raw)
                let params = (try? paramsFrom(raw)) ?? [:]
                s.inbound.send(try successResponse(reqId: id, result: result))
                try await tick()
                return params
            }
        }
        XCTFail("no outbound for method \(method); got: \(outbound.compactMap { try? methodFrom($0) })")
        return [:]
    }

    private func respondErrorToLast(
        _ s: Setup, method: String, message: String
    ) async throws {
        try await tick()
        for raw in s.transport.snapshot().reversed() {
            if (try? methodFrom(raw)) == method {
                let id = try reqIdFrom(raw)
                s.inbound.send(try errorResponse(reqId: id, message: message))
                try await tick()
                return
            }
        }
        XCTFail("no outbound for method \(method)")
    }

    // MARK: - HubAskViewModel

    func test_ask_happy_path_renders_answer_and_citations() async throws {
        let s = await makeSetup()
        let vm = HubAskViewModel(pcPeerId: "pc", commands: s.cmds)
        try await drainInitialHealth(s)

        vm.onQuestionChange("天气")
        Task { await vm.submit() }
        try await tick()
        _ = try await respondToLast(s, method: "personal-data-hub.ask", result: [
            "answer": "上海多云",
            "citations": [["eventId": "evt-1"]],
            "llmName": "ollama:qwen2.5",
            "isLocal": true
        ])
        try await tick()

        XCTAssertEqual(vm.answer, "上海多云")
        XCTAssertEqual(vm.citations.count, 1)
        XCTAssertEqual(vm.citations.first?.eventId, "evt-1")
        XCTAssertTrue(vm.isLocal)
        XCTAssertNil(vm.errorMessage)
        XCTAssertFalse(vm.showAcceptNonLocalSheet)
    }

    func test_ask_non_local_blocked_shows_sheet_no_error_banner() async throws {
        let s = await makeSetup()
        let vm = HubAskViewModel(pcPeerId: "pc", commands: s.cmds)
        try await drainInitialHealth(s)

        vm.onQuestionChange("私密问题")
        Task { await vm.submit() }
        try await tick()
        try await respondErrorToLast(
            s, method: "personal-data-hub.ask",
            message: "Non-local LLM blocked — pass options.acceptNonLocal=true to override"
        )
        try await tick()

        XCTAssertTrue(vm.showAcceptNonLocalSheet)
        XCTAssertEqual(vm.pendingNonLocalQuestion, "私密问题")
        XCTAssertNil(vm.errorMessage)   // sheet IS the UX
        XCTAssertNil(vm.answer)
    }

    func test_ask_accept_non_local_retry_resends_with_flag() async throws {
        let s = await makeSetup()
        let vm = HubAskViewModel(pcPeerId: "pc", commands: s.cmds)
        try await drainInitialHealth(s)

        // first attempt rejected
        vm.onQuestionChange("解释相对论")
        Task { await vm.submit() }
        try await tick()
        try await respondErrorToLast(
            s, method: "personal-data-hub.ask",
            message: "Non-local LLM blocked"
        )
        try await tick()
        XCTAssertTrue(vm.showAcceptNonLocalSheet)

        // user accepts
        Task { await vm.acceptNonLocalAndRetry() }
        try await tick()
        let retryParams = try await respondToLast(
            s, method: "personal-data-hub.ask",
            result: [
                "answer": "光速恒定...",
                "citations": [],
                "llmName": "claude",
                "isLocal": false
            ]
        )
        try await tick()

        XCTAssertEqual(vm.answer, "光速恒定...")
        XCTAssertFalse(vm.isLocal)
        XCTAssertFalse(vm.showAcceptNonLocalSheet)
        // second invoke should carry acceptNonLocal=true in options
        let opts = retryParams["options"] as? [String: Any]
        XCTAssertEqual(opts?["acceptNonLocal"] as? Bool, true)
    }

    func test_dismiss_accept_non_local_sheet_keeps_unconfirmed() async throws {
        let s = await makeSetup()
        let vm = HubAskViewModel(pcPeerId: "pc", commands: s.cmds)
        try await drainInitialHealth(s)

        vm.onQuestionChange("私密")
        Task { await vm.submit() }
        try await tick()
        try await respondErrorToLast(
            s, method: "personal-data-hub.ask",
            message: "Non-local LLM blocked"
        )
        try await tick()
        XCTAssertTrue(vm.showAcceptNonLocalSheet)

        vm.dismissAcceptNonLocalSheet()
        XCTAssertFalse(vm.showAcceptNonLocalSheet)
        XCTAssertNil(vm.pendingNonLocalQuestion)
        XCTAssertFalse(vm.acceptNonLocalConfirmed)
    }

    func test_open_citation_fetches_detail() async throws {
        let s = await makeSetup()
        let vm = HubAskViewModel(pcPeerId: "pc", commands: s.cmds)
        try await drainInitialHealth(s)

        Task { await vm.openCitation(eventId: "evt-42") }
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.event-detail",
            result: [
                "event": [
                    "id": "evt-42", "subtype": "order",
                    "source": "taobao",
                    "title": "购买",
                    "occurredAt": 1000
                ]
            ]
        )
        try await tick()

        XCTAssertNotNil(vm.activeCitationDetail)
        XCTAssertEqual(vm.activeCitationDetail?.event.id, "evt-42")
        XCTAssertFalse(vm.activeCitationLoading)
    }

    // MARK: - HubAdaptersViewModel

    func test_adapters_reload_populates_list() async throws {
        let s = await makeSetup()
        let dispatcher = HubSyncEventDispatcher(eventStream: AsyncStream { _ in })
        let vm = HubAdaptersViewModel(
            pcPeerId: "pc", commands: s.cmds, dispatcher: dispatcher
        )
        try await tick()  // init's reload Task
        _ = try await respondToLast(
            s, method: "personal-data-hub.list-adapters",
            result: [
                "adapters": [
                    ["name": "email-imap", "version": "1.0.0",
                     "capabilities": ["ingest"], "sensitivity": "high"],
                    ["name": "alipay-bill", "version": "1.0.0",
                     "capabilities": ["import"], "sensitivity": "critical"]
                ]
            ]
        )
        try await tick()

        XCTAssertEqual(vm.adapters.count, 2)
        XCTAssertEqual(vm.adapters[0].name, "email-imap")
        XCTAssertFalse(vm.isLoading)
        XCTAssertNil(vm.errorMessage)
    }

    func test_adapters_sync_success_stores_lastReport() async throws {
        let s = await makeSetup()
        let dispatcher = HubSyncEventDispatcher(eventStream: AsyncStream { _ in })
        let vm = HubAdaptersViewModel(
            pcPeerId: "pc", commands: s.cmds, dispatcher: dispatcher
        )
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.list-adapters",
            result: ["adapters": []]
        )
        try await tick()

        Task { await vm.sync(name: "email-imap") }
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.sync-adapter",
            result: ["adapter": "email-imap", "ingested": 42, "kgTriples": 100, "durationMs": 5000]
        )
        try await tick()

        XCTAssertNil(vm.syncingAdapter)
        XCTAssertEqual(vm.lastReport?.ingested, 42)
        XCTAssertEqual(vm.lastReport?.durationMs, 5000)
    }

    func test_adapters_syncStream_mirrors_dispatcher_progress() async throws {
        let s = await makeSetup()
        let dispatcher = HubSyncEventDispatcher(eventStream: AsyncStream { _ in })
        let vm = HubAdaptersViewModel(
            pcPeerId: "pc", commands: s.cmds, dispatcher: dispatcher
        )
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.list-adapters",
            result: ["adapters": []]
        )
        try await tick()

        // Trigger syncStream — desktop responds with streamId
        Task { await vm.syncStream(name: "email-imap") }
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.sync-adapter-stream",
            result: ["streamId": "s-1", "name": "email-imap"]
        )
        try await tick()

        XCTAssertEqual(vm.syncingAdapter, "email-imap")

        // Inject a fetching event through dispatcher → VM should mirror progress
        dispatcher._testApply(
            HubSyncEvent(
                kind: "fetching", adapter: "email-imap",
                partition: "INBOX", detail: ["uidsScanned": 100]
            )
        )
        try await tick()

        XCTAssertEqual(vm.progress["email-imap"]?.kind, "fetching")
        XCTAssertEqual(vm.progress["email-imap"]?.partition, "INBOX")

        // Inject done — VM should clear syncingAdapter + mirror lastReport
        dispatcher._testApply(
            HubSyncEvent(
                kind: "done", adapter: "email-imap",
                report: HubSyncReport(ingested: 30, kgTriples: 90, durationMs: 18200)
            )
        )
        try await tick()

        XCTAssertNil(vm.syncingAdapter)
        XCTAssertNil(vm.progress["email-imap"])
        XCTAssertEqual(vm.lastReport?.ingested, 30)
    }

    func test_adapters_syncStream_error_event_surfaces_errorMessage() async throws {
        let s = await makeSetup()
        let dispatcher = HubSyncEventDispatcher(eventStream: AsyncStream { _ in })
        let vm = HubAdaptersViewModel(
            pcPeerId: "pc", commands: s.cmds, dispatcher: dispatcher
        )
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.list-adapters",
            result: ["adapters": []]
        )
        try await tick()

        Task { await vm.syncStream(name: "alipay-bill") }
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.sync-adapter-stream",
            result: ["streamId": "s-2"]
        )
        try await tick()

        dispatcher._testApply(
            HubSyncEvent(
                kind: "error", adapter: "alipay-bill",
                message: "ZIP password incorrect"
            )
        )
        try await tick()

        XCTAssertNil(vm.syncingAdapter)
        XCTAssertEqual(vm.errorMessage, "ZIP password incorrect")
    }

    // MARK: - HubAuditViewModel

    func test_audit_reload_populates_rows() async throws {
        let s = await makeSetup()
        let vm = HubAuditViewModel(pcPeerId: "pc", commands: s.cmds)
        try await tick()
        let params = try await respondToLast(
            s, method: "personal-data-hub.recent-audit",
            result: [
                "rows": [
                    ["at": 1000, "action": "ask", "actor": "user"],
                    ["at": 1100, "action": "ingest", "adapter": "email-imap"]
                ]
            ]
        )
        try await tick()

        XCTAssertEqual(vm.rows.count, 2)
        XCTAssertEqual(vm.rows.first?.action, "ask")
        XCTAssertNil(params["action"])   // no filter on init
        XCTAssertEqual(params["limit"] as? Int, 50)
    }

    func test_audit_setActionFilter_triggers_filtered_reload() async throws {
        let s = await makeSetup()
        let vm = HubAuditViewModel(pcPeerId: "pc", commands: s.cmds)
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.recent-audit",
            result: ["rows": []]
        )
        try await tick()

        Task { await vm.setActionFilter("ingest") }
        try await tick()
        let params = try await respondToLast(
            s, method: "personal-data-hub.recent-audit",
            result: ["rows": [["at": 1, "action": "ingest"]]]
        )
        try await tick()

        XCTAssertEqual(vm.actionFilter, "ingest")
        XCTAssertEqual(params["action"] as? String, "ingest")
        XCTAssertEqual(vm.rows.count, 1)
    }

    // MARK: - HubAuditViewModel — Phase 14.3.3.b eventId deep-link

    /// Stub event-detail response shape matching `HubEventDetailResponse`.
    private func auditDetailResult(id: String = "evt-1") -> [String: Any] {
        return [
            "event": [
                "id": id,
                "subtype": "payment",
                "at": 1700_000_000_000,
                "ingestedAt": 1700_000_000_000,
                "actor": "person-self",
                "title": "美团外卖",
                "adapter": "alipay-bill"
            ]
        ]
    }

    func test_audit_openEventDetail_fetches_and_publishes_detail() async throws {
        let s = await makeSetup()
        let vm = HubAuditViewModel(pcPeerId: "pc", commands: s.cmds)
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.recent-audit",
            result: ["rows": []]
        )
        try await tick()

        Task { await vm.openEventDetail(eventId: "evt-1") }
        try await tick()
        // sheet is open immediately (loading state)
        XCTAssertEqual(vm.activeEventId, "evt-1")
        XCTAssertTrue(vm.isEventDetailLoading)

        let params = try await respondToLast(
            s, method: "personal-data-hub.event-detail",
            result: auditDetailResult(id: "evt-1")
        )
        try await tick()

        XCTAssertEqual(vm.activeEventId, "evt-1")
        XCTAssertEqual(vm.activeEventDetail?.event.id, "evt-1")
        XCTAssertFalse(vm.isEventDetailLoading)
        XCTAssertNil(vm.eventDetailError)
        XCTAssertEqual(params["eventId"] as? String, "evt-1")
    }

    func test_audit_openEventDetail_with_blank_id_is_noop() async throws {
        let s = await makeSetup()
        let vm = HubAuditViewModel(pcPeerId: "pc", commands: s.cmds)
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.recent-audit",
            result: ["rows": []]
        )
        try await tick()

        let beforeCount = s.transport.snapshot().count
        await vm.openEventDetail(eventId: "")
        try await tick()

        XCTAssertNil(vm.activeEventId)
        XCTAssertEqual(s.transport.snapshot().count, beforeCount,
                       "no DC traffic for blank eventId")
    }

    func test_audit_openEventDetail_failure_surfaces_error_keeps_sheet_open() async throws {
        let s = await makeSetup()
        let vm = HubAuditViewModel(pcPeerId: "pc", commands: s.cmds)
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.recent-audit",
            result: ["rows": []]
        )
        try await tick()

        Task { await vm.openEventDetail(eventId: "evt-gone") }
        try await tick()
        try await respondErrorToLast(
            s, method: "personal-data-hub.event-detail",
            message: "vault destroyed"
        )
        try await tick()

        XCTAssertEqual(vm.activeEventId, "evt-gone")
        XCTAssertNil(vm.activeEventDetail)
        XCTAssertFalse(vm.isEventDetailLoading)
        XCTAssertNotNil(vm.eventDetailError)
        XCTAssertTrue(vm.eventDetailError!.contains("vault destroyed"))
    }

    func test_audit_closeEventDetail_clears_all_detail_state() async throws {
        let s = await makeSetup()
        let vm = HubAuditViewModel(pcPeerId: "pc", commands: s.cmds)
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.recent-audit",
            result: ["rows": []]
        )
        try await tick()

        Task { await vm.openEventDetail(eventId: "evt-1") }
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.event-detail",
            result: auditDetailResult(id: "evt-1")
        )
        try await tick()

        vm.closeEventDetail()

        XCTAssertNil(vm.activeEventId)
        XCTAssertNil(vm.activeEventDetail)
        XCTAssertFalse(vm.isEventDetailLoading)
        XCTAssertNil(vm.eventDetailError)
    }

    /// design §7 T12 — stale RPC response from earlier tap must NOT
    /// overwrite state once user has opened a different eventId. Verify by
    /// landing two openEventDetail calls + responding to the older one last.
    func test_audit_stale_response_is_discarded() async throws {
        let s = await makeSetup()
        let vm = HubAuditViewModel(pcPeerId: "pc", commands: s.cmds)
        try await tick()
        _ = try await respondToLast(
            s, method: "personal-data-hub.recent-audit",
            result: ["rows": []]
        )
        try await tick()

        // First tap — RPC pending.
        Task { await vm.openEventDetail(eventId: "evt-old") }
        try await tick()
        // Second tap before first responds — bumps requestId.
        Task { await vm.openEventDetail(eventId: "evt-new") }
        try await tick()

        // Respond to the LATER request first (succeeds, becomes active).
        _ = try await respondToLast(
            s, method: "personal-data-hub.event-detail",
            result: auditDetailResult(id: "evt-new")
        )
        try await tick()

        XCTAssertEqual(vm.activeEventId, "evt-new")
        XCTAssertEqual(vm.activeEventDetail?.event.id, "evt-new")

        // Respond to the older request late — should be silently discarded.
        // Find the earlier outbound (the one that was NOT yet responded to)
        // and feed it a result for "evt-old".
        for raw in s.transport.snapshot() {
            if (try? methodFrom(raw)) == "personal-data-hub.event-detail" {
                let pid = try paramsFrom(raw)["eventId"] as? String
                if pid == "evt-old" {
                    let id = try reqIdFrom(raw)
                    s.inbound.send(try successResponse(
                        reqId: id, result: auditDetailResult(id: "evt-old")
                    ))
                    break
                }
            }
        }
        try await tick()

        // Late response must NOT overwrite the active detail.
        XCTAssertEqual(vm.activeEventId, "evt-new")
        XCTAssertEqual(vm.activeEventDetail?.event.id, "evt-new")
    }
}
