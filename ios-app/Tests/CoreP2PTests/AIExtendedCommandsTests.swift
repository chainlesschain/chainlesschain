import XCTest
@testable import CoreP2P

/// Phase 6.4 — `AIExtendedCommands` (`ai` namespace) typed wrapper 测试（25 method）。
/// 与 AIChatCommands (Phase 5 12 method) 并列，桌面 ai-handler.js 后 25 method。
final class AIExtendedCommandsTests: XCTestCase {

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
        let cmds: AIExtendedCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "aiext-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: AIExtendedCommands(client: client), inbound: inbound, transport: transport)
    }

    private func reqId(_ json: String) throws -> String {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return ((d["payload"] as! [String: Any])["id"] as! String)
    }

    private func payload(_ json: String) throws -> [String: Any] {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return d["payload"] as! [String: Any]
    }

    private func respond(_ inbound: InboundChannel, reqId: String, result: [String: Any]) throws {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
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

    // MARK: - Conversations 高级

    func testUpdateConversationEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.updateConversation(pcPeerId: "pc", conversationId: "c1", title: "New")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "ai.updateConversation")
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["title"] as? String, "New")
        XCTAssertNil(params["model"])
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["conversationId": "c1", "message": "Conversation updated"])
        let r = try await task.value
        XCTAssertEqual(r.message, "Conversation updated")
    }

    func testUpdateConversationNoFieldsThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.updateConversation(pcPeerId: "pc", conversationId: "c1")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testArchiveConversationDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.archiveConversation(pcPeerId: "pc", conversationId: "c1")
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["conversationId": "c1", "archived": true])
        let r = try await task.value
        XCTAssertEqual(r.archived, true)
    }

    func testSearchConversationsDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.searchConversations(pcPeerId: "pc", query: "hello")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual((p["params"] as! [String: Any])["archived"] as? Bool, false)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "query": "hello",
            "conversations": [
                ["id": "c1", "title": "Hello world", "messageCount": 3, "archived": false]
            ],
            "total": 1
        ])
        let r = try await task.value
        XCTAssertEqual(r.total, 1)
        XCTAssertEqual(r.conversations[0].id, "c1")
        XCTAssertEqual(r.conversations[0].messageCount, 3)
    }

    func testExportConversationMarkdownDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.exportConversation(pcPeerId: "pc", conversationId: "c1", format: "markdown")
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "conversationId": "c1", "format": "markdown", "mime": "text/markdown",
            "content": "# My Chat\n\n## user\n\nHi\n",
            "messageCount": 1
        ])
        let r = try await task.value
        XCTAssertTrue(r.content.contains("# My Chat"))
        XCTAssertEqual(r.messageCount, 1)
    }

    // MARK: - Prompt templates

    func testSavePromptTemplateEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.savePromptTemplate(
                pcPeerId: "pc", name: "Summarize",
                template: "Summarize {{topic}}",
                variables: ["topic"], category: "writing"
            )
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["name"] as? String, "Summarize")
        XCTAssertEqual(params["variables"] as? [String], ["topic"])
        XCTAssertEqual(params["category"] as? String, "writing")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "templateId": "tpl_123", "name": "Summarize", "message": "Template created"
        ])
        let r = try await task.value
        XCTAssertEqual(r.templateId, "tpl_123")
    }

    func testGetPromptTemplatesDecodeWithVariables() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getPromptTemplates(pcPeerId: "pc") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "templates": [
                ["id": "t1", "name": "N", "template": "T", "variables": ["a", "b"], "category": "x"]
            ],
            "total": 1
        ])
        let r = try await task.value
        XCTAssertEqual(r.templates[0].variables, ["a", "b"])
        XCTAssertEqual(r.templates[0].category, "x")
    }

    func testDeletePromptTemplateDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.deletePromptTemplate(pcPeerId: "pc", templateId: "t1") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["templateId": "t1", "deleted": true])
        let r = try await task.value
        XCTAssertTrue(r.deleted)
    }

    // MARK: - RAG

    func testRagSearchAdvancedEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.ragSearchAdvanced(
                pcPeerId: "pc", query: "topic", topK: 3,
                filters: ["tag": "A"], scoreThreshold: 0.5
            )
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["topK"] as? Int, 3)
        XCTAssertEqual(params["scoreThreshold"] as? Double, 0.5)
        XCTAssertEqual(params["filters"] as? [String: String], ["tag": "A"])
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "query": "topic",
            "results": [
                ["id": "d1", "text": "match", "score": 0.9, "metadata": ["tag": "A"]]
            ],
            "total": 1
        ])
        let r = try await task.value
        XCTAssertEqual(r.results[0].id, "d1")
        XCTAssertEqual(r.results[0].score, 0.9)
        XCTAssertEqual(r.results[0].metadata["tag"], "A")
    }

    func testRagIndexAutoIdDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.ragIndex(pcPeerId: "pc", text: "content")
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["docId": "doc_abc", "indexed": true])
        let r = try await task.value
        XCTAssertEqual(r.docId, "doc_abc")
        XCTAssertTrue(r.indexed)
    }

    func testRagStatsDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.ragStats(pcPeerId: "pc") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "available": true, "totalDocs": 100, "totalVectors": 400
        ])
        let r = try await task.value
        XCTAssertTrue(r.available)
        XCTAssertEqual(r.totalDocs, 100)
    }

    func testRagListDocumentsDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.ragListDocuments(pcPeerId: "pc") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "documents": [["id": "d1", "text": "doc 1"], ["id": "d2"]],
            "total": 2
        ])
        let r = try await task.value
        XCTAssertEqual(r.documents.count, 2)
        XCTAssertEqual(r.documents[1].id, "d2")
    }

    // MARK: - Multimodal

    func testGenerateImageClampsN() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.generateImage(pcPeerId: "pc", prompt: "a cat", n: 99)
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual((p["params"] as! [String: Any])["n"] as? Int, 10)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "prompt": "a cat", "model": "dall-e-3",
            "images": [["url": "https://x.png"]]
        ])
        let r = try await task.value
        XCTAssertEqual(r.images.count, 1)
        XCTAssertEqual(r.images[0].url, "https://x.png")
    }

    func testOcrImageWithPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.ocrImage(pcPeerId: "pc", imagePath: "/tmp/img.png", language: "zh")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["imagePath"] as? String, "/tmp/img.png")
        XCTAssertEqual(params["language"] as? String, "zh")
        XCTAssertNil(params["imageData"])
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "text": "你好世界", "confidence": 0.95, "language": "zh"
        ])
        let r = try await task.value
        XCTAssertEqual(r.text, "你好世界")
        XCTAssertEqual(r.confidence, 0.95)
    }

    func testOcrImageMissingBothThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.ocrImage(pcPeerId: "pc")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testTranscribeAudioDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.transcribeAudio(
                pcPeerId: "pc", audioData: "base64audio", language: "en", model: "whisper"
            )
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "text": "hello world", "language": "en", "duration": 3.5
        ])
        let r = try await task.value
        XCTAssertEqual(r.text, "hello world")
        XCTAssertEqual(r.duration, 3.5)
    }

    func testTextToSpeechDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.textToSpeech(pcPeerId: "pc", text: "hi", voice: "alloy", speed: 1.2)
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["voice"] as? String, "alloy")
        XCTAssertEqual(params["speed"] as? Double, 1.2)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "audioData": "Zm9v", "format": "mp3", "voice": "alloy", "duration": 1.5
        ])
        let r = try await task.value
        XCTAssertEqual(r.audioData, "Zm9v")
        XCTAssertEqual(r.voice, "alloy")
    }

    // MARK: - Code helpers

    func testGenerateCodeEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.generateCode(
                pcPeerId: "pc", prompt: "add function",
                language: "Swift", framework: "SwiftUI"
            )
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["language"] as? String, "Swift")
        XCTAssertEqual(params["framework"] as? String, "SwiftUI")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "code": "func add(a: Int, b: Int) -> Int { a + b }",
            "language": "Swift", "framework": "SwiftUI"
        ])
        let r = try await task.value
        XCTAssertTrue(r.code.contains("func add"))
        XCTAssertEqual(r.language, "Swift")
    }

    func testExplainCodeDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.explainCode(pcPeerId: "pc", code: "x = 1", language: "JS")
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "explanation": "Assigns 1 to x.", "language": "JS"
        ])
        let r = try await task.value
        XCTAssertEqual(r.explanation, "Assigns 1 to x.")
    }

    func testRefactorCodeIncludesInstructions() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.refactorCode(
                pcPeerId: "pc", code: "var x = 1",
                language: "Swift", instructions: "Use let"
            )
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual((p["params"] as! [String: Any])["instructions"] as? String, "Use let")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "refactoredCode": "let x = 1", "language": "Swift", "instructions": "Use let"
        ])
        let r = try await task.value
        XCTAssertEqual(r.refactoredCode, "let x = 1")
    }

    func testFixCodeMissingErrorThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.fixCode(pcPeerId: "pc", code: "x", error: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testFixCodeDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.fixCode(
                pcPeerId: "pc", code: "x.foo()",
                error: "x undefined", language: "JS"
            )
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "fixedCode": "if (x) x.foo();", "language": "JS", "error": "x undefined"
        ])
        let r = try await task.value
        XCTAssertEqual(r.fixedCode, "if (x) x.foo();")
    }

    // MARK: - Agents

    func testListAgentsAvailableTrue() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listAgents(pcPeerId: "pc") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "agents": [
                ["id": "a1", "name": "Summarizer"],
                ["id": "a2", "name": "Translator"]
            ],
            "total": 2, "available": true
        ])
        let r = try await task.value
        XCTAssertTrue(r.available)
        XCTAssertEqual(r.agents.count, 2)
        XCTAssertEqual(r.agents[0].name, "Summarizer")
    }

    func testListAgentsAvailableFalse() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listAgents(pcPeerId: "pc") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["agents": [], "total": 0, "available": false])
        let r = try await task.value
        XCTAssertFalse(r.available)
        XCTAssertEqual(r.agents.count, 0)
    }

    func testGetAgentDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getAgent(pcPeerId: "pc", agentId: "abc") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "agent": ["id": "abc", "name": "Helper", "description": "Does things"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.agent.id, "abc")
        XCTAssertEqual(r.agent.description, "Does things")
    }

    func testRunAgentEmptyInputOk() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.runAgent(pcPeerId: "pc", agentId: "a1", input: "")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual((p["params"] as! [String: Any])["input"] as? String, "")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "agentId": "a1", "runId": "run-1", "status": "running"
        ])
        let r = try await task.value
        XCTAssertEqual(r.runId, "run-1")
    }

    func testStopAgentMissingBothThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.stopAgent(pcPeerId: "pc")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testStopAgentWithRunId() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.stopAgent(pcPeerId: "pc", runId: "run-1") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "runId": "run-1", "stopped": true
        ])
        let r = try await task.value
        XCTAssertTrue(r.stopped)
    }
}
