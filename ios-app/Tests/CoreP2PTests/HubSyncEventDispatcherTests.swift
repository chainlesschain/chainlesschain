import XCTest
@testable import CoreP2P

/// Phase 14.3.2 — `HubSyncEventDispatcher` 单元测试，mirror Android
/// `HubSyncEventDispatcherTest.kt` (7 tests).
///
/// Cover 5 sync kinds + envelope filter (non-PDH event silent drop) +
/// malformed payload drop + multi-adapter demux + done/error 终态。
///
/// **不复用 RemoteCommandClient harness** — dispatcher 只需要一个
/// AsyncStream<String> input；测试直接构造 stream + yield raw envelope。
@MainActor
final class HubSyncEventDispatcherTests: XCTestCase {

    // MARK: - Harness

    private final class StreamSource {
        let stream: AsyncStream<String>
        let continuation: AsyncStream<String>.Continuation
        init() {
            var local: AsyncStream<String>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(64)) { c in local = c }
            self.continuation = local
        }
        func send(_ raw: String) { continuation.yield(raw) }
        func finish() { continuation.finish() }
    }

    private func envelopeFor(
        kind: String,
        adapter: String,
        partition: String? = nil,
        detail: [String: Int64]? = nil,
        report: [String: Int]? = nil,
        reports: [[String: Any]]? = nil,
        message: String? = nil,
        extra: [String: Any]? = nil
    ) -> String {
        var params: [String: Any] = ["kind": kind, "adapter": adapter]
        if let p = partition { params["partition"] = p }
        if let d = detail { params["detail"] = d.mapValues { Int($0) } }
        if let r = report { params["report"] = r }
        if let rs = reports { params["reports"] = rs }
        if let m = message { params["message"] = m }
        if let extra {
            for (key, value) in extra { params[key] = value }
        }
        let envelope: [String: Any] = [
            "type": "chainlesschain:event:notification",
            "payload": [
                "jsonrpc": "2.0",
                "method": "personal-data-hub.sync.progress",
                "params": params
            ]
        ]
        let data = try! JSONSerialization.data(withJSONObject: envelope)
        return String(data: data, encoding: .utf8)!
    }

    private func waitForDispatcher() async {
        // dispatcher.handle runs in a Task; yield a few times to let it process
        for _ in 0..<5 { await Task.yield() }
    }

    // MARK: - Parse-layer tests (synchronous via _testApply)

    func test_connecting_kind_sets_progress() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d._testApply(HubSyncEvent(kind: "connecting", adapter: "email-imap"))
        XCTAssertEqual(d.progress["email-imap"]?.kind, "connecting")
        XCTAssertNil(d.progress["email-imap"]?.partition)
        XCTAssertNil(d.completedReports["email-imap"])
    }

    func test_fetching_kind_with_partition_and_detail() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d._testApply(
            HubSyncEvent(
                kind: "fetching", adapter: "email-imap",
                partition: "INBOX", detail: ["uidsScanned": 250]
            )
        )
        let ev = d.progress["email-imap"]
        XCTAssertEqual(ev?.kind, "fetching")
        XCTAssertEqual(ev?.partition, "INBOX")
        XCTAssertEqual(ev?.detail?["uidsScanned"], 250)
    }

    func test_done_kind_clears_progress_and_stores_report() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d._testApply(HubSyncEvent(kind: "fetching", adapter: "email-imap"))
        XCTAssertNotNil(d.progress["email-imap"])

        d._testApply(
            HubSyncEvent(
                kind: "done", adapter: "email-imap",
                report: HubSyncReport(ingested: 30, kgTriples: 90, durationMs: 18200)
            )
        )
        XCTAssertNil(d.progress["email-imap"])  // cleared
        XCTAssertEqual(d.completedReports["email-imap"]?.ingested, 30)
        XCTAssertEqual(d.completedReports["email-imap"]?.durationMs, 18200)
    }

    func test_done_kind_with_failed_report_records_error_not_completion() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d._testApply(HubSyncEvent(kind: "fetching", adapter: "email-imap"))

        d._testApply(
            HubSyncEvent(
                kind: "done", adapter: "email-imap",
                report: HubSyncReport(
                    adapter: "email-imap",
                    status: "unhealthy",
                    error: "NO_INPUT"
                )
            )
        )

        XCTAssertNil(d.progress["email-imap"])
        XCTAssertNil(d.completedReports["email-imap"])
        XCTAssertEqual(d.errors["email-imap"], "NO_INPUT")
    }

    func test_batch_done_distributes_reports_by_adapter() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)

        d._testApply(
            HubSyncEvent(
                kind: "done",
                adapter: "*",
                reports: [
                    HubSyncReport(
                        adapter: "email-imap",
                        status: "ok",
                        entityCounts: ["events": 3]
                    ),
                    HubSyncReport(
                        adapter: "apple-health",
                        status: "skipped",
                        skipReason: "NO_INPUT",
                        skipMessage: "需要选择 export.xml"
                    )
                ]
            )
        )

        XCTAssertEqual(d.completedReports["email-imap"]?.ingested, 3)
        XCTAssertNil(d.completedReports["apple-health"])
        XCTAssertNil(d.errors["apple-health"])
        XCTAssertEqual(d.skippedReports["apple-health"]?.skipReason, "NO_INPUT")
    }

    func test_error_kind_clears_progress_and_stores_message() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d._testApply(HubSyncEvent(kind: "fetching", adapter: "alipay-bill"))

        d._testApply(
            HubSyncEvent(
                kind: "error", adapter: "alipay-bill",
                message: "ZIP password incorrect"
            )
        )
        XCTAssertNil(d.progress["alipay-bill"])
        XCTAssertEqual(d.errors["alipay-bill"], "ZIP password incorrect")
    }

    func test_multi_adapter_isolation() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d._testApply(HubSyncEvent(kind: "fetching", adapter: "email-imap", partition: "INBOX"))
        d._testApply(HubSyncEvent(kind: "connecting", adapter: "alipay-bill"))
        XCTAssertEqual(d.progress["email-imap"]?.kind, "fetching")
        XCTAssertEqual(d.progress["alipay-bill"]?.kind, "connecting")
        XCTAssertEqual(d.progress["email-imap"]?.partition, "INBOX")
        XCTAssertEqual(d.progress.count, 2)
    }

    func test_resetForNewSync_clears_progress_and_error_keeps_report() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d._testApply(HubSyncEvent(kind: "fetching", adapter: "email-imap"))
        d._testApply(
            HubSyncEvent(
                kind: "done", adapter: "email-imap",
                report: HubSyncReport(ingested: 10)
            )
        )
        d._testApply(HubSyncEvent(kind: "error", adapter: "email-imap", message: "next round failed"))

        d.resetForNewSync(adapter: "email-imap")
        XCTAssertNil(d.progress["email-imap"])
        XCTAssertNil(d.errors["email-imap"])
        // completedReports retained for UI "上次 +N 事件" 显示
        XCTAssertEqual(d.completedReports["email-imap"]?.ingested, 10)
    }

    // MARK: - Envelope-layer tests (full parse path)

    func test_full_envelope_parse_routes_fetching_event() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        let raw = envelopeFor(
            kind: "fetching", adapter: "email-imap",
            partition: "INBOX", detail: ["uidsScanned": 200]
        )
        await d._testHandle(raw: raw)

        let ev = d.progress["email-imap"]
        XCTAssertEqual(ev?.kind, "fetching")
        XCTAssertEqual(ev?.partition, "INBOX")
        XCTAssertEqual(ev?.detail?["uidsScanned"], 200)
    }

    func test_full_envelope_parse_preserves_retry_progress() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        let raw = envelopeFor(
            kind: "sync.retry",
            adapter: "shopping-taobao",
            extra: [
                "attemptCount": 2,
                "nextAttempt": 3,
                "retryCount": 2,
                "delayMs": 1000,
                "error": "ECONNRESET"
            ]
        )
        await d._testHandle(raw: raw)

        let event = d.progress["shopping-taobao"]
        XCTAssertEqual(event?.kind, "sync.retry")
        XCTAssertEqual(event?.attemptCount, 2)
        XCTAssertEqual(event?.nextAttempt, 3)
        XCTAssertEqual(event?.retryCount, 2)
        XCTAssertEqual(event?.delayMs, 1_000)
        XCTAssertEqual(event?.error, "ECONNRESET")
    }

    func test_full_envelope_parse_preserves_request_throttle_progress() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        let raw = envelopeFor(
            kind: "sync.request_throttled",
            adapter: "shopping-taobao",
            extra: [
                "reason": "min_interval",
                "delayMs": 10_000,
                "sourceRequestCount": 2,
                "operation": "order",
                "page": 3
            ]
        )
        await d._testHandle(raw: raw)

        let event = d.progress["shopping-taobao"]
        XCTAssertEqual(event?.kind, "sync.request_throttled")
        XCTAssertEqual(event?.reason, "min_interval")
        XCTAssertEqual(event?.delayMs, 10_000)
        XCTAssertEqual(event?.sourceRequestCount, 2)
        XCTAssertEqual(event?.operation, "order")
        XCTAssertEqual(event?.page, 3)
    }

    func test_full_envelope_parse_routes_batch_reports() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        let raw = envelopeFor(
            kind: "done",
            adapter: "*",
            reports: [
                [
                    "adapter": "email-imap",
                    "status": "ok",
                    "entityCounts": ["events": 3]
                ],
                [
                    "adapter": "apple-health",
                    "status": "skipped",
                    "skipMessage": "需要选择 export.xml"
                ]
            ]
        )

        await d._testHandle(raw: raw)

        XCTAssertEqual(d.completedReports["email-imap"]?.ingested, 3)
        XCTAssertNil(d.errors["apple-health"])
        XCTAssertEqual(
            d.skippedReports["apple-health"]?.failureMessage,
            "需要选择 export.xml"
        )
    }

    func test_non_PDH_event_envelope_is_dropped() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        // method != personal-data-hub.sync.progress → silent drop
        let nonPdhEnvelope = """
        {
          "type": "chainlesschain:event:notification",
          "payload": {
            "jsonrpc": "2.0",
            "method": "notification.received",
            "params": {"title": "hi", "body": "test"}
          }
        }
        """
        await d._testHandle(raw: nonPdhEnvelope)
        XCTAssertTrue(d.progress.isEmpty)
        XCTAssertTrue(d.completedReports.isEmpty)
        XCTAssertTrue(d.errors.isEmpty)
    }

    func test_malformed_event_with_blank_kind_is_dropped() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        let blankKindEnvelope = """
        {
          "type": "chainlesschain:event:notification",
          "payload": {
            "jsonrpc": "2.0",
            "method": "personal-data-hub.sync.progress",
            "params": {"kind": "", "adapter": "x"}
          }
        }
        """
        await d._testHandle(raw: blankKindEnvelope)
        XCTAssertTrue(d.progress.isEmpty)
    }

    func test_subscription_lifecycle_idempotent() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d.start()
        d.start()  // idempotent — no-op
        d.stop()
        d.stop()   // idempotent — no-op
        // No assertion needed beyond no crash; verifies start/stop are safe.
    }

    func test_subscription_routes_live_event_through_stream() async {
        let src = StreamSource()
        let d = HubSyncEventDispatcher(eventStream: src.stream)
        d.start()

        let raw = envelopeFor(kind: "connecting", adapter: "email-imap")
        src.send(raw)
        await waitForDispatcher()

        XCTAssertEqual(d.progress["email-imap"]?.kind, "connecting")
        d.stop()
    }
}
