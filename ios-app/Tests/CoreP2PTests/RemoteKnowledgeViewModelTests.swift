import XCTest
@testable import CoreP2P

/// Phase 6.4 — `RemoteKnowledgeViewModel` 测试。
/// VM 主要 orchestration — 测 filter 切换→正确 wrap method / optimistic update /
/// 错误降级 / 创建后 reload。
@MainActor
final class RemoteKnowledgeViewModelTests: XCTestCase {

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
        let vm: RemoteKnowledgeViewModel
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "knowledgeVM-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        let vm = RemoteKnowledgeViewModel(
            commands: KnowledgeCommands(client: client),
            pcPeerIdProvider: { "pc-1" }
        )
        return Setup(vm: vm, inbound: inbound, transport: transport)
    }

    private func waitForSend(_ s: Setup, count: Int = 1) async throws {
        var attempts = 0
        while attempts < 40 {
            s.transport.lock.lock()
            let n = s.transport.dcSent.count
            s.transport.lock.unlock()
            if n >= count { return }
            try await Task.sleep(nanoseconds: 10_000_000)
            attempts += 1
        }
        XCTFail("did not see \(count) sends")
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return ((d["payload"] as! [String: Any])["id"] as! String)
    }

    private func methodFrom(_ json: String) throws -> String {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return ((d["payload"] as! [String: Any])["method"] as! String)
    }

    private func respond(_ inbound: InboundChannel, reqId: String, result: [String: Any]) throws {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    // MARK: - Filter 切换路由到对应 wrap method

    func testAllFilterRoutesToGetNotes() async throws {
        let s = await makeSetup()
        s.vm.selectedFilter = .all
        let task = Task { await s.vm.load() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "knowledge.getNotes")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "notes": [["id": 1, "title": "N1", "tags": "[]"]],
            "total": 1
        ])
        await task.value
        XCTAssertEqual(s.vm.notes.count, 1)
        XCTAssertEqual(s.vm.notes[0].title, "N1")
    }

    func testStarredFilterRoutesToGetStarredNotes() async throws {
        let s = await makeSetup()
        s.vm.selectedFilter = .starred
        let task = Task { await s.vm.load() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "knowledge.getStarredNotes")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["notes": [], "total": 0])
        await task.value
    }

    func testPinnedFilterRoutesToGetPinnedNotes() async throws {
        let s = await makeSetup()
        s.vm.selectedFilter = .pinned
        let task = Task { await s.vm.load() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "knowledge.getPinnedNotes")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["notes": [], "total": 0])
        await task.value
    }

    func testArchivedFilterRoutesToGetArchivedNotes() async throws {
        let s = await makeSetup()
        s.vm.selectedFilter = .archived
        let task = Task { await s.vm.load() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "knowledge.getArchivedNotes")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["notes": [], "total": 0])
        await task.value
    }

    func testSearchQueryOverridesFilterRoute() async throws {
        let s = await makeSetup()
        s.vm.selectedFilter = .starred // 即便选了 starred
        s.vm.searchQuery = "hello"
        let task = Task { await s.vm.load() }
        try await waitForSend(s)
        // search query 非空时优先走 searchNotes
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "knowledge.searchNotes")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["results": [], "total": 0])
        await task.value
    }

    // MARK: - Optimistic updates

    func testToggleStarLocallyUpdatesNote() async throws {
        let s = await makeSetup()
        s.vm.notes = [KnowledgeNote(id: "5", title: "T", starred: false)]
        let task = Task { await s.vm.toggleStar(s.vm.notes[0]) }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "knowledge.starNote")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 5, "starred": true])
        await task.value
        XCTAssertTrue(s.vm.notes[0].starred)
    }

    func testArchiveRemovesFromNonArchivedFilterList() async throws {
        let s = await makeSetup()
        s.vm.selectedFilter = .all
        s.vm.notes = [
            KnowledgeNote(id: "1", title: "A"),
            KnowledgeNote(id: "2", title: "B")
        ]
        let target = s.vm.notes[0]
        let task = Task { await s.vm.archive(target) }
        try await waitForSend(s)
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "archived": true])
        await task.value
        XCTAssertEqual(s.vm.notes.count, 1)
        XCTAssertEqual(s.vm.notes[0].id, "2")
    }

    func testArchiveKeepsInArchivedFilterList() async throws {
        let s = await makeSetup()
        s.vm.selectedFilter = .archived
        s.vm.notes = [KnowledgeNote(id: "1", title: "A")]
        let task = Task { await s.vm.archive(s.vm.notes[0]) }
        try await waitForSend(s)
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "archived": true])
        await task.value
        XCTAssertEqual(s.vm.notes.count, 1) // 仍在
    }

    func testDeleteRemovesNote() async throws {
        let s = await makeSetup()
        s.vm.notes = [KnowledgeNote(id: "1", title: "A")]
        let task = Task { await s.vm.delete(s.vm.notes[0]) }
        try await waitForSend(s)
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "message": "deleted"])
        await task.value
        XCTAssertEqual(s.vm.notes.count, 0)
    }

    // MARK: - Error path

    func testLoadWithoutPcPeerIdSetsError() async {
        let vm = RemoteKnowledgeViewModel(
            commands: KnowledgeCommands(client: RemoteCommandClient(
                dataChannelSender: { _ in },
                signalingSender: { _, _ in },
                isDataChannelReady: { false },
                inboundMessages: AsyncStream { _ in },
                featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "noPc-\(UUID())")!),
                responseTimeoutSeconds: 1
            )),
            pcPeerIdProvider: { nil }
        )
        await vm.load()
        XCTAssertEqual(vm.errorMessage, "未配对桌面")
    }
}
