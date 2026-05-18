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

    // MARK: - Multimodal (v0.2)

    func testRunGenerateImageRoutes() async throws {
        let s = await makeSetup()
        s.vm.imagePrompt = "a cat"
        let task = Task { await s.vm.runGenerateImage() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.generateImage")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "prompt": "a cat",
            "images": [["url": "https://x.png"]]
        ])
        await task.value
        XCTAssertEqual(s.vm.generatedImages.count, 1)
        XCTAssertEqual(s.vm.generatedImages[0].url, "https://x.png")
    }

    func testRunGenerateImageEmptyPromptSkips() async {
        let s = await makeSetup()
        s.vm.imagePrompt = "   "
        await s.vm.runGenerateImage()
        XCTAssertEqual(s.vm.generatedImages.count, 0)
        s.transport.lock.lock()
        XCTAssertEqual(s.transport.dcSent.count, 0)
        s.transport.lock.unlock()
    }

    func testRunOcrImageWithoutImageThrowsError() async {
        let s = await makeSetup()
        s.vm.ocrImageBase64 = nil
        await s.vm.runOcrImage()
        XCTAssertEqual(s.vm.errorMessage, "请先选择图片")
    }

    func testRunOcrImageWithImageRoutes() async throws {
        let s = await makeSetup()
        s.vm.ocrImageBase64 = "Zm9v"
        let task = Task { await s.vm.runOcrImage() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.ocrImage")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "text": "Hello", "confidence": 0.95, "language": "en"
        ])
        await task.value
        XCTAssertEqual(s.vm.ocrResult?.text, "Hello")
    }

    func testRunTextToSpeechRoutes() async throws {
        let s = await makeSetup()
        s.vm.ttsInput = "hello world"
        s.vm.ttsVoice = "alloy"
        let task = Task { await s.vm.runTextToSpeech() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.textToSpeech")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "audioData": "Zm9v", "format": "mp3", "voice": "alloy", "duration": 1.5
        ])
        await task.value
        XCTAssertEqual(s.vm.ttsResult?.audioData, "Zm9v")
        XCTAssertEqual(s.vm.ttsResult?.voice, "alloy")
    }

    func testRunTranscribeAudioWithoutFileShowsError() async {
        let s = await makeSetup()
        s.vm.audioBase64 = nil
        await s.vm.runTranscribeAudio()
        XCTAssertEqual(s.vm.errorMessage, "请先选择音频文件")
    }

    func testRunTranscribeAudioWithFileRoutes() async throws {
        let s = await makeSetup()
        s.vm.audioBase64 = "audioBase64"
        s.vm.audioFilename = "demo.mp3"
        let task = Task { await s.vm.runTranscribeAudio() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.transcribeAudio")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "text": "hello", "language": "en", "duration": 2.0
        ])
        await task.value
        XCTAssertEqual(s.vm.transcribeResult?.text, "hello")
    }

    // MARK: - Agents (v0.2)

    func testLoadAgentsPopulates() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadAgents() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.listAgents")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "agents": [
                ["id": "a1", "name": "Summarizer"],
                ["id": "a2", "name": "Translator"]
            ],
            "total": 2, "available": true
        ])
        await task.value
        XCTAssertTrue(s.vm.agentsAvailable)
        XCTAssertEqual(s.vm.agents.count, 2)
    }

    func testLoadAgentsUnavailableSetsFlag() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadAgents() }
        try await waitForSend(s)
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "agents": [], "total": 0, "available": false
        ])
        await task.value
        XCTAssertFalse(s.vm.agentsAvailable)
        XCTAssertEqual(s.vm.agents.count, 0)
    }

    func testRunSelectedAgentRequiresSelection() async {
        let s = await makeSetup()
        s.vm.selectedAgent = nil
        s.vm.agentInput = "x"
        await s.vm.runSelectedAgent()
        XCTAssertEqual(s.vm.errorMessage, "请先选择 agent")
    }

    func testRunSelectedAgentPopulatesRun() async throws {
        let s = await makeSetup()
        s.vm.selectedAgent = AgentInfo(id: "a1", name: "Helper")
        s.vm.agentInput = "summarize"
        let task = Task { await s.vm.runSelectedAgent() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.runAgent")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "agentId": "a1", "runId": "run-1", "status": "running",
            "output": "Processing..."
        ])
        await task.value
        XCTAssertEqual(s.vm.agentRun?.runId, "run-1")
        XCTAssertEqual(s.vm.agentRun?.output, "Processing...")
    }

    func testStopCurrentAgentRunClearsState() async throws {
        let s = await makeSetup()
        s.vm.agentRun = RunAgentResponse(agentId: "a1", runId: "run-1", status: "running")
        let task = Task { await s.vm.stopCurrentAgentRun() }
        try await waitForSend(s)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.stopAgent")
        let id = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "runId": "run-1", "stopped": true
        ])
        await task.value
        XCTAssertNil(s.vm.agentRun)
    }

    func testStopCurrentAgentRunNoRunIsNoop() async {
        let s = await makeSetup()
        s.vm.agentRun = nil
        await s.vm.stopCurrentAgentRun()
        // 不应触发任何 DC 发送
        s.transport.lock.lock()
        XCTAssertEqual(s.transport.dcSent.count, 0)
        s.transport.lock.unlock()
    }

    // MARK: - v0.3 Agent streaming

    /// 等 dcSent 累到指定 count 然后返回 send 序号；不超时即返
    private func waitForSendCount(_ s: Setup, count: Int, timeoutMs: Int = 800) async -> Bool {
        let steps = timeoutMs / 10
        for _ in 0..<steps {
            s.transport.lock.lock()
            let n = s.transport.dcSent.count
            s.transport.lock.unlock()
            if n >= count { return true }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return false
    }

    func testRunStreamEnabledRoutesToRunAgentStream() async throws {
        let s = await makeSetup()
        s.vm.agentStreamEnabled = true
        s.vm.agentStreamPollIntervalNs = 5_000_000  // 5ms 快测试
        s.vm.selectedAgent = AgentInfo(id: "a1", name: "Stream")
        s.vm.agentInput = "go"
        let task = Task { await s.vm.runSelectedAgent() }
        // 第 1 个 send: runAgentStream
        try await waitForSend(s, count: 1)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.runAgentStream")
        let startId = try reqIdFrom(s.transport.dcSent[0])
        try respond(s.inbound, reqId: startId, result: [
            "streamId": "agent_xyz", "agentId": "a1"
        ])
        // 等任务进入 poll loop 发第 2 个 send
        _ = await waitForSendCount(s, count: 2)
        // 完成 task — 第 1 个 poll 即 isComplete=true 退出
        let pollId = try reqIdFrom(s.transport.dcSent[1])
        XCTAssertEqual(try methodFrom(s.transport.dcSent[1]), "ai.getStreamChunk")
        try respond(s.inbound, reqId: pollId, result: [
            "chunks": ["Hello", " world"],
            "isComplete": true, "nextChunkIdx": 2
        ])
        await task.value
        // 给后台 task 完成 + UI 更新一点时间
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(s.vm.agentStreamOutput, "Hello world")
        XCTAssertTrue(s.vm.agentStreamComplete)
        XCTAssertEqual(s.vm.agentStreamId, "agent_xyz")
        XCTAssertEqual(s.vm.agentRun?.status, "complete")
    }

    func testRunStreamMultiplePollsAccumulateChunks() async throws {
        let s = await makeSetup()
        s.vm.agentStreamEnabled = true
        s.vm.agentStreamPollIntervalNs = 5_000_000
        s.vm.selectedAgent = AgentInfo(id: "a1")
        s.vm.agentInput = "x"
        let task = Task { await s.vm.runSelectedAgent() }
        try await waitForSend(s, count: 1)
        try respond(s.inbound, reqId: try reqIdFrom(s.transport.dcSent[0]), result: [
            "streamId": "sid", "agentId": "a1"
        ])
        // poll 1: chunks A
        _ = await waitForSendCount(s, count: 2)
        try respond(s.inbound, reqId: try reqIdFrom(s.transport.dcSent[1]), result: [
            "chunks": ["A"], "isComplete": false, "nextChunkIdx": 1
        ])
        // poll 2: chunks B
        _ = await waitForSendCount(s, count: 3)
        try respond(s.inbound, reqId: try reqIdFrom(s.transport.dcSent[2]), result: [
            "chunks": ["B"], "isComplete": false, "nextChunkIdx": 2
        ])
        // poll 3: chunks C + complete
        _ = await waitForSendCount(s, count: 4)
        try respond(s.inbound, reqId: try reqIdFrom(s.transport.dcSent[3]), result: [
            "chunks": ["C"], "isComplete": true, "nextChunkIdx": 3
        ])
        await task.value
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(s.vm.agentStreamOutput, "ABC")
        XCTAssertTrue(s.vm.agentStreamComplete)
    }

    func testStopStreamingRunCancelsTaskAndCallsCancelStream() async throws {
        let s = await makeSetup()
        s.vm.agentStreamEnabled = true
        s.vm.agentStreamPollIntervalNs = 5_000_000
        s.vm.selectedAgent = AgentInfo(id: "a1")
        let task = Task { await s.vm.runSelectedAgent() }
        try await waitForSend(s, count: 1)
        try respond(s.inbound, reqId: try reqIdFrom(s.transport.dcSent[0]), result: [
            "streamId": "sid-cancel", "agentId": "a1"
        ])
        _ = await waitForSendCount(s, count: 2)
        // 不响应 poll — 用户中途 stop
        await s.vm.stopCurrentAgentRun()
        // stop 应触发 ai.cancelStream send
        _ = await waitForSendCount(s, count: 3)
        XCTAssertEqual(try methodFrom(s.transport.dcSent[2]), "ai.cancelStream")
        try respond(s.inbound, reqId: try reqIdFrom(s.transport.dcSent[2]), result: [
            "cancelled": true
        ])
        // 关 runSelectedAgent task 任务 (它在等 poll 响应，task.cancel 之前需要 timeout)
        // 这里不再 await task.value 防 hang — VM 内部状态 already updated
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertTrue(s.vm.agentStreamComplete)
        XCTAssertEqual(s.vm.agentRun?.status, "stopped")
        task.cancel()
    }

    func testRunStreamErrorFromGetStreamChunkSetsError() async throws {
        let s = await makeSetup()
        s.vm.agentStreamEnabled = true
        s.vm.agentStreamPollIntervalNs = 5_000_000
        s.vm.selectedAgent = AgentInfo(id: "a1")
        let task = Task { await s.vm.runSelectedAgent() }
        try await waitForSend(s, count: 1)
        try respond(s.inbound, reqId: try reqIdFrom(s.transport.dcSent[0]), result: [
            "streamId": "sid-err", "agentId": "a1"
        ])
        _ = await waitForSendCount(s, count: 2)
        // 桌面回 isComplete=true + error 字段
        try respond(s.inbound, reqId: try reqIdFrom(s.transport.dcSent[1]), result: [
            "chunks": [], "isComplete": true, "error": "agent crashed", "nextChunkIdx": 0
        ])
        await task.value
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(s.vm.agentStreamError, "agent crashed")
        XCTAssertEqual(s.vm.agentRun?.status, "failed")
    }
}
