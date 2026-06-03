import XCTest
@testable import CoreP2P

/// **iOS Phase 5 集成测试** — AIChat 三组件协同（Commands + Dispatcher + ViewModel）。
///
/// 与 `AIChatCommandsTests` / `AIChatEventDispatcherTests` / `RemoteAIChatViewModelTests`
/// 单元测试**互补**：单测只测单一类的输入输出契约，本套覆盖：
///
/// - RemoteCommandClient.events fan-out → dispatcher 真实订阅链
/// - chatStream RPC 启动 → dispatcher 累积 delta → end → VM finalize 真实全链
/// - cancel 顺序：discardStream FIRST → RPC → 本地收尾（per design §7.3）
///   真 dispatcher buffer 验证而非 mock
/// - offline → DC 恢复 → drainer 触发 createConversation enqueue 兑现
/// - 多 stream 并发（VM 单 currentStreamId 关注 + dispatcher 多 buffer）
///
/// **scope**：仅 fake transport 边界。真 WebRTC / 真桌面 ChatHandler / 真 LLM
/// 留 Phase 5.7 真机 E2E (`docs/design/iOS_Phase_5_AI_Chat_Skill.md` §8.3)。
@MainActor
final class Phase5AIChatIntegrationTests: XCTestCase {

    // MARK: - Shared harness

    private final class InboundChannel {
        let stream: AsyncStream<String>
        let continuation: AsyncStream<String>.Continuation
        init() {
            var local: AsyncStream<String>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(128)) { c in local = c }
            self.continuation = local
        }
        func send(_ raw: String) { continuation.yield(raw) }
    }

    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock()
        var dcSent: [String] = []
        var dcReadyValue: Bool = true
        var isDcReady: Bool { lock.lock(); defer { lock.unlock() }; return dcReadyValue }
        func setReady(_ v: Bool) { lock.lock(); dcReadyValue = v; lock.unlock() }
    }

    /// Full DI: RemoteCommandClient + dispatcher 真实 fan-out + AIChatCommands +
    /// RemoteAIChatViewModel + OfflineCommandQueue。
    private struct Stack {
        let vm: RemoteAIChatViewModel
        let commands: AIChatCommands
        let dispatcher: AIChatEventDispatcher
        let client: RemoteCommandClient
        let queue: OfflineCommandQueue
        let inbound: InboundChannel
        let transport: FakeTransport
        let eventFanoutTask: Task<Void, Never>
    }

    private func makeStack(responseTimeoutSeconds: UInt64 = 2) async -> Stack {
        let transport = FakeTransport()
        let inbound = InboundChannel()

        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.isDcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "p5-int-\(UUID())")!),
            responseTimeoutSeconds: responseTimeoutSeconds
        )
        await client.start()

        // Fan-out task: 真实 RemoteDependencies 启 3 子流；本测只关心 aiChat 子流
        var aiLocal: AsyncStream<String>.Continuation!
        let aiStream = AsyncStream<String>(bufferingPolicy: .bufferingNewest(512)) { c in aiLocal = c }
        let aiContinuation = aiLocal!
        let fanoutTask = Task {
            for await raw in client.events {
                aiContinuation.yield(raw)
            }
            aiContinuation.finish()
        }

        let dispatcher = AIChatEventDispatcher(eventStream: aiStream)
        dispatcher.start()

        let commands = AIChatCommands(client: client)
        let queue = OfflineCommandQueue(
            userDefaults: UserDefaults(suiteName: "p5-int-q-\(UUID())")!,
            key: "queue", capacity: 100, maxRetries: 3
        )

        let vm = RemoteAIChatViewModel(
            pcPeerId: "pc-1",
            commands: commands,
            dispatcher: dispatcher,
            offlineQueue: queue,
            isDataChannelReady: { transport.isDcReady },
            currentDIDProvider: { "did:cc:me" }
        )

        return Stack(
            vm: vm, commands: commands, dispatcher: dispatcher,
            client: client, queue: queue,
            inbound: inbound, transport: transport,
            eventFanoutTask: fanoutTask
        )
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

    private func endEnvelope(streamId: String, finalText: String, messageId: String = "srv-end") -> String {
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

    // MARK: - Test 1: full chat happy path through fan-out

    /// 全链路：sendMessage → RPC → events fan-out 经 client.events → dispatcher
    /// 累积 → VM 占位 msg content 实时更新 → end event → 终态写回 + 服务端 msg id
    func testFullChatStreamHappyPathThroughFanout() async throws {
        let s = await makeStack()
        defer { s.eventFanoutTask.cancel() }

        // 1) 拉对话列表
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: [
            "success": true,
            "conversations": [
                ["id": "c-1", "title": "Brainstorm", "createdAt": 1_715_760_000_000]
            ],
            "total": 1
        ]))
        await loadTask.value

        // 2) select + 拉 messages
        let selTask = Task { await s.vm.selectConversation(id: "c-1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let getMsgsId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: getMsgsId, result: ["success": true, "messages": [], "total": 0]))
        await selTask.value

        // 3) sendMessage → chatStream RPC
        s.vm.inputDraft = "Tell me a joke"
        let sendTask = Task { await s.vm.sendMessage() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let chatId = try reqIdFrom(s.transport.dcSent[2])
        XCTAssertEqual(try methodFrom(s.transport.dcSent[2]), "ai.chatStream")
        s.inbound.send(try responseRaw(reqId: chatId, result: [
            "success": true, "streamId": "stream-joke", "conversationId": "c-1"
        ]))
        await sendTask.value
        XCTAssertEqual(s.vm.currentStreamId, "stream-joke")

        // 4) 通过 inbound 喂 delta events — 经 client.events fan-out 触达 dispatcher
        s.inbound.send(deltaEnvelope(streamId: "stream-joke", content: "Why did ", chunkIdx: 0))
        s.inbound.send(deltaEnvelope(streamId: "stream-joke", content: "the chicken ", chunkIdx: 1))
        s.inbound.send(deltaEnvelope(streamId: "stream-joke", content: "cross the road?", chunkIdx: 2))
        try await Task.sleep(nanoseconds: 250_000_000)

        XCTAssertEqual(s.vm.messages.last?.content, "Why did the chicken cross the road?", "通过真 fan-out 累积")
        XCTAssertTrue(s.vm.messages.last?.isStreaming ?? false)
        XCTAssertNotNil(s.dispatcher._testBuffer(streamId: "stream-joke"), "dispatcher buffer 真存在")

        // 5) end event
        s.inbound.send(endEnvelope(streamId: "stream-joke", finalText: "Why did the chicken cross the road? To get to the other side.", messageId: "srv-msg-42"))
        try await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertEqual(s.vm.messages.last?.content, "Why did the chicken cross the road? To get to the other side.")
        XCTAssertEqual(s.vm.messages.last?.id, "srv-msg-42")
        XCTAssertFalse(s.vm.messages.last?.isStreaming ?? true)
        XCTAssertNil(s.vm.currentStreamId)
        XCTAssertNil(s.dispatcher._testBuffer(streamId: "stream-joke"), "VM finalize 后 discardStream cleanup")
    }

    // MARK: - Test 2: cancel ordering invariant (design §7.3)

    /// cancel 顺序保证：discardStream FIRST → cancelStream RPC → 本地收尾。
    /// 验真 dispatcher 在 RPC 完成前已 buffer 清，late chunk silent drop。
    func testCancelOrderingDiscardBeforeRpc() async throws {
        let s = await makeStack()
        defer { s.eventFanoutTask.cancel() }

        try await primeOneStream(s, streamId: "s-cancel")

        s.inbound.send(deltaEnvelope(streamId: "s-cancel", content: "partial answer", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.messages.last?.content, "partial answer")
        XCTAssertNotNil(s.dispatcher._testBuffer(streamId: "s-cancel"))

        // cancel
        let outboundBefore = s.transport.dcSent.count
        let cancelTask = Task { await s.vm.cancelCurrentStream() }
        // 关键：cancel 内部先 discard 同步执行，再 await RPC；50ms 应足以观察到
        // dispatcher buffer 已清 + 本地状态收尾，但 RPC 仍未响应
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertNil(s.dispatcher._testBuffer(streamId: "s-cancel"), "discardStream 先于 RPC")
        XCTAssertNil(s.vm.currentStreamId)
        XCTAssertFalse(s.vm.isStreamingMessage)
        XCTAssertFalse(s.vm.messages.last?.isStreaming ?? true, "占位 msg 收尾保留部分内容")
        XCTAssertEqual(s.vm.messages.last?.content, "partial answer", "保留 cancel 前累积")
        XCTAssertEqual(s.transport.dcSent.count, outboundBefore + 1, "cancelStream RPC 已出站")

        // late chunk silent drop — buffer 已 nil，LRU 也兜底
        s.inbound.send(deltaEnvelope(streamId: "s-cancel", content: " (leaked)", chunkIdx: 1))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.messages.last?.content, "partial answer", "late chunk 不写入")

        // 桌面端 cancel 响应
        let cancelId = try reqIdFrom(s.transport.dcSent.last!)
        s.inbound.send(try responseRaw(reqId: cancelId, result: ["success": true, "cancelled": true]))
        await cancelTask.value
    }

    // MARK: - Test 3: offline → DC recover → drainer drains createConversation

    /// DC 不通 → createConversation enqueue → 切回 DC → drainer 触发 → 桌面端 RPC 真发出。
    /// 模式同 Phase 3 OfflineCommandQueue 集成测试，验本期新增 ai.* method 真接通 drainer。
    func testOfflineCreateConversationDrainsOnRecover() async throws {
        let s = await makeStack()
        defer { s.eventFanoutTask.cancel() }

        // 起 drainer
        var readyLocal: AsyncStream<Bool>.Continuation!
        let readyStream = AsyncStream<Bool>(bufferingPolicy: .bufferingNewest(8)) { c in readyLocal = c }
        let readyContinuation = readyLocal!
        let drainer = OfflineQueueDrainer(
            queue: s.queue,
            commandClient: s.client,
            pcPeerIdProvider: { "pc-1" },
            dataChannelReadyStream: readyStream
        )
        drainer.start()
        defer { drainer.stop() }

        // DC 不通 → enqueue
        s.transport.setReady(false)
        await s.vm.createConversation(title: "Offline draft", model: "claude-opus-4-7")
        let qSizeAfterEnqueue = await s.queue.totalCount()
        XCTAssertEqual(qSizeAfterEnqueue, 1)
        XCTAssertEqual(s.transport.dcSent.count, 0, "DC down 期间无 outbound")

        // DC 恢复 → drainer 触发
        s.transport.setReady(true)
        readyContinuation.yield(false)
        readyContinuation.yield(true)
        try await Task.sleep(nanoseconds: 250_000_000)

        // outbound 应有一笔 ai.createConversation
        XCTAssertGreaterThanOrEqual(s.transport.dcSent.count, 1)
        let outbound = s.transport.dcSent[0]
        XCTAssertEqual(try methodFrom(outbound), "ai.createConversation", "drainer 真发 ai.createConversation")

        // 桌面端响应 → 队列消费
        let id = try reqIdFrom(outbound)
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true,
            "conversationId": "c-drained",
            "conversation": [
                "id": "c-drained", "title": "Offline draft", "createdAt": 1_715_760_000_000
            ]
        ]))
        try await Task.sleep(nanoseconds: 250_000_000)

        let qSizeAfterDrain = await s.queue.totalCount()
        XCTAssertEqual(qSizeAfterDrain, 0, "drainer 消费成功后队列空")
    }

    // MARK: - Test 4: multi-conversation stream isolation

    /// 用户进 conv A 启 stream sA，切到 conv B → currentStreamId 立即清。
    /// dispatcher 仍 buffer sA chunks（桌面 LLM 持续输出）；sA 的 end 不影响 conv B UI。
    /// 切回 conv A 后 messages 静态（dispatcher buffer 还在但 VM 没自动接管 — per design §7.4）。
    func testCrossConversationStreamIsolation() async throws {
        let s = await makeStack()
        defer { s.eventFanoutTask.cancel() }

        // load 2 conv
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: [
            "success": true,
            "conversations": [
                ["id": "A", "title": "Conv A", "createdAt": 1_715_760_000_000],
                ["id": "B", "title": "Conv B", "createdAt": 1_715_760_001_000]
            ],
            "total": 2
        ]))
        await loadTask.value

        // select A + send + 拿 streamId
        let selA = Task { await s.vm.selectConversation(id: "A") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let getMsgsAId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: getMsgsAId, result: ["success": true, "messages": [], "total": 0]))
        await selA.value

        s.vm.inputDraft = "Hello A"
        let sendTask = Task { await s.vm.sendMessage() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let chatAId = try reqIdFrom(s.transport.dcSent[2])
        s.inbound.send(try responseRaw(reqId: chatAId, result: [
            "success": true, "streamId": "sA", "conversationId": "A"
        ]))
        await sendTask.value
        XCTAssertEqual(s.vm.currentStreamId, "sA")

        // 喂 sA 第 1 chunk
        s.inbound.send(deltaEnvelope(streamId: "sA", content: "From A", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.vm.messages.last?.content, "From A")

        // 切到 conv B — 应清 currentStreamId
        let selB = Task { await s.vm.selectConversation(id: "B") }
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertNil(s.vm.currentStreamId, "切对话立即清")
        XCTAssertFalse(s.vm.isStreamingMessage)

        let getMsgsBId = try reqIdFrom(s.transport.dcSent.last!)
        s.inbound.send(try responseRaw(reqId: getMsgsBId, result: ["success": true, "messages": [], "total": 0]))
        await selB.value

        // sA 继续输出 — 不应影响 conv B
        s.inbound.send(deltaEnvelope(streamId: "sA", content: " (more)", chunkIdx: 1))
        s.inbound.send(endEnvelope(streamId: "sA", finalText: "From A (more) final"))
        try await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertTrue(s.vm.messages.isEmpty, "conv B messages 空 — 不被 sA 污染")
        // dispatcher 内部仍 buffer sA — VM 没自动 finalize（per design §7.4 隔离）
        // dispatcher.completedStreams 可能含 sA，但 VM 因 currentStreamId=nil 不动
    }

    // MARK: - Helpers

    /// 把 stack 调到 "已选 conv c-1 + 已发 chatStream 拿到 streamId" 状态。
    private func primeOneStream(_ s: Stack, streamId: String) async throws {
        let loadTask = Task { await s.vm.loadConversations() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loadId = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: loadId, result: [
            "success": true,
            "conversations": [["id": "c-1", "title": "Primed", "createdAt": 1_715_760_000_000]],
            "total": 1
        ]))
        await loadTask.value

        let selTask = Task { await s.vm.selectConversation(id: "c-1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let getMsgsId = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: getMsgsId, result: ["success": true, "messages": [], "total": 0]))
        await selTask.value

        s.vm.inputDraft = "Primed prompt"
        let sendTask = Task { await s.vm.sendMessage() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let chatId = try reqIdFrom(s.transport.dcSent[2])
        s.inbound.send(try responseRaw(reqId: chatId, result: [
            "success": true, "streamId": streamId, "conversationId": "c-1"
        ]))
        await sendTask.value
    }
}
