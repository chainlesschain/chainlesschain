import XCTest
@testable import CoreP2P

/// Phase 5.1 — `AIChatCommands` typed wrapper 测试。
///
/// 12 tests = 8 method × 1 happy + 4 error path（empty arg / remote error /
/// malformed result / timeout）。harness 复用 NotificationCommandsTests 模式
/// (FakeTransport + InboundChannel + RemoteCommandClient real instance)。
final class AIChatCommandsTests: XCTestCase {

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
        let cmds: AIChatCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "aichat-\(UUID())")!),
            responseTimeoutSeconds: responseTimeoutSeconds
        )
        await client.start()
        let cmds = AIChatCommands(client: client)
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

    // MARK: - chat

    func testChatHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.chat(
                pcPeerId: "pc",
                message: "你好",
                conversationId: "c-1",
                model: "gpt-4",
                temperature: 0.7,
                mobileDid: "did:cc:m"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.chat")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["message"] as? String, "你好")
        XCTAssertEqual(params["conversationId"] as? String, "c-1")
        XCTAssertEqual(params["model"] as? String, "gpt-4")
        XCTAssertEqual(params["temperature"] as? Double, 0.7)

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "response": "你好！有什么可以帮你?",
            "conversationId": "c-1",
            "messageId": "m-42",
            "modelUsed": "gpt-4"
        ]))
        let result = try await task.value
        XCTAssertTrue(result.success)
        XCTAssertEqual(result.response, "你好！有什么可以帮你?")
        XCTAssertEqual(result.messageId, "m-42")
        XCTAssertEqual(result.modelUsed, "gpt-4")
    }

    func testChatEmptyMessageThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.chat(pcPeerId: "pc", message: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
        XCTAssertEqual(s.transport.dcSent.count, 0)
    }

    // MARK: - chatStream

    func testChatStreamHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.chatStream(
                pcPeerId: "pc",
                message: "讲个故事",
                conversationId: "c-1",
                systemPrompt: "Be concise"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.chatStream")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["message"] as? String, "讲个故事")
        XCTAssertEqual(params["systemPrompt"] as? String, "Be concise")
        XCTAssertNil(params["model"])

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "streamId": "stream-abc",
            "conversationId": "c-1"
        ]))
        let result = try await task.value
        XCTAssertTrue(result.success)
        XCTAssertEqual(result.streamId, "stream-abc")
        XCTAssertEqual(result.conversationId, "c-1")
    }

    // MARK: - getStreamChunk

    func testGetStreamChunkHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStreamChunk(pcPeerId: "pc", streamId: "stream-1", sinceChunk: 5) }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.getStreamChunk")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["streamId"] as? String, "stream-1")
        XCTAssertEqual(params["sinceChunk"] as? Int, 5)

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "chunks": ["alpha", "beta"],
            "isComplete": false,
            "nextChunkIdx": 7
        ]))
        let result = try await task.value
        XCTAssertEqual(result.chunks, ["alpha", "beta"])
        XCTAssertFalse(result.isComplete)
        XCTAssertEqual(result.nextChunkIdx, 7)
    }

    // MARK: - cancelStream

    func testCancelStreamHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.cancelStream(pcPeerId: "pc", streamId: "stream-1") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.cancelStream")
        XCTAssertEqual(try paramsFrom(raw)["streamId"] as? String, "stream-1")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["success": true, "cancelled": true]))
        let result = try await task.value
        XCTAssertTrue(result.cancelled)
    }

    func testCancelStreamEmptyIdThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.cancelStream(pcPeerId: "pc", streamId: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    // MARK: - getConversations

    func testGetConversationsHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getConversations(pcPeerId: "pc", limit: 20, offset: 0, keyword: "brain") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.getConversations")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["limit"] as? Int, 20)
        XCTAssertEqual(params["keyword"] as? String, "brain")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "conversations": [
                [
                    "id": "c-1", "title": "Brainstorm",
                    "model": "gpt-4", "messageCount": 10,
                    "lastMessageAt": 1715760001000,
                    "createdAt": 1715760000000,
                    "archived": false
                ],
                [
                    "id": "c-2", "title": "Untitled",
                    "messageCount": 0, "createdAt": 1715760002000
                ]
            ],
            "total": 2
        ]))
        let result = try await task.value
        XCTAssertEqual(result.conversations.count, 2)
        XCTAssertEqual(result.conversations[0].id, "c-1")
        XCTAssertEqual(result.conversations[0].messageCount, 10)
        XCTAssertEqual(result.conversations[1].messageCount, 0)
        XCTAssertEqual(result.total, 2)
    }

    // MARK: - getConversation

    func testGetConversationHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getConversation(pcPeerId: "pc", conversationId: "c-1") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.getConversation")
        XCTAssertEqual(try paramsFrom(raw)["conversationId"] as? String, "c-1")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "conversation": [
                "id": "c-1", "title": "Brain", "createdAt": 1715760000000
            ]
        ]))
        let result = try await task.value
        XCTAssertEqual(result.conversation?.id, "c-1")
        XCTAssertEqual(result.conversation?.title, "Brain")
    }

    // MARK: - createConversation

    func testCreateConversationHappyPath() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.createConversation(pcPeerId: "pc", title: "New session", model: "gpt-4")
        }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.createConversation")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["title"] as? String, "New session")
        XCTAssertEqual(params["model"] as? String, "gpt-4")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "conversationId": "c-99",
            "conversation": [
                "id": "c-99", "title": "New session",
                "model": "gpt-4", "createdAt": 1715760000000
            ]
        ]))
        let result = try await task.value
        XCTAssertEqual(result.conversationId, "c-99")
        XCTAssertEqual(result.conversation?.title, "New session")
    }

    // MARK: - deleteConversation

    func testDeleteConversationHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.deleteConversation(pcPeerId: "pc", conversationId: "c-1") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.deleteConversation")
        XCTAssertEqual(try paramsFrom(raw)["conversationId"] as? String, "c-1")

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: ["success": true]))
        let result = try await task.value
        XCTAssertTrue(result.success)
        XCTAssertNil(result.error)
    }

    // MARK: - getMessages

    func testGetMessagesHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getMessages(pcPeerId: "pc", conversationId: "c-1", limit: 50, offset: 0) }
        try await Task.sleep(nanoseconds: 50_000_000)

        let raw = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(raw), "ai.getMessages")
        let params = try paramsFrom(raw)
        XCTAssertEqual(params["conversationId"] as? String, "c-1")
        XCTAssertEqual(params["limit"] as? Int, 50)

        let id = try reqIdFrom(raw)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "messages": [
                ["id": "m-1", "role": "user", "content": "Hi", "createdAt": 1715760000000],
                ["id": "m-2", "role": "assistant", "content": "Hello!", "createdAt": 1715760001000, "modelUsed": "gpt-4"]
            ],
            "total": 2
        ]))
        let result = try await task.value
        XCTAssertEqual(result.messages.count, 2)
        XCTAssertEqual(result.messages[0].role, .user)
        XCTAssertEqual(result.messages[1].role, .assistant)
        XCTAssertEqual(result.messages[1].modelUsed, "gpt-4")
    }

    // MARK: - 错误路径

    func testRemoteErrorResponseTranslated() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.chat(pcPeerId: "pc", message: "hi") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try errorResponseRaw(reqId: id, error: "LLM provider unreachable"))
        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "LLM provider unreachable")
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testMalformedResultThrows() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.chat(pcPeerId: "pc", message: "hi") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let id = try reqIdFrom(s.transport.dcSent[0])
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
            _ = try await s.cmds.chat(pcPeerId: "pc", message: "hi")
            XCTFail("expected throw")
        } catch TerminalRpcError.timeout {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }
}
