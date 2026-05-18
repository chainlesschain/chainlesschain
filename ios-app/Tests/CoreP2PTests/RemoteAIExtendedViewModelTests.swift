import XCTest
@testable import CoreP2P

/// Phase 6.4 — `RemoteAIExtendedViewModel` 测试。
/// VM 包 3 sub-tab (templates / code / rag) 各自 load + action。
@MainActor
final class RemoteAIExtendedViewModelTests: XCTestCase {

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
        let vm: RemoteAIExtendedViewModel
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "aiextVM-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        let vm = RemoteAIExtendedViewModel(
            commands: AIExtendedCommands(client: client),
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

    // MARK: - Templates

    func testLoadTemplatesRoutesToGetPromptTemplates() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadTemplates() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.getPromptTemplates")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "templates": [
                ["id": "t1", "name": "N", "template": "T", "variables": ["x"]]
            ],
            "total": 1
        ])
        await task.value
        XCTAssertEqual(s.vm.templates.count, 1)
        XCTAssertEqual(s.vm.templates[0].variables, ["x"])
    }

    func testSaveTemplateThenReloads() async throws {
        let s = await makeSetup()
        let task = Task {
            await s.vm.saveTemplate(name: "Sum", template: "Sum {{x}}",
                                    variables: ["x"], category: "writing")
        }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.savePromptTemplate")
        let saveId = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: saveId, result: [
            "templateId": "t-new", "name": "Sum", "message": "created"
        ])
        // 应自动 reload
        try await waitForSend(s, count: 2)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[1]), "ai.getPromptTemplates")
        let listId = try reqIdFrom(s.transport.dcSent[1])
        try respond(s.inbound, reqId: listId, result: [
            "templates": [["id": "t-new", "name": "Sum", "template": "Sum {{x}}"]],
            "total": 1
        ])
        await task.value
        XCTAssertEqual(s.vm.templates.count, 1)
    }

    func testDeleteTemplateRemovesLocallyOnSuccess() async throws {
        let s = await makeSetup()
        s.vm.templates = [
            PromptTemplate(id: "t1", name: "A", template: "x"),
            PromptTemplate(id: "t2", name: "B", template: "y"),
        ]
        let task = Task { await s.vm.deleteTemplate(s.vm.templates[0]) }
        try await waitForSend(s)
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["templateId": "t1", "deleted": true])
        await task.value
        XCTAssertEqual(s.vm.templates.count, 1)
        XCTAssertEqual(s.vm.templates[0].id, "t2")
    }

    // MARK: - Code

    func testRunCodeExplainMode() async throws {
        let s = await makeSetup()
        s.vm.codeMode = .explain
        s.vm.codeInput = "let x = 1"
        s.vm.codeLanguage = "Swift"
        let task = Task { await s.vm.runCode() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.explainCode")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "explanation": "Declares x as 1.", "language": "Swift"
        ])
        await task.value
        XCTAssertEqual(s.vm.codeResult, "Declares x as 1.")
    }

    func testRunCodeGenerateMode() async throws {
        let s = await makeSetup()
        s.vm.codeMode = .generate
        s.vm.codeInput = "add two ints"
        let task = Task { await s.vm.runCode() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.generateCode")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "code": "func add(_ a: Int, _ b: Int) -> Int { a + b }"
        ])
        await task.value
        XCTAssertTrue(s.vm.codeResult.contains("func add"))
    }

    func testRunCodeRefactorMode() async throws {
        let s = await makeSetup()
        s.vm.codeMode = .refactor
        s.vm.codeInput = "var x = 1"
        let task = Task { await s.vm.runCode() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.refactorCode")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["refactoredCode": "let x = 1"])
        await task.value
        XCTAssertEqual(s.vm.codeResult, "let x = 1")
    }

    func testRunCodeEmptyInputShowsPrompt() async {
        let s = await makeSetup()
        s.vm.codeInput = "   "
        await s.vm.runCode()
        XCTAssertEqual(s.vm.codeResult, "请输入内容")
    }

    // MARK: - RAG

    func testRagStatsLoad() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadRagStats() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.ragStats")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "available": true, "totalDocs": 50, "totalVectors": 200
        ])
        await task.value
        XCTAssertNotNil(s.vm.ragStats)
        XCTAssertEqual(s.vm.ragStats?.totalDocs, 50)
    }

    func testRagSearchPopulatesResults() async throws {
        let s = await makeSetup()
        s.vm.ragQuery = "quantum"
        let task = Task { await s.vm.searchRag() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.ragSearchAdvanced")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "query": "quantum",
            "results": [
                ["id": "d1", "text": "quantum mechanics intro", "score": 0.9]
            ],
            "total": 1
        ])
        await task.value
        XCTAssertEqual(s.vm.ragResults.count, 1)
        XCTAssertEqual(s.vm.ragResults[0].id, "d1")
    }

    func testRagSearchEmptyQueryClearsResults() async {
        let s = await makeSetup()
        s.vm.ragQuery = ""
        s.vm.ragResults = [RAGSearchResult(id: "stale")]
        await s.vm.searchRag()
        XCTAssertEqual(s.vm.ragResults.count, 0)
    }
}
