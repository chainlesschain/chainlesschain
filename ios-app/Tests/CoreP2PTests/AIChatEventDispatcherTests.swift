import XCTest
import Combine
@testable import CoreP2P

/// Phase 5.2 — `AIChatEventDispatcher` 测试。
///
/// 11 tests per Phase 5 设计 §6.2 (≥10 target)：
/// 1. 单 stream 顺序累积
/// 2. 多 stream 并发隔离
/// 3. LRU 复合 key dedup（同 streamId 同 chunkIdx 第二次 silent drop）
/// 4. out-of-order chunks reorder 正确（per §7.1 trap）
/// 5. 非 ai.chat.* event silent drop
/// 6. malformed envelope silent drop
/// 7. end event → completedStreams + streamingMessages = finalText
/// 8. error event → streamErrors emit
/// 9. discardStream 清 buffer + 3 字典
/// 10. start/stop idempotent
/// 11. @Published streamingMessages Combine emit
@MainActor
final class AIChatEventDispatcherTests: XCTestCase {

    // MARK: - Test harness

    private final class EventChannel {
        let stream: AsyncStream<String>
        let continuation: AsyncStream<String>.Continuation
        init() {
            var local: AsyncStream<String>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(128)) { c in local = c }
            self.continuation = local
        }
        func send(_ raw: String) { continuation.yield(raw) }
    }

    private struct Setup {
        let dispatcher: AIChatEventDispatcher
        let channel: EventChannel
    }

    private func makeSetup() -> Setup {
        let channel = EventChannel()
        let dispatcher = AIChatEventDispatcher(eventStream: channel.stream)
        return Setup(dispatcher: dispatcher, channel: channel)
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

    private func endEnvelope(streamId: String, finalText: String, messageId: String = "m-1", finishReason: String = "stop") -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:event",
            "payload": [
                "event": "ai.chat.end",
                "streamId": streamId,
                "finishReason": finishReason,
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

    /// 1. 单 stream 顺序累积
    func testSingleStreamSequentialAccumulate() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(deltaEnvelope(streamId: "s1", content: "Hello", chunkIdx: 0))
        s.channel.send(deltaEnvelope(streamId: "s1", content: ", ", chunkIdx: 1))
        s.channel.send(deltaEnvelope(streamId: "s1", content: "world", chunkIdx: 2))
        try await Task.sleep(nanoseconds: 150_000_000)

        XCTAssertEqual(s.dispatcher.streamingMessages["s1"], "Hello, world")
        XCTAssertEqual(s.dispatcher._testBuffer(streamId: "s1")?.nextExpectedIdx, 3)
        XCTAssertEqual(s.dispatcher._testBuffer(streamId: "s1")?.pendingChunks.count, 0)
    }

    /// 2. 多 stream 并发隔离 — A B 交错喂 chunks，各自 buffer 独立
    func testMultiStreamConcurrentIsolation() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        // 交错：A0 B0 A1 B1 A2 B2
        s.channel.send(deltaEnvelope(streamId: "A", content: "alpha-0 ", chunkIdx: 0))
        s.channel.send(deltaEnvelope(streamId: "B", content: "beta-0 ", chunkIdx: 0))
        s.channel.send(deltaEnvelope(streamId: "A", content: "alpha-1 ", chunkIdx: 1))
        s.channel.send(deltaEnvelope(streamId: "B", content: "beta-1 ", chunkIdx: 1))
        s.channel.send(deltaEnvelope(streamId: "A", content: "alpha-2", chunkIdx: 2))
        s.channel.send(deltaEnvelope(streamId: "B", content: "beta-2", chunkIdx: 2))
        try await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertEqual(s.dispatcher.streamingMessages["A"], "alpha-0 alpha-1 alpha-2")
        XCTAssertEqual(s.dispatcher.streamingMessages["B"], "beta-0 beta-1 beta-2")
        XCTAssertEqual(s.dispatcher.streamingMessages.count, 2)
    }

    /// 3. LRU 复合 key dedup — 同 (streamId, chunkIdx) 第二次 silent drop
    ///    + 跨 streamId 同 chunkIdx 不互相 evict（验复合 key 设计）
    func testLruDedupCompositeKey() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        // (s1, 0) 与 (s2, 0) chunkIdx 一样但 streamId 不同 — 都应处理
        s.channel.send(deltaEnvelope(streamId: "s1", content: "X", chunkIdx: 0))
        s.channel.send(deltaEnvelope(streamId: "s2", content: "Y", chunkIdx: 0))
        // 再发 (s1, 0) — 应被 LRU dedup silent drop
        s.channel.send(deltaEnvelope(streamId: "s1", content: "Z", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 150_000_000)

        XCTAssertEqual(s.dispatcher.streamingMessages["s1"], "X", "重复 chunk 第二次 silent drop")
        XCTAssertEqual(s.dispatcher.streamingMessages["s2"], "Y", "跨 stream 同 chunkIdx 不互相 evict")
        XCTAssertTrue(s.dispatcher._testHasSeenChunk(streamId: "s1", chunkIdx: 0))
        XCTAssertTrue(s.dispatcher._testHasSeenChunk(streamId: "s2", chunkIdx: 0))
    }

    /// 4. out-of-order chunks reorder (§7.1) — 喂 0 2 1 3 应累出连续文本
    func testOutOfOrderChunksReorder() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(deltaEnvelope(streamId: "s1", content: "A", chunkIdx: 0))
        s.channel.send(deltaEnvelope(streamId: "s1", content: "C", chunkIdx: 2))  // 乱序
        try await Task.sleep(nanoseconds: 100_000_000)

        // 此时 1 还没到，streamingMessages 应只到 A
        XCTAssertEqual(s.dispatcher.streamingMessages["s1"], "A")
        XCTAssertEqual(s.dispatcher._testBuffer(streamId: "s1")?.pendingChunks[2], "C")

        // 喂 chunk 1 — 应触发消化 1 + 2
        s.channel.send(deltaEnvelope(streamId: "s1", content: "B", chunkIdx: 1))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.dispatcher.streamingMessages["s1"], "ABC")
        XCTAssertEqual(s.dispatcher._testBuffer(streamId: "s1")?.nextExpectedIdx, 3)
        XCTAssertEqual(s.dispatcher._testBuffer(streamId: "s1")?.pendingChunks.count, 0)

        // 继续喂 3 — 直接 append
        s.channel.send(deltaEnvelope(streamId: "s1", content: "D", chunkIdx: 3))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.dispatcher.streamingMessages["s1"], "ABCD")
    }

    /// 5. 非 ai.chat.* event silent drop
    func testNonAiChatEventSilentDrop() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        // notification.received — 不是 ai.chat 系列
        let notifEvent = #"{"type":"chainlesschain:event","payload":{"event":"notification.received","notificationId":"n1","title":"t","body":"b","timestamp":0}}"#
        s.channel.send(notifEvent)
        // terminal.stdout
        let termEvent = #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s","data":"x","seq":1}}"#
        s.channel.send(termEvent)
        // command response
        let cmdResp = #"{"type":"chainlesschain:command:response","payload":{"id":"x","result":{}}}"#
        s.channel.send(cmdResp)
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.dispatcher.streamingMessages.count, 0)
        XCTAssertEqual(s.dispatcher.completedStreams.count, 0)
        XCTAssertEqual(s.dispatcher.streamErrors.count, 0)
    }

    /// 6. malformed envelope silent drop（不 crash dispatcher 流）
    func testMalformedEnvelopeSilentDrop() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send("not a json")
        s.channel.send("{}")
        s.channel.send(#"{"type":"chainlesschain:event"}"#)  // 缺 payload
        s.channel.send(#"{"type":"chainlesschain:event","payload":{"event":"ai.chat.delta"}}"#)  // 缺 streamId
        // 然后送一条有效 — dispatcher 仍工作
        s.channel.send(deltaEnvelope(streamId: "after-malformed", content: "ok", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertEqual(s.dispatcher.streamingMessages["after-malformed"], "ok")
    }

    /// 7. end event → completedStreams + streamingMessages 用 finalText 覆盖
    func testEndEventCompletesStream() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(deltaEnvelope(streamId: "s1", content: "Hello", chunkIdx: 0))
        s.channel.send(deltaEnvelope(streamId: "s1", content: " world", chunkIdx: 1))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.dispatcher.streamingMessages["s1"], "Hello world")
        XCTAssertNil(s.dispatcher.completedStreams["s1"])

        s.channel.send(endEnvelope(streamId: "s1", finalText: "Hello world.", messageId: "m-99"))
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.dispatcher.streamingMessages["s1"], "Hello world.", "finalText 覆盖本地累积")
        XCTAssertNotNil(s.dispatcher.completedStreams["s1"])
        XCTAssertEqual(s.dispatcher.completedStreams["s1"]?.messageId, "m-99")
        XCTAssertEqual(s.dispatcher.completedStreams["s1"]?.finishReason, "stop")
        XCTAssertTrue(s.dispatcher._testBuffer(streamId: "s1")?.isComplete ?? false)
    }

    /// 8. error event → streamErrors emit
    func testErrorEventEmitsError() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(deltaEnvelope(streamId: "s1", content: "partial", chunkIdx: 0))
        s.channel.send(errorEnvelope(streamId: "s1", error: "LLM provider timeout"))
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(s.dispatcher.streamErrors["s1"], "LLM provider timeout")
        XCTAssertEqual(s.dispatcher._testBuffer(streamId: "s1")?.error, "LLM provider timeout")
        // 累积文字保留（VM 可决定显示或丢弃）
        XCTAssertEqual(s.dispatcher.streamingMessages["s1"], "partial")
    }

    /// 9. discardStream 清 buffer + 3 字典 (§7.3 cancel 顺序保证)
    func testDiscardStreamCleansAll() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(deltaEnvelope(streamId: "s1", content: "X", chunkIdx: 0))
        s.channel.send(errorEnvelope(streamId: "s1", error: "oops"))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertNotNil(s.dispatcher.streamingMessages["s1"])
        XCTAssertNotNil(s.dispatcher.streamErrors["s1"])
        XCTAssertNotNil(s.dispatcher._testBuffer(streamId: "s1"))

        s.dispatcher.discardStream(streamId: "s1")
        XCTAssertNil(s.dispatcher.streamingMessages["s1"])
        XCTAssertNil(s.dispatcher.streamErrors["s1"])
        XCTAssertNil(s.dispatcher.completedStreams["s1"])
        XCTAssertNil(s.dispatcher._testBuffer(streamId: "s1"))

        // 但 LRU `seenChunks` 不清 — 验防御性 drop in §7.3
        XCTAssertTrue(s.dispatcher._testHasSeenChunk(streamId: "s1", chunkIdx: 0))
    }

    /// 10. start/stop idempotent
    func testStartStopIdempotent() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        s.dispatcher.start()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(deltaEnvelope(streamId: "idem1", content: "once", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.dispatcher.streamingMessages["idem1"], "once")

        s.dispatcher.stop()
        s.dispatcher.stop()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        s.channel.send(deltaEnvelope(streamId: "idem2", content: "twice", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(s.dispatcher.streamingMessages["idem2"], "twice")
    }

    /// 11. @Published streamingMessages Combine emit — 验 SwiftUI 订阅模式
    func testStreamingMessagesPublisherEmits() async throws {
        let s = makeSetup()
        s.dispatcher.start()
        try await Task.sleep(nanoseconds: 30_000_000)

        var emissions: [[String: String]] = []
        let cancellable = s.dispatcher.$streamingMessages
            .sink { value in emissions.append(value) }

        s.channel.send(deltaEnvelope(streamId: "pub", content: "1st", chunkIdx: 0))
        try await Task.sleep(nanoseconds: 100_000_000)
        s.channel.send(deltaEnvelope(streamId: "pub", content: " 2nd", chunkIdx: 1))
        try await Task.sleep(nanoseconds: 100_000_000)

        cancellable.cancel()

        // 初始空 dict + 2 次更新
        XCTAssertGreaterThanOrEqual(emissions.count, 3)
        XCTAssertEqual(emissions.last?["pub"], "1st 2nd")
    }
}
