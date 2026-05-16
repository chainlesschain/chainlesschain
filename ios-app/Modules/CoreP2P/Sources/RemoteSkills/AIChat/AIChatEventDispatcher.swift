import Foundation
import Combine

// MARK: - StreamBuffer

/// Per-stream 累积状态 — dispatcher 内部，不暴露给 UI。
///
/// `nextExpectedIdx` 起 0；接到 chunkIdx == nextExpectedIdx 时 append 到
/// `accumulatedText` 后 nextExpectedIdx += 1，并循环检查 `pendingChunks[nextExpectedIdx]`
/// 把已到达但因为前面有缺口而等待的 chunk 也消化掉（per Phase 5 设计 §7.1 trap
/// "stream chunk 乱序 + 缺失 chunk 处理"）。
///
/// `isComplete` = true 由 `ai.chat.end` 事件触发。`error` 由 `ai.chat.error` 触发。
struct StreamBuffer: Sendable {
    var accumulatedText: String = ""
    var nextExpectedIdx: Int = 0
    var pendingChunks: [Int: String] = [:]
    var isComplete: Bool = false
    var error: String? = nil
}

// MARK: - AIChatEventDispatcher

/// 订阅 `RemoteCommandClient.events` 流 + filter `ai.chat.delta` / `ai.chat.end`
/// / `ai.chat.error` + LRU dedup + 按 streamId 累积渲染 — Phase 5.2。
///
/// **架构定位**（与 Phase 5 设计 §4.2.2 对齐）：
/// 桌面 LLM 输出 token → ChatHandler 经 DC/signaling 发 envelope →
/// iOS RemoteWebRTCClient.inboundMessages → RemoteCommandClient.handleInbound →
/// events 流 yield → RemoteDependencies fan-out task 第 3 子流
/// (aiChatEventsStream) → **本类**订阅 → parseFromEnvelope → LRU dedup →
/// StreamBuffer 累积 → @Published 通知 VM → SwiftUI bubble 边接边渲。
///
/// **LRU dedup**（per §7.2 trap）：复合 key `"<streamId>|<chunkIdx>"`，capacity
/// 1024（单 stream 通常 <500 chunks，双 stream <1000；不需太长）。防 DC +
/// signaling 双发同一 chunk 重复 append。
///
/// **out-of-order reorder**（per §7.1 trap）：单 stream 内 chunk 可能乱序到达。
/// nextExpectedIdx 追踪下一个连续 idx；接到 K：(a) K == nextExpectedIdx 则
/// append + 推进 + 循环消化 pendingChunks；(b) K > nextExpectedIdx 则缓存到
/// pendingChunks[K] 等待前面 chunk 到达；(c) K < nextExpectedIdx 已经 LRU 兜
/// 住，理论不达 — 防御性 drop。**注意 v0.1 无 30s 缺失 timeout**：若中间某 chunk
/// 永久丢失，stream 会卡在那里直到 end 事件强制 finalize（用 finalText 作为权威）。
///
/// **多 stream 并发隔离**（per §7.4 trap）：streamBuffers 按 streamId 字典隔离；
/// VM 维护 streamId ↔ conversationId 映射。
///
/// **cancel 时机**（per §7.3 trap）：VM cancelCurrentStream 必须顺序 (1)
/// `discardStream(streamId:)` (2) commands.cancelStream() (3) currentStreamId=nil。
/// discardStream 后 in-flight delta event 仍可能到达 — buffer 被清后 fall back
/// 到 LRU dedup（同 chunkIdx 一旦 LRU 命中就 drop；只要 cancel 后 1-2s 内 chunks
/// 还在 LRU 范围内就不会漏入新 buffer）。
///
/// **lifecycle**：start() 起 subscription Task；stop() cancel；idempotent。
/// 通常由 RemoteDependencies init 时调一次（与 Phase 4 NotificationEventDispatcher
/// 同模式）。
///
/// **@MainActor**：@Published 自然驱动 SwiftUI；dedup set + buffer 字典都在 main
/// isolation 内安全（dispatcher Task 内的 await self?.handle 切回 main）。
@MainActor
public final class AIChatEventDispatcher: ObservableObject {

    /// streamId → 当前累积的文本。VM 订阅本字典更新 in-flight assistant message
    /// 的 content。end 事件触发时**不主动**清；由 VM 在 finalize 后调
    /// [discardStream] 主动清理。
    @Published public private(set) var streamingMessages: [String: String] = [:]

    /// 流终结的 stream — VM 订阅，将 streamingMessages[streamId] 写入 messages
    /// 列表终态（用 finalText 而非本地累积，避免 reorder edge case 漏字）。
    @Published public private(set) var completedStreams: [String: ChatStreamEnd] = [:]

    /// 流出错的 stream — VM 显 lastError + 收尾 currentStreamId。
    @Published public private(set) var streamErrors: [String: String] = [:]

    private let eventStream: AsyncStream<String>
    private var streamBuffers: [String: StreamBuffer] = [:]
    private var seenChunks = LRUSet<String>(capacity: 1024)
    private var subscription: Task<Void, Never>?

    public init(eventStream: AsyncStream<String>) {
        self.eventStream = eventStream
    }

    deinit {
        subscription?.cancel()
    }

    // MARK: - Lifecycle

    /// 起 subscription。idempotent — 已起则 no-op。
    public func start() {
        guard subscription == nil else { return }
        let stream = eventStream
        subscription = Task { [weak self] in
            for await raw in stream {
                await self?.handle(raw: raw)
            }
        }
    }

    /// 停 subscription。idempotent。
    public func stop() {
        subscription?.cancel()
        subscription = nil
    }

    // MARK: - Public actions

    /// VM 调用：流被 cancel / 完成 / 错误处理后 cleanup buffer + 三 @Published 字典。
    ///
    /// 顺序保证（per §7.3）：本方法必须在 commands.cancelStream() RPC 之**前**调，
    /// 否则 in-flight delta 仍会把 streamingMessages[streamId] 推进。LRU `seenChunks`
    /// 不清 — 万一 cancel 后 1-2s 内还有 chunks 到达，靠 LRU silent drop。
    public func discardStream(streamId: String) {
        streamBuffers.removeValue(forKey: streamId)
        streamingMessages.removeValue(forKey: streamId)
        completedStreams.removeValue(forKey: streamId)
        streamErrors.removeValue(forKey: streamId)
    }

    // MARK: - Test helpers

    /// 测试 helper — 验 LRU 是否含某 chunk key。
    public func _testHasSeenChunk(streamId: String, chunkIdx: Int) -> Bool {
        seenChunks.contains(Self.chunkKey(streamId: streamId, chunkIdx: chunkIdx))
    }

    /// 测试 helper — 读 buffer 内部状态。
    public func _testBuffer(streamId: String) -> StreamBuffer? {
        streamBuffers[streamId]
    }

    // MARK: - Private

    /// 复合 LRU key — 跨 stream 不互相 evict（per §7.2 trap）。
    private static func chunkKey(streamId: String, chunkIdx: Int) -> String {
        "\(streamId)|\(chunkIdx)"
    }

    private func handle(raw: String) async {
        // 1) delta 路径
        if let delta = ChatStreamDelta.parseFromEnvelope(raw) {
            handleDelta(delta)
            return
        }

        // 2) end 路径
        if let end = ChatStreamEnd.parseFromEnvelope(raw) {
            handleEnd(end)
            return
        }

        // 3) error 路径
        if let err = ChatStreamError.parseFromEnvelope(raw) {
            handleError(err)
            return
        }

        // 4) 其它 event（notification.received / terminal.stdout / command response /
        //    malformed）— silent drop。本 dispatcher 只处理 ai.chat.* 三种 push。
    }

    private func handleDelta(_ delta: ChatStreamDelta) {
        // LRU dedup —— DC + signaling 双发兜底
        let key = Self.chunkKey(streamId: delta.streamId, chunkIdx: delta.chunkIdx)
        guard seenChunks.insert(key) else {
            return
        }

        var buf = streamBuffers[delta.streamId] ?? StreamBuffer()

        if delta.chunkIdx == buf.nextExpectedIdx {
            // 连续 — append 并推进；然后循环消化已缓存的后续 chunk
            buf.accumulatedText.append(delta.content)
            buf.nextExpectedIdx += 1
            while let next = buf.pendingChunks.removeValue(forKey: buf.nextExpectedIdx) {
                buf.accumulatedText.append(next)
                buf.nextExpectedIdx += 1
            }
        } else if delta.chunkIdx > buf.nextExpectedIdx {
            // 乱序 — 等前面的 chunk 到达再消化
            buf.pendingChunks[delta.chunkIdx] = delta.content
        } else {
            // chunkIdx < nextExpectedIdx — LRU 理论已 dedup；防御性 drop
            return
        }

        streamBuffers[delta.streamId] = buf
        streamingMessages[delta.streamId] = buf.accumulatedText
    }

    private func handleEnd(_ end: ChatStreamEnd) {
        var buf = streamBuffers[end.streamId] ?? StreamBuffer()
        buf.isComplete = true
        // finalText 是权威 — reorder edge case 可能造成本地累积错位，使用 server-truth
        // 兜底 streamingMessages（VM finalize 时优先读 completedStreams.finalText）
        streamBuffers[end.streamId] = buf
        streamingMessages[end.streamId] = end.finalText
        completedStreams[end.streamId] = end
    }

    private func handleError(_ err: ChatStreamError) {
        var buf = streamBuffers[err.streamId] ?? StreamBuffer()
        buf.error = err.error
        streamBuffers[err.streamId] = buf
        streamErrors[err.streamId] = err.error
    }
}
