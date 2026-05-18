import XCTest
import Combine
@testable import CoreP2P

/// Phase 5.3 — `RemoteAIChatViewModel` 测试。
///
/// 13 tests per Phase 5 设计 §6.3 (≥12 target):
/// 1. loadConversations happy path
/// 2. selectConversation 触发 loadMessages
/// 3. sendMessage 启 chatStream + 设 currentStreamId + 追加 user + 占位 assistant
/// 4. dispatcher 喂 chunks → 占位 assistant content 累积
/// 5. end event → message finalized 用 finalText + isStreamingMessage=false
/// 6. error event → lastError + currentStreamId=nil + 占位 isStreaming=false
/// 7. cancelCurrentStream → discardStream FIRST + cancelStream RPC + 本地收尾
/// 8. createConversation 成功 → conversations 头插 + currentConversation 切
/// 9. deleteConversation 成功 → 列表移除
/// 10. DC 不通 + sendMessage → lastError "需在线" + 无 outbound
/// 11. DC 不通 + createConversation → enqueue OfflineQueue + lastError 提示
/// 12. isLoading 状态机
/// 13. clearError 清 lastError
@MainActor
final class RemoteAIChatViewModelTests: XCTestCase {

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

    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock()
        var dcSent: [String] = []
        var dcReadyValue: Bool = true
        var isDcReady: Bool {
            lock.lock(); defer { lock.unlock() }
            return dcReadyValue
        }
        func setReady(_ v: Bool) {
            lock.lock(); dcReadyValue = v; lock.unlock()
        }
    }

    private struct Setup {
        let vm: RemoteAIChatViewModel
        let inbound: InboundChannel
        let event: EventChannel
        let transport: FakeTransport
        let dispatcher: AIChatEventDispatcher
        let queue: OfflineCommandQueue
    }

    private func makeSetup(responseTimeoutSeconds: UInt64 = 2) async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let event = EventChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.isDcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "vmai-\(UUID())")!),
            responseTimeoutSeconds: responseTimeoutSeconds
        )
        await client.start()
        let cmds = AIChatCommands(client: client)
        let dispatcher = AIChatEventDispatcher(eventStream: event.stream)
        dispatcher.start()
        let queue = OfflineCommandQueue(
            userDefaults: UserDefaults(suiteName: "vmai-q-\(UUID())")!,
            key: "queue", capacity: 100, maxRetries: 3
        )
        let vm = RemoteAIChatViewModel(
            pcPeerId: "pc-1",
            commands: cmds,
            dispatcher: dispatcher,
            offlineQueue: queue,
            isDataChannelReady: { transport.isDcReady },
            currentDIDProvider: { "did:cc:me" }
        )
        return Setup(vm: vm, inbound: inbound, event: event, transport: transport, dispatcher: dispatcher, queue: queue)
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

    private func sampleConversationsJson(ids: [String] = ["c-1", "c-2"]) -> [String: Any] {
        let list = ids.map { id in
            [
                "id": id, "title": "title-\(id)",
                "messageCount": 5,
                "createdAt": 1_715_760_000_000
            ] as [String: Any]
        }
        return ["success": true, "conversations": list, "total": list.count]
    }

    private func deltaEnvelope(streamId: String, content: String, chunkIdx: Int) -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:event",
            "payload": [
                "event": "ai.chat.delta",
                "streamId": streamId,
                "content": content,
                "chunkIdx": chunkIdx
            ]
        ]
        return String(data: try! JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func endEnvelope(streamId: String, finalText: String, messageId: String = "m-final") -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:event",
            "payload": [
                "event": "ai.chat.end",
                "streamId": streamId,
                "finishReason": "stop",
                "finalText": finalText,
                "messageId": messageId
            ]
        ]
        return String(data: try! JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func errorEnvelope(streamId: String, error: String) -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:event",
            "payload": [
                "event": "ai.chat.error",
                "streamId": streamId,
                "error": error
            ]
        ]
        return String(data: try! JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    // MARK: - Tests

    /// 1. loadConversations happy path
    func testLoadConversationsHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(s.vm.isLoading)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: sampleConversationsJson()))
        await task.value

        XCTAssertEqual(s.vm.conversations.count, 2)
        XCTAssertEqual(s.vm.conversations[0].id, "c-1")
        XCTAssertFalse(s.vm.isLoading)
        XCTAssertNil(s.vm.lastError)
    }

    /// 2. selectConversation 触发 loadMessages
    func testSelectConversationTriggersLoadMessages() async throws {
        let s = await makeSetup()
        // 先 load 让 conversations 有数据
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: sampleConversationsJson()))
        await loadTask.value

        // selectConversation
        let selTask = Task { await s.vm.selectConversation(id: "c-1") }
        try await Task.sleep(nanoseconds: 50_000_000)

        // 第 2 个 outbound 应是 ai.getMessages
        XCTAssertEqual(try methodFrom(s.transport.dcSent[1]), "ai.getMessages")
        let getId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: getId, result: [
            "success": true,
            "messages": [
                ["id": "m-1", "role": "user", "content": "Hi", "createdAt": 1_715_760_000_000]
            ],
            "total": 1
        ]))
        await selTask.value

        XCTAssertEqual(s.vm.currentConversation?.id, "c-1")
        XCTAssertEqual(s.vm.messages.count, 1)
        XCTAssertEqual(s.vm.messages[0].role, .user)
    }

    /// 3. sendMessage 启 chatStream + 设 currentStreamId + 追加占位
    func testSendMessageStartsStream() async throws {
        let s = await makeSetup()
        // 准备 currentConversation
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: sampleConversationsJson()))
        await loadTask.value

        let selTask = Task { await s.vm.selectConversation(id: "c-1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let getMsgsId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: getMsgsId, result: ["success": true, "messages": [], "total": 0]))
        await selTask.value

        s.vm.inputDraft = "讲个故事"
        let sendTask = Task { await s.vm.sendMessage() }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[2]), "ai.chatStream")
        XCTAssertEqual(s.vm.messages.count, 2, "user msg + 占位 assistant msg")
        XCTAssertEqual(s.vm.messages[0].role, .user)
        XCTAssertEqual(s.vm.messages[0].content, "讲个故事")
        XCTAssertEqual(s.vm.messages[1].role, .assistant)
        XCTAssertEqual(s.vm.messages[1].content, "")
        XCTAssertTrue(s.vm.messages[1].isStreaming)
        XCTAssertEqual(s.vm.inputDraft, "", "inputDraft 发送后清空")

        let sendId = try reqIdFrom(s.transport.dcSent[2])
        s.inbound.send(try responseRaw(reqId: sendId, result: [
            "success": true, "streamId": "stream-abc", "conversationId": "c-1"
        ]))
        await sendTask.value

        XCTAssertEqual(s.vm.currentStreamId, "stream-abc")
        XCTAssertTrue(s.vm.isStreamingMessage)
    }

    /// 4. dispatcher 喂 chunks → 占位 content 累积
    func testStreamingChunksAccumulateInPlaceholder() async throws {
        let s = await makeSetup()
        await setupCurrentStream(s, streamId: "s-acc")

        s.event.send(deltaEnvelope(streamId: "s-acc", content: "Once ", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.messages.last?.content, "Once ")
        XCTAssertTrue(s.vm.messages.last?.isStreaming ?? false)

        s.event.send(deltaEnvelope(streamId: "s-acc", content: "upon a ", chunkIdx: 1))
        s.event.send(deltaEnvelope(streamId: "s-acc", content: "time.", chunkIdx: 2))
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(s.vm.messages.last?.content, "Once upon a time.")
    }

    /// 5. end event → message finalized 用 finalText + isStreamingMessage=false
    func testEndEventFinalizesMessage() async throws {
        let s = await makeSetup()
        await setupCurrentStream(s, streamId: "s-end")

        s.event.send(deltaEnvelope(streamId: "s-end", content: "partial", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)

        s.event.send(endEnvelope(streamId: "s-end", finalText: "Final canonical answer.", messageId: "srv-99"))
        try await Task.sleep(nanoseconds: 150_000_000)

        XCTAssertEqual(s.vm.messages.last?.content, "Final canonical answer.", "finalText 覆盖")
        XCTAssertEqual(s.vm.messages.last?.id, "srv-99", "msg id 切到 server id")
        XCTAssertFalse(s.vm.messages.last?.isStreaming ?? true)
        XCTAssertNil(s.vm.currentStreamId)
        XCTAssertFalse(s.vm.isStreamingMessage)
    }

    /// 6. error event → lastError + currentStreamId=nil + 占位 isStreaming=false
    func testErrorEventStopsStream() async throws {
        let s = await makeSetup()
        await setupCurrentStream(s, streamId: "s-err")

        s.event.send(deltaEnvelope(streamId: "s-err", content: "partial", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)

        s.event.send(errorEnvelope(streamId: "s-err", error: "LLM provider timeout"))
        try await Task.sleep(nanoseconds: 150_000_000)

        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("LLM provider timeout") ?? false)
        XCTAssertNil(s.vm.currentStreamId)
        XCTAssertFalse(s.vm.isStreamingMessage)
        XCTAssertFalse(s.vm.messages.last?.isStreaming ?? true)
        XCTAssertEqual(s.vm.messages.last?.content, "partial", "保留部分累积")
    }

    /// 7. cancelCurrentStream → discardStream FIRST + cancelStream RPC + 本地收尾
    func testCancelCurrentStreamOrderInvariant() async throws {
        let s = await makeSetup()
        await setupCurrentStream(s, streamId: "s-cancel")

        s.event.send(deltaEnvelope(streamId: "s-cancel", content: "partial", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.messages.last?.content, "partial")

        let dcSentBefore = s.transport.dcSent.count
        let cancelTask = Task { await s.vm.cancelCurrentStream() }
        try await Task.sleep(nanoseconds: 50_000_000)

        // 本地立即收尾（不等 RPC 响应）
        XCTAssertNil(s.vm.currentStreamId)
        XCTAssertFalse(s.vm.isStreamingMessage)
        XCTAssertFalse(s.vm.messages.last?.isStreaming ?? true)
        XCTAssertNil(s.dispatcher._testBuffer(streamId: "s-cancel"), "buffer 已 discard")

        // RPC outbound 一笔
        XCTAssertEqual(s.transport.dcSent.count, dcSentBefore + 1)
        XCTAssertEqual(try methodFrom(s.transport.dcSent.last!), "ai.cancelStream")
        let cancelId = try reqIdFrom(s.transport.dcSent.last!)
        s.inbound.send(try responseRaw(reqId: cancelId, result: ["success": true, "cancelled": true]))
        await cancelTask.value

        // 后续 chunks 喂进去也不影响（buffer 没了，state 也没了）
        s.event.send(deltaEnvelope(streamId: "s-cancel", content: "late", chunkIdx: 1))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.messages.last?.content, "partial", "cancel 后 chunk silent")
    }

    /// 8. createConversation 成功 → 列表头插 + currentConversation 切
    func testCreateConversationSuccess() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.createConversation(title: "New chat", model: "gpt-4") }
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(try methodFrom(s.transport.dcSent[0]), "ai.createConversation")
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "conversationId": "c-new",
            "conversation": [
                "id": "c-new", "title": "New chat",
                "model": "gpt-4", "createdAt": 1_715_760_999_000
            ]
        ]))
        await task.value

        XCTAssertEqual(s.vm.conversations.count, 1)
        XCTAssertEqual(s.vm.conversations[0].id, "c-new")
        XCTAssertEqual(s.vm.currentConversation?.id, "c-new")
        XCTAssertEqual(s.vm.messages.count, 0)
    }

    /// 9. deleteConversation 成功 → 列表移除
    func testDeleteConversationSuccess() async throws {
        let s = await makeSetup()
        // load 先填 conversations
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: sampleConversationsJson(ids: ["a", "b", "c"])))
        await loadTask.value
        XCTAssertEqual(s.vm.conversations.count, 3)

        // delete b
        let delTask = Task { await s.vm.deleteConversation(id: "b") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let delId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: delId, result: ["success": true]))
        await delTask.value

        XCTAssertEqual(s.vm.conversations.map { $0.id }, ["a", "c"])
    }

    /// 10. DC 不通 + sendMessage → lastError "需在线" + 无 outbound
    func testSendMessageDcDownReportsErrorNoEnqueue() async throws {
        let s = await makeSetup()
        // 先准备 currentConversation
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: sampleConversationsJson(ids: ["c-1"])))
        await loadTask.value

        let selTask = Task { await s.vm.selectConversation(id: "c-1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let getMsgsId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: getMsgsId, result: ["success": true, "messages": [], "total": 0]))
        await selTask.value

        // 切 DC 不通
        s.transport.setReady(false)
        let outboundCount = s.transport.dcSent.count

        s.vm.inputDraft = "Hi"
        await s.vm.sendMessage()

        XCTAssertEqual(s.transport.dcSent.count, outboundCount, "无新 outbound — sendMessage gate 前置 check")
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("需在线") ?? false)
        XCTAssertEqual(s.vm.messages.count, 0, "占位 msg 不应追加")
        let queueSize = await s.queue.totalCount()
        XCTAssertEqual(queueSize, 0, "chatStream 不能 enqueue")
    }

    /// 11. DC 不通 + createConversation → enqueue OfflineQueue
    func testCreateConversationDcDownEnqueues() async throws {
        let s = await makeSetup()
        s.transport.setReady(false)

        await s.vm.createConversation(title: "Offline new")

        XCTAssertEqual(s.transport.dcSent.count, 0, "无 outbound")
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("离线队列") ?? false)
        let queue = await s.queue.all()
        XCTAssertEqual(queue.count, 1)
        XCTAssertEqual(queue[0].method, "ai.createConversation")
    }

    /// 12. isLoading 状态机 — loadConversations 中 true, 完成后 false
    func testIsLoadingStateMachine() async throws {
        let s = await makeSetup()
        XCTAssertFalse(s.vm.isLoading, "初始 false")

        let task = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertTrue(s.vm.isLoading, "loadConversations 中 true")

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: sampleConversationsJson()))
        await task.value
        XCTAssertFalse(s.vm.isLoading, "完成后 false")
    }

    /// 13. clearError 清 lastError
    func testClearErrorClearsLastError() async {
        let s = await makeSetup()
        s.transport.setReady(false)
        await s.vm.createConversation(title: "x")
        XCTAssertNotNil(s.vm.lastError)

        s.vm.clearError()
        XCTAssertNil(s.vm.lastError)
    }

    // MARK: - Audit Bug Fixes (Phase 5.7 收口)

    /// 14. Bug #1：server end event with empty messageId 不应清掉本地 id。
    /// `finalizeStreamingPlaceholder` 用 isEmpty guard 而非 nil-coalesce。
    func testEndEventEmptyMessageIdPreservesLocalId() async throws {
        let s = await makeSetup()
        await setupCurrentStream(s, streamId: "s-emptyid")

        let localId = s.vm.messages.last?.id ?? ""
        XCTAssertTrue(localId.hasPrefix("local-assistant-"))

        s.event.send(deltaEnvelope(streamId: "s-emptyid", content: "partial", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)

        // 模拟桌面端 end event 没带 messageId（decode 时填 ""）
        let endRaw = #"""
        {"type":"chainlesschain:event","payload":{"event":"ai.chat.end","streamId":"s-emptyid","finishReason":"stop","finalText":"Final","messageId":""}}
        """#
        s.event.send(endRaw)
        try await Task.sleep(nanoseconds: 150_000_000)

        XCTAssertEqual(s.vm.messages.last?.content, "Final")
        XCTAssertEqual(s.vm.messages.last?.id, localId, "空 messageId 不应覆盖本地 id（SwiftUI ForEach 身份保护）")
        XCTAssertFalse(s.vm.messages.last?.isStreaming ?? true)
    }

    /// 15. Bug #2：deleteConversation 失败时全量回滚 conversations + currentConversation + messages。
    func testDeleteConversationFailureFullRollback() async throws {
        let s = await makeSetup()
        // load 2 conv + 选中第 1 个 + 拉 messages
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: sampleConversationsJson(ids: ["a", "b"])))
        await loadTask.value

        let selTask = Task { await s.vm.selectConversation(id: "a") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let getMsgsId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: getMsgsId, result: [
            "success": true,
            "messages": [
                ["id": "m-1", "role": "user", "content": "msg1", "createdAt": 1_715_760_000_000],
                ["id": "m-2", "role": "assistant", "content": "reply", "createdAt": 1_715_760_001_000]
            ],
            "total": 2
        ]))
        await selTask.value

        XCTAssertEqual(s.vm.currentConversation?.id, "a")
        XCTAssertEqual(s.vm.messages.count, 2)
        let originalCount = s.vm.conversations.count
        let originalMsgs = s.vm.messages

        // delete current conv "a" → 桌面端返 error
        let delTask = Task { await s.vm.deleteConversation(id: "a") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let delId = try reqIdFrom(s.transport.dcSent[2])
        s.inbound.send(try errorResponseRaw(reqId: delId, error: "permission denied"))
        await delTask.value

        XCTAssertEqual(s.vm.conversations.count, originalCount, "conversations 完全回滚")
        XCTAssertEqual(s.vm.conversations.first?.id, "a", "顺序保持")
        XCTAssertEqual(s.vm.currentConversation?.id, "a", "currentConversation 恢复（旧 bug：留 nil）")
        XCTAssertEqual(s.vm.messages.count, originalMsgs.count, "messages 恢复（旧 bug：留空）")
        XCTAssertEqual(s.vm.messages.map { $0.id }, originalMsgs.map { $0.id })
        XCTAssertNotNil(s.vm.lastError)
    }

    /// 16. Bug #3：currentStreamId 非空时 sendMessage 应被防御性拒绝。
    func testSendMessageRejectsWhenStreamInFlight() async throws {
        let s = await makeSetup()
        await setupCurrentStream(s, streamId: "s-inflight")
        XCTAssertNotNil(s.vm.currentStreamId)
        let outboundCount = s.transport.dcSent.count

        s.vm.inputDraft = "second prompt"
        await s.vm.sendMessage()

        XCTAssertEqual(s.transport.dcSent.count, outboundCount, "无新 outbound（拒绝在 RPC 前）")
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("当前响应") ?? false, "lastError 提示当前响应未完成: \(s.vm.lastError ?? "nil")")
        XCTAssertEqual(s.vm.inputDraft, "second prompt", "inputDraft 未被清，用户可继续编辑")
    }

    /// 17. Bug #4：selectConversation 主动清 currentStreamId。
    func testSelectConversationClearsCurrentStreamId() async throws {
        let s = await makeSetup()
        await setupCurrentStream(s, streamId: "s-prev")
        XCTAssertEqual(s.vm.currentStreamId, "s-prev")
        XCTAssertTrue(s.vm.isStreamingMessage)

        // load 第 2 个 conv 以便 select 切
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent.last!)
        s.inbound.send(try responseRaw(reqId: loadId, result: sampleConversationsJson(ids: ["c-1", "c-2"])))
        await loadTask.value

        // 切到 c-2 — 应立即清 currentStreamId（不等 loadMessages 完成）
        let selTask = Task { await s.vm.selectConversation(id: "c-2") }
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertNil(s.vm.currentStreamId, "切对话立即清 streamId")
        XCTAssertFalse(s.vm.isStreamingMessage, "stream UI 状态同步清")

        let getMsgsId = try reqIdFrom(s.transport.dcSent.last!)
        s.inbound.send(try responseRaw(reqId: getMsgsId, result: ["success": true, "messages": [], "total": 0]))
        await selTask.value

        // prev stream 的 late delta 不应再影响新 conv messages
        s.event.send(deltaEnvelope(streamId: "s-prev", content: "leaked", chunkIdx: 5))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(s.vm.messages.isEmpty, "新 conv messages 不被 stale stream 污染")
    }

    // MARK: - Test fixture helpers

    /// 把 VM 调到 "已选 conversation + 已发 chatStream 拿到 streamId" 的状态。
    private func setupCurrentStream(_ s: Setup, streamId: String) async {
        // load conversations
        let loadTask = Task { await s.vm.loadConversations() }
        try? await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try! reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try! responseRaw(reqId: loadId, result: sampleConversationsJson(ids: ["c-1"])))
        await loadTask.value

        // select c-1
        let selTask = Task { await s.vm.selectConversation(id: "c-1") }
        try? await Task.sleep(nanoseconds: 50_000_000)
        let getMsgsId = try! reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try! responseRaw(reqId: getMsgsId, result: ["success": true, "messages": [], "total": 0]))
        await selTask.value

        // sendMessage → chatStream
        s.vm.inputDraft = "Test prompt"
        let sendTask = Task { await s.vm.sendMessage() }
        try? await Task.sleep(nanoseconds: 50_000_000)
        let sendId = try! reqIdFrom(s.transport.dcSent[2])
        s.inbound.send(try! responseRaw(reqId: sendId, result: [
            "success": true, "streamId": streamId, "conversationId": "c-1"
        ]))
        await sendTask.value
    }
}
