import Foundation

/// AI 对话 typed RPC wrapper — Phase 5.1。
///
/// 镜像 Android `AICommands.kt` 的 chat-related 8 method subset
/// (chat / chatStream / getStreamChunk / cancelStream / getConversations
/// / getConversation / createConversation / deleteConversation / getMessages 选 8)。
/// 其余 45 method (controlAgent / RAG / embedding / model 管理 / multimodal) 留
/// Phase 6+ 按需 unlock。
///
/// 8 method 全部 delegate 到 Phase 3 抽出的通用 [RemoteCommandClient]，
/// 与 Clipboard/File/Screenshot/SystemInfo/Notification commands 共享同一
/// invoke 池 + DC/signaling 双路径 + LRU dedup + continuation 池清理。
///
/// **wire 协议**（与桌面 `chat-handler.js` 对齐，与 Android 完全一致）：
/// - `ai.chat` params `{message, conversationId?, model?, systemPrompt?, temperature?}`
///   → `{success, response, conversationId, messageId, modelUsed?}`
/// - `ai.chatStream` params 同 ai.chat → `{success, streamId, conversationId}`
/// - `ai.getStreamChunk` params `{streamId, sinceChunk}` → `{success, chunks[], isComplete, nextChunkIdx?}`
/// - `ai.cancelStream` params `{streamId}` → `{success, cancelled}`
/// - `ai.getConversations` params `{limit, offset, keyword?}` → `{success, conversations[], total}`
/// - `ai.getConversation` params `{conversationId}` → `{success, conversation?}`
/// - `ai.createConversation` params `{title?, model?, systemPrompt?}`
///   → `{success, conversationId, conversation?, error?}`
/// - `ai.deleteConversation` params `{conversationId}` → `{success, error?}`
/// - `ai.getMessages` params `{conversationId, limit, offset}` → `{success, messages[], total}`
///
/// **server-push event**（dispatcher 处理，不在本类）：
/// - `ai.chat.delta` / `ai.chat.end` / `ai.chat.error` — Phase 5.2
///   [AIChatEventDispatcher] 订阅 commandClient.events 流过滤。
public actor AIChatCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - Chat (一次性 + 流式)

    /// 一次性 chat — 桌面 LLM 完整响应后一次返回；适合短消息 / system message。
    /// Phase 5 v0.1 UI 始终走 [chatStream]；本 method wire 进给 v0.2 选用。
    public func chat(
        pcPeerId: String,
        message: String,
        conversationId: String? = nil,
        model: String? = nil,
        systemPrompt: String? = nil,
        temperature: Double? = nil,
        mobileDid: String? = nil
    ) async throws -> ChatResponse {
        guard !message.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.chat message is empty")
        }
        var params: [String: Any] = ["message": message]
        if let v = conversationId { params["conversationId"] = v }
        if let v = model { params["model"] = v }
        if let v = systemPrompt { params["systemPrompt"] = v }
        if let v = temperature { params["temperature"] = v }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.chat",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: ChatResponse.decode)
    }

    /// 启动流式 chat — 桌面端 push `ai.chat.delta` 系列 event 边输出 token；
    /// 调方拿到 streamId 后由 [AIChatEventDispatcher] 累积渲染。
    public func chatStream(
        pcPeerId: String,
        message: String,
        conversationId: String? = nil,
        model: String? = nil,
        systemPrompt: String? = nil,
        temperature: Double? = nil,
        mobileDid: String? = nil
    ) async throws -> StreamStartResponse {
        guard !message.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.chatStream message is empty")
        }
        var params: [String: Any] = ["message": message]
        if let v = conversationId { params["conversationId"] = v }
        if let v = model { params["model"] = v }
        if let v = systemPrompt { params["systemPrompt"] = v }
        if let v = temperature { params["temperature"] = v }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.chatStream",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: StreamStartResponse.decode)
    }

    /// polling fallback — 拉 streamId 自 sinceChunk 起 buffered chunks。
    /// Phase 5 v0.1 UI 不调（server-push event 走 dispatcher 即可）；wire 留接口给 v0.2 polling 模式。
    public func getStreamChunk(
        pcPeerId: String,
        streamId: String,
        sinceChunk: Int = 0,
        mobileDid: String? = nil
    ) async throws -> StreamChunkResponse {
        guard !streamId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.getStreamChunk streamId is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.getStreamChunk",
            params: ["streamId": streamId, "sinceChunk": max(0, sinceChunk)],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: StreamChunkResponse.decode)
    }

    /// 取消 in-flight stream — 桌面端中断 LLM 输出 + 返 cancelled=true。
    public func cancelStream(
        pcPeerId: String,
        streamId: String,
        mobileDid: String? = nil
    ) async throws -> CancelStreamResponse {
        guard !streamId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.cancelStream streamId is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.cancelStream",
            params: ["streamId": streamId],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: CancelStreamResponse.decode)
    }

    // MARK: - Conversation 管理

    /// 拉对话列表。
    public func getConversations(
        pcPeerId: String,
        limit: Int = 50,
        offset: Int = 0,
        keyword: String? = nil,
        mobileDid: String? = nil
    ) async throws -> ConversationsResponse {
        var params: [String: Any] = [
            "limit": max(1, limit),
            "offset": max(0, offset)
        ]
        if let v = keyword, !v.isEmpty { params["keyword"] = v }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.getConversations",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: ConversationsResponse.decode)
    }

    /// 拉单个对话元信息。
    public func getConversation(
        pcPeerId: String,
        conversationId: String,
        mobileDid: String? = nil
    ) async throws -> GetConversationResponse {
        guard !conversationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.getConversation conversationId is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.getConversation",
            params: ["conversationId": conversationId],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: GetConversationResponse.decode)
    }

    /// 创建新对话。title/model/systemPrompt 全可选；桌面端按缺省补全。
    public func createConversation(
        pcPeerId: String,
        title: String? = nil,
        model: String? = nil,
        systemPrompt: String? = nil,
        mobileDid: String? = nil
    ) async throws -> CreateConversationResponse {
        var params: [String: Any] = [:]
        if let v = title { params["title"] = v }
        if let v = model { params["model"] = v }
        if let v = systemPrompt { params["systemPrompt"] = v }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.createConversation",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: CreateConversationResponse.decode)
    }

    /// 删除对话（连同 messages）。
    public func deleteConversation(
        pcPeerId: String,
        conversationId: String,
        mobileDid: String? = nil
    ) async throws -> DeleteConversationResponse {
        guard !conversationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.deleteConversation conversationId is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.deleteConversation",
            params: ["conversationId": conversationId],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: DeleteConversationResponse.decode)
    }

    /// 拉对话内 messages。Phase 5 v0.1 默认 limit=100；pagination 留 v0.2。
    public func getMessages(
        pcPeerId: String,
        conversationId: String,
        limit: Int = 100,
        offset: Int = 0,
        mobileDid: String? = nil
    ) async throws -> GetMessagesResponse {
        guard !conversationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.getMessages conversationId is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "ai.getMessages",
            params: [
                "conversationId": conversationId,
                "limit": max(1, limit),
                "offset": max(0, offset)
            ],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: GetMessagesResponse.decode)
    }

    // MARK: - Private

    /// 通用 response → typed result 解包；与 NotificationCommands 同模式。
    private func unwrap<T>(
        _ response: TerminalRpcResponse,
        decoder: (String) throws -> T
    ) throws -> T {
        switch response {
        case .success(_, let resultJson):
            return try decoder(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
