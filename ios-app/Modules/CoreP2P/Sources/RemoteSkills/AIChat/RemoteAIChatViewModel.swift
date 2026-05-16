import Foundation
import Combine

/// AI chat tab 的 ViewModel — Phase 5.3。
///
/// **职责**：
/// 1. 持有 `@Published` conversations / messages / streaming state / isLoading
///    / lastError 给 SwiftUI 订阅
/// 2. 调 [AIChatCommands] 完成 user action（load / send / cancel / create /
///    delete）
/// 3. 订阅 [AIChatEventDispatcher] 3 个 @Published — 把累积 token / end /
///    error 路由到当前对话的 messages 末条
/// 4. DC 不通时 mutating action (createConversation / deleteConversation) 走
///    OfflineQueue enqueue (per §6.3)；chatStream 不入队（服务端无法异步开始
///    stream），DC 不通时报 lastError "需在线发起对话"
///
/// **乐观更新**：sendMessage 立即追加 user msg + 占位 assistant msg；
/// dispatcher 喂 chunk 时更新占位 content；end 时用 finalText 覆盖；error 时
/// 保留占位 + 显 lastError（用户可手动 retry 或 cancel）。
///
/// **多 conversation 隔离**（per §7.4）：dispatcher streamBuffers 按 streamId
/// 隔离；VM 仅 mirror 当前 conversation 的 stream（filter currentStreamId）。
/// 切换 conversation 时若 prev stream 仍 in-flight，stream chunks 继续在
/// dispatcher 累积但本 VM 不响应；切回时 messages 静态列表（除非重 chat
/// 触发新 stream）。
///
/// **cancel 顺序**（per §7.3）：cancelCurrentStream 必须 (1) discardStream FIRST
/// (2) commands.cancelStream RPC (3) 清本地 state。
///
/// **@MainActor**：与 Phase 4 RemoteNotificationsViewModel 一致；@Published
/// 自然驱动 SwiftUI；subscriptions 在 main isolation。
@MainActor
public final class RemoteAIChatViewModel: ObservableObject {

    // MARK: - Published state

    @Published public private(set) var conversations: [Conversation] = []
    @Published public private(set) var currentConversation: Conversation?
    @Published public private(set) var messages: [ChatMessage] = []
    @Published public private(set) var isStreamingMessage: Bool = false
    @Published public private(set) var currentStreamId: String?
    @Published public private(set) var isLoading: Bool = false
    @Published public private(set) var lastError: String?

    // MARK: - User-controlled state

    /// 用户输入框文字 — SwiftUI TextField $vm.inputDraft 双向绑定。
    /// sendMessage 成功后被 reset 为空。
    @Published public var inputDraft: String = ""

    // MARK: - Deps

    public let pcPeerId: String
    private let commands: AIChatCommands
    private let dispatcher: AIChatEventDispatcher
    private let offlineQueue: OfflineCommandQueue?
    private let isDataChannelReady: @Sendable () async -> Bool
    private let currentDIDProvider: () -> String?

    private var streamingSubscription: AnyCancellable?
    private var completedSubscription: AnyCancellable?
    private var errorSubscription: AnyCancellable?

    // MARK: - Init

    public init(
        pcPeerId: String,
        commands: AIChatCommands,
        dispatcher: AIChatEventDispatcher,
        offlineQueue: OfflineCommandQueue? = nil,
        isDataChannelReady: @escaping @Sendable () async -> Bool = { true },
        currentDIDProvider: @escaping () -> String? = { nil }
    ) {
        self.pcPeerId = pcPeerId
        self.commands = commands
        self.dispatcher = dispatcher
        self.offlineQueue = offlineQueue
        self.isDataChannelReady = isDataChannelReady
        self.currentDIDProvider = currentDIDProvider

        // 订阅 dispatcher streamingMessages → 更新 messages 末条 content
        streamingSubscription = dispatcher.$streamingMessages
            .sink { [weak self] streams in
                guard let self = self, let streamId = self.currentStreamId else { return }
                guard let accumulated = streams[streamId] else { return }
                self.updateStreamingAssistantContent(accumulated)
            }

        // 订阅 dispatcher completedStreams → finalize message + clear stream state
        completedSubscription = dispatcher.$completedStreams
            .sink { [weak self] completed in
                guard let self = self, let streamId = self.currentStreamId else { return }
                guard let end = completed[streamId] else { return }
                self.finalizeStream(end: end)
            }

        // 订阅 dispatcher streamErrors → lastError + clear stream state
        errorSubscription = dispatcher.$streamErrors
            .sink { [weak self] errors in
                guard let self = self, let streamId = self.currentStreamId else { return }
                guard let msg = errors[streamId] else { return }
                self.handleStreamError(msg)
            }
    }

    // MARK: - Public actions (conversations)

    /// 拉对话列表。
    public func loadConversations(keyword: String? = nil) async {
        await runWithLoading {
            do {
                let resp = try await self.commands.getConversations(
                    pcPeerId: self.pcPeerId,
                    limit: 50, offset: 0,
                    keyword: keyword,
                    mobileDid: self.currentDIDProvider()
                )
                self.conversations = resp.conversations
                self.lastError = nil
            } catch let RemoteSkillError.remoteError(_, msg) {
                self.lastError = "桌面端错误：\(msg)"
            } catch {
                self.lastError = "拉取对话列表失败：\((error as NSError).localizedDescription)"
            }
        }
    }

    /// .refreshable 别名。
    public func refresh() async {
        await loadConversations()
    }

    /// 切换当前对话 — 设 currentConversation + 拉 messages。
    /// 若 prev stream in-flight，本方法不主动 cancel（让用户决定）；
    /// 但切换后 streamingSubscription filter 会令 in-flight stream chunks
    /// 不再影响 VM messages（dispatcher 仍 buffer，可切回 inspect）。
    public func selectConversation(id: String) async {
        guard let conv = conversations.first(where: { $0.id == id }) else {
            lastError = "对话不存在"
            return
        }
        currentConversation = conv
        await loadMessages()
    }

    /// 拉 currentConversation 的 messages。
    public func loadMessages() async {
        guard let conv = currentConversation else {
            messages = []
            return
        }
        await runWithLoading {
            do {
                let resp = try await self.commands.getMessages(
                    pcPeerId: self.pcPeerId,
                    conversationId: conv.id,
                    limit: 100, offset: 0,
                    mobileDid: self.currentDIDProvider()
                )
                self.messages = resp.messages
                self.lastError = nil
            } catch let RemoteSkillError.remoteError(_, msg) {
                self.lastError = "桌面端错误：\(msg)"
            } catch {
                self.lastError = "拉取消息失败：\((error as NSError).localizedDescription)"
            }
        }
    }

    // MARK: - Public actions (chat)

    /// 发当前 inputDraft：追加 user msg + 占位 assistant msg + 启 chatStream RPC。
    /// 后续 dispatcher 喂 chunks → updateStreamingAssistantContent 自动累积。
    /// **DC 不通时 lastError 提示**（不入 OfflineQueue — server 无法异步开始 stream）。
    public func sendMessage() async {
        let text = inputDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard let conv = currentConversation else {
            lastError = "请先选择或创建对话"
            return
        }

        // DC gate — chatStream 不能 enqueue
        guard await isDataChannelReady() else {
            lastError = "需在线发起对话（请检查桌面连接）"
            return
        }

        // 乐观：本地追加 user msg + 占位 assistant msg
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let userMsg = ChatMessage(
            id: "local-user-\(UUID().uuidString)",
            role: .user, content: text,
            createdAt: now,
            isStreaming: false
        )
        let placeholderMsg = ChatMessage(
            id: "local-assistant-\(UUID().uuidString)",
            role: .assistant, content: "",
            createdAt: now,
            isStreaming: true
        )
        messages.append(userMsg)
        messages.append(placeholderMsg)
        inputDraft = ""

        do {
            let resp = try await commands.chatStream(
                pcPeerId: pcPeerId,
                message: text,
                conversationId: conv.id,
                mobileDid: currentDIDProvider()
            )
            currentStreamId = resp.streamId
            isStreamingMessage = true
            lastError = nil
        } catch let RemoteSkillError.remoteError(_, msg) {
            // 失败：移除占位 assistant msg + lastError
            removeLastIfStreaming()
            lastError = "发送失败：\(msg)"
        } catch {
            removeLastIfStreaming()
            lastError = "发送失败：\((error as NSError).localizedDescription)"
        }
    }

    /// 取消 in-flight stream。
    /// 顺序保证（per §7.3）: (1) discardStream FIRST 停止 dispatcher 接收新 chunks
    /// (2) commands.cancelStream RPC 让桌面端中断 LLM (3) 清本地 state。
    public func cancelCurrentStream() async {
        guard let streamId = currentStreamId else { return }
        dispatcher.discardStream(streamId: streamId)
        // 标记本地占位 assistant msg 为已收尾（保留内容 + isStreaming=false）
        finalizeStreamingPlaceholder(finalText: nil)
        currentStreamId = nil
        isStreamingMessage = false

        // 通知桌面端 — 失败也不影响本地收尾
        do {
            _ = try await commands.cancelStream(
                pcPeerId: pcPeerId,
                streamId: streamId,
                mobileDid: currentDIDProvider()
            )
            lastError = nil
        } catch {
            // 桌面端 cancel 失败不报错给用户（本地已收尾，体验完整）
            // 落记到 lastError 但用户可不理
            lastError = "桌面端 cancel 未确认：\((error as NSError).localizedDescription)"
        }
    }

    // MARK: - Public actions (conversation mutating)

    /// 创建新对话。DC 不通时 enqueue OfflineQueue + 显示提示（本地不假装创建 — 没 conversationId）。
    public func createConversation(title: String? = nil, model: String? = nil) async {
        if await isDataChannelReady() {
            do {
                let resp = try await commands.createConversation(
                    pcPeerId: pcPeerId,
                    title: title, model: model,
                    mobileDid: currentDIDProvider()
                )
                if let conv = resp.conversation {
                    conversations.insert(conv, at: 0)
                    currentConversation = conv
                    messages = []
                } else if !resp.conversationId.isEmpty {
                    // 桌面端只返 conversationId 没 conversation 全字段 — 拉 getConversation 兜底
                    if let full = try? await commands.getConversation(
                        pcPeerId: pcPeerId,
                        conversationId: resp.conversationId,
                        mobileDid: currentDIDProvider()
                    ).conversation {
                        conversations.insert(full, at: 0)
                        currentConversation = full
                        messages = []
                    }
                }
                lastError = nil
            } catch let RemoteSkillError.remoteError(_, msg) {
                lastError = "创建对话失败：\(msg)"
            } catch {
                lastError = "创建对话失败：\((error as NSError).localizedDescription)"
            }
        } else if let q = offlineQueue {
            var params: [String: Any] = [:]
            if let v = title { params["title"] = v }
            if let v = model { params["model"] = v }
            let paramsJson = (try? JSONSerialization.data(withJSONObject: params))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            await q.enqueue(
                method: "ai.createConversation",
                paramsJson: paramsJson,
                mobileDid: currentDIDProvider()
            )
            lastError = "已加入离线队列，恢复连接后自动同步"
        } else {
            lastError = "桌面端未连接"
        }
    }

    /// 删除对话。乐观更新本地列表。
    public func deleteConversation(id: String) async {
        guard !id.isEmpty else { return }
        let originalIndex = conversations.firstIndex(where: { $0.id == id })
        let originalItem = originalIndex.map { conversations[$0] }
        if let idx = originalIndex {
            conversations.remove(at: idx)
            // 删的是当前对话 → 清 messages + currentConversation
            if currentConversation?.id == id {
                currentConversation = nil
                messages = []
            }
        }

        if await isDataChannelReady() {
            do {
                _ = try await commands.deleteConversation(
                    pcPeerId: pcPeerId,
                    conversationId: id,
                    mobileDid: currentDIDProvider()
                )
                lastError = nil
            } catch {
                // 回滚
                if let idx = originalIndex, let item = originalItem {
                    conversations.insert(item, at: min(idx, conversations.count))
                }
                lastError = "删除对话失败：\((error as NSError).localizedDescription)"
            }
        } else if let q = offlineQueue {
            await q.enqueue(
                method: "ai.deleteConversation",
                paramsJson: #"{"conversationId":"\#(escapeJsonString(id))"}"#,
                mobileDid: currentDIDProvider()
            )
            lastError = "已加入离线队列"
        } else {
            if let idx = originalIndex, let item = originalItem {
                conversations.insert(item, at: min(idx, conversations.count))
            }
            lastError = "桌面端未连接"
        }
    }

    // MARK: - Public utility

    public func clearError() {
        lastError = nil
    }

    // MARK: - Private — stream lifecycle

    /// 更新占位 assistant msg 的 content — dispatcher 流式喂 token 时被调。
    private func updateStreamingAssistantContent(_ text: String) {
        guard let lastIdx = messages.indices.last,
              messages[lastIdx].role == .assistant,
              messages[lastIdx].isStreaming else {
            return
        }
        messages[lastIdx] = ChatMessage(
            id: messages[lastIdx].id,
            role: .assistant,
            content: text,
            createdAt: messages[lastIdx].createdAt,
            modelUsed: messages[lastIdx].modelUsed,
            isStreaming: true
        )
    }

    /// 流终结 — 用 server finalText 覆写占位 msg + 切 isStreaming=false +
    /// 清 currentStreamId + discardStream cleanup buffer。
    private func finalizeStream(end: ChatStreamEnd) {
        finalizeStreamingPlaceholder(finalText: end.finalText, messageId: end.messageId)
        let streamId = currentStreamId
        currentStreamId = nil
        isStreamingMessage = false
        if let sid = streamId {
            dispatcher.discardStream(streamId: sid)
        }
    }

    /// 流出错 — 占位 msg 切收尾（保留部分累积）+ lastError + 清 stream state。
    private func handleStreamError(_ msg: String) {
        finalizeStreamingPlaceholder(finalText: nil)
        let streamId = currentStreamId
        currentStreamId = nil
        isStreamingMessage = false
        lastError = "AI 响应中断：\(msg)"
        if let sid = streamId {
            dispatcher.discardStream(streamId: sid)
        }
    }

    /// 把 messages 末条 assistant streaming 占位标记为已收尾。
    /// `finalText != nil` 时用 finalText 覆盖；nil 时保留 dispatcher 累积的部分内容。
    private func finalizeStreamingPlaceholder(finalText: String?, messageId: String? = nil) {
        guard let lastIdx = messages.indices.last,
              messages[lastIdx].role == .assistant,
              messages[lastIdx].isStreaming else {
            return
        }
        let oldMsg = messages[lastIdx]
        let content = finalText ?? oldMsg.content
        messages[lastIdx] = ChatMessage(
            id: messageId ?? oldMsg.id,
            role: .assistant,
            content: content,
            createdAt: oldMsg.createdAt,
            modelUsed: oldMsg.modelUsed,
            isStreaming: false
        )
    }

    /// 发送失败时 sendMessage 撤回占位 assistant msg（user msg 保留作为发送记录）。
    private func removeLastIfStreaming() {
        guard let lastIdx = messages.indices.last,
              messages[lastIdx].role == .assistant,
              messages[lastIdx].isStreaming else {
            return
        }
        messages.remove(at: lastIdx)
        isStreamingMessage = false
    }

    private func runWithLoading(_ op: () async -> Void) async {
        isLoading = true
        await op()
        isLoading = false
    }

    /// JSON string 字段 escape — 与 RemoteNotificationsViewModel 同实现。
    private func escapeJsonString(_ s: String) -> String {
        var out = ""
        for c in s {
            switch c {
            case "\\": out.append("\\\\")
            case "\"": out.append("\\\"")
            case "\n": out.append("\\n")
            case "\r": out.append("\\r")
            case "\t": out.append("\\t")
            default: out.append(c)
            }
        }
        return out
    }
}
