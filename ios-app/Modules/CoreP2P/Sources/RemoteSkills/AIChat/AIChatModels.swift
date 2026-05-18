import Foundation

// MARK: - ChatRole

/// 消息角色 — 镜像 Android `ChatMessage.role`。
public enum ChatRole: String, Codable, Sendable, Equatable {
    case user
    case assistant
    case system
}

// MARK: - ChatMessage

/// 聊天消息 — 镜像 Android `ChatMessage` model + iOS 端 stream 累积扩展字段。
///
/// `isStreaming=true` 表示该 message 由 dispatcher 流式累积中（assistant 输出未完成）。
/// `ai.chat.end` 事件 → VM finalize 时切回 false 并写入 messages 列表终态。
public struct ChatMessage: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let role: ChatRole
    public let content: String
    public let createdAt: Int64           // ms epoch
    public let modelUsed: String?
    public let isStreaming: Bool

    public init(
        id: String,
        role: ChatRole,
        content: String,
        createdAt: Int64,
        modelUsed: String? = nil,
        isStreaming: Bool = false
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.modelUsed = modelUsed
        self.isStreaming = isStreaming
    }

    /// 单个 message dict → ChatMessage（容错 createdAt 多类型）。
    public static func decodeItem(_ dict: [String: Any]) -> ChatMessage? {
        guard let id = dict["id"] as? String,
              let roleStr = dict["role"] as? String,
              let role = ChatRole(rawValue: roleStr),
              let content = dict["content"] as? String else { return nil }
        let createdAt: Int64
        if let v = dict["createdAt"] as? Int64 { createdAt = v }
        else if let v = dict["createdAt"] as? Int { createdAt = Int64(v) }
        else if let v = dict["createdAt"] as? Double { createdAt = Int64(v) }
        else { createdAt = 0 }
        let modelUsed = dict["modelUsed"] as? String
        return ChatMessage(
            id: id, role: role, content: content,
            createdAt: createdAt, modelUsed: modelUsed,
            isStreaming: false
        )
    }
}

// MARK: - Conversation

/// 对话元信息 — 镜像 Android `Conversation`。
///
/// 桌面端 source of truth；iOS 端仅缓存当前 view 用，不持久化（per Phase 5 OQ-3 决议）。
public struct Conversation: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let title: String
    public let model: String?
    public let messageCount: Int
    public let lastMessageAt: Int64?
    public let createdAt: Int64
    public let archived: Bool

    public init(
        id: String,
        title: String,
        model: String? = nil,
        messageCount: Int = 0,
        lastMessageAt: Int64? = nil,
        createdAt: Int64,
        archived: Bool = false
    ) {
        self.id = id
        self.title = title
        self.model = model
        self.messageCount = messageCount
        self.lastMessageAt = lastMessageAt
        self.createdAt = createdAt
        self.archived = archived
    }

    public static func decodeItem(_ dict: [String: Any]) -> Conversation? {
        guard let id = dict["id"] as? String,
              let title = dict["title"] as? String else { return nil }
        let model = dict["model"] as? String
        let messageCount = (dict["messageCount"] as? Int) ?? 0
        let lastMessageAt: Int64?
        if let v = dict["lastMessageAt"] as? Int64 { lastMessageAt = v }
        else if let v = dict["lastMessageAt"] as? Int { lastMessageAt = Int64(v) }
        else if let v = dict["lastMessageAt"] as? Double { lastMessageAt = Int64(v) }
        else { lastMessageAt = nil }
        let createdAt: Int64
        if let v = dict["createdAt"] as? Int64 { createdAt = v }
        else if let v = dict["createdAt"] as? Int { createdAt = Int64(v) }
        else if let v = dict["createdAt"] as? Double { createdAt = Int64(v) }
        else { createdAt = 0 }
        let archived = (dict["archived"] as? Bool) ?? false
        return Conversation(
            id: id, title: title, model: model,
            messageCount: messageCount,
            lastMessageAt: lastMessageAt,
            createdAt: createdAt, archived: archived
        )
    }
}

// MARK: - Responses

/// `ai.chat` 一次性响应（非流式）。
public struct ChatResponse: Sendable, Equatable {
    public let success: Bool
    public let response: String
    public let conversationId: String
    public let messageId: String
    public let modelUsed: String?

    public init(success: Bool, response: String, conversationId: String, messageId: String, modelUsed: String? = nil) {
        self.success = success
        self.response = response
        self.conversationId = conversationId
        self.messageId = messageId
        self.modelUsed = modelUsed
    }

    public static func decode(_ json: String) throws -> ChatResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.chat response: invalid JSON")
        }
        return ChatResponse(
            success: (dict["success"] as? Bool) ?? false,
            response: (dict["response"] as? String) ?? "",
            conversationId: (dict["conversationId"] as? String) ?? "",
            messageId: (dict["messageId"] as? String) ?? "",
            modelUsed: dict["modelUsed"] as? String
        )
    }
}

/// `ai.chatStream` 启动响应 — 返 streamId 给后续 dispatcher 按 id 累积 chunks。
public struct StreamStartResponse: Sendable, Equatable {
    public let success: Bool
    public let streamId: String
    public let conversationId: String

    public init(success: Bool, streamId: String, conversationId: String) {
        self.success = success
        self.streamId = streamId
        self.conversationId = conversationId
    }

    public static func decode(_ json: String) throws -> StreamStartResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.chatStream response: invalid JSON")
        }
        return StreamStartResponse(
            success: (dict["success"] as? Bool) ?? false,
            streamId: (dict["streamId"] as? String) ?? "",
            conversationId: (dict["conversationId"] as? String) ?? ""
        )
    }
}

/// `ai.getStreamChunk` polling fallback 响应（v0.2 实际使用；v0.1 wire 占位）。
/// v0.3：加 `error` 字段 — 桌面 `getStreamChunk` 在 stream 异常/expired 时返此字段
/// （e.g. agent crash / stream not found），caller 用于显示错误而非误以为正常完成。
public struct StreamChunkResponse: Sendable, Equatable {
    public let success: Bool
    public let chunks: [String]
    public let isComplete: Bool
    public let nextChunkIdx: Int?
    public let error: String?

    public init(success: Bool, chunks: [String] = [], isComplete: Bool = false,
                nextChunkIdx: Int? = nil, error: String? = nil) {
        self.success = success
        self.chunks = chunks
        self.isComplete = isComplete
        self.nextChunkIdx = nextChunkIdx
        self.error = error
    }

    public static func decode(_ json: String) throws -> StreamChunkResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.getStreamChunk response: invalid JSON")
        }
        let rawChunks = (dict["chunks"] as? [String]) ?? []
        return StreamChunkResponse(
            success: (dict["success"] as? Bool) ?? false,
            chunks: rawChunks,
            isComplete: (dict["isComplete"] as? Bool) ?? false,
            nextChunkIdx: dict["nextChunkIdx"] as? Int,
            error: dict["error"] as? String
        )
    }
}

/// `ai.cancelStream` 响应。
public struct CancelStreamResponse: Sendable, Equatable {
    public let success: Bool
    public let cancelled: Bool

    public init(success: Bool, cancelled: Bool) {
        self.success = success
        self.cancelled = cancelled
    }

    public static func decode(_ json: String) throws -> CancelStreamResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.cancelStream response: invalid JSON")
        }
        return CancelStreamResponse(
            success: (dict["success"] as? Bool) ?? false,
            cancelled: (dict["cancelled"] as? Bool) ?? false
        )
    }
}

/// `ai.getConversations` 响应。
public struct ConversationsResponse: Sendable, Equatable {
    public let success: Bool
    public let conversations: [Conversation]
    public let total: Int

    public init(success: Bool, conversations: [Conversation] = [], total: Int = 0) {
        self.success = success
        self.conversations = conversations
        self.total = total
    }

    public static func decode(_ json: String) throws -> ConversationsResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.getConversations response: invalid JSON")
        }
        let rawList = (dict["conversations"] as? [[String: Any]]) ?? []
        let items = rawList.compactMap { Conversation.decodeItem($0) }
        return ConversationsResponse(
            success: (dict["success"] as? Bool) ?? false,
            conversations: items,
            total: (dict["total"] as? Int) ?? items.count
        )
    }
}

/// `ai.getConversation` 单条响应。
public struct GetConversationResponse: Sendable, Equatable {
    public let success: Bool
    public let conversation: Conversation?

    public init(success: Bool, conversation: Conversation? = nil) {
        self.success = success
        self.conversation = conversation
    }

    public static func decode(_ json: String) throws -> GetConversationResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.getConversation response: invalid JSON")
        }
        let conv: Conversation?
        if let inner = dict["conversation"] as? [String: Any] {
            conv = Conversation.decodeItem(inner)
        } else {
            conv = nil
        }
        return GetConversationResponse(
            success: (dict["success"] as? Bool) ?? false,
            conversation: conv
        )
    }
}

/// `ai.getMessages` 响应。
public struct GetMessagesResponse: Sendable, Equatable {
    public let success: Bool
    public let messages: [ChatMessage]
    public let total: Int

    public init(success: Bool, messages: [ChatMessage] = [], total: Int = 0) {
        self.success = success
        self.messages = messages
        self.total = total
    }

    public static func decode(_ json: String) throws -> GetMessagesResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.getMessages response: invalid JSON")
        }
        let rawList = (dict["messages"] as? [[String: Any]]) ?? []
        let items = rawList.compactMap { ChatMessage.decodeItem($0) }
        return GetMessagesResponse(
            success: (dict["success"] as? Bool) ?? false,
            messages: items,
            total: (dict["total"] as? Int) ?? items.count
        )
    }
}

/// `ai.createConversation` 响应。
public struct CreateConversationResponse: Sendable, Equatable {
    public let success: Bool
    public let conversationId: String
    public let conversation: Conversation?
    public let error: String?

    public init(success: Bool, conversationId: String = "", conversation: Conversation? = nil, error: String? = nil) {
        self.success = success
        self.conversationId = conversationId
        self.conversation = conversation
        self.error = error
    }

    public static func decode(_ json: String) throws -> CreateConversationResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.createConversation response: invalid JSON")
        }
        let conv: Conversation?
        if let inner = dict["conversation"] as? [String: Any] {
            conv = Conversation.decodeItem(inner)
        } else {
            conv = nil
        }
        return CreateConversationResponse(
            success: (dict["success"] as? Bool) ?? false,
            conversationId: (dict["conversationId"] as? String) ?? (conv?.id ?? ""),
            conversation: conv,
            error: dict["error"] as? String
        )
    }
}

/// `ai.deleteConversation` 响应。
public struct DeleteConversationResponse: Sendable, Equatable {
    public let success: Bool
    public let error: String?

    public init(success: Bool, error: String? = nil) {
        self.success = success
        self.error = error
    }

    public static func decode(_ json: String) throws -> DeleteConversationResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("ai.deleteConversation response: invalid JSON")
        }
        return DeleteConversationResponse(
            success: (dict["success"] as? Bool) ?? false,
            error: dict["error"] as? String
        )
    }
}

// MARK: - Push Events (server → iOS)

/// `ai.chat.delta` push event — Phase 5.2 dispatcher 累积渲染用。
///
/// envelope 结构：
/// ```json
/// {
///   "type": "chainlesschain:event",
///   "payload": {
///     "event": "ai.chat.delta",
///     "streamId": "abc",
///     "content": " world",
///     "chunkIdx": 3,
///     "totalChunks": null
///   }
/// }
/// ```
public struct ChatStreamDelta: Sendable, Equatable {
    public let streamId: String
    public let content: String          // 本 chunk 增量（非累积）
    public let chunkIdx: Int
    public let totalChunks: Int?

    public init(streamId: String, content: String, chunkIdx: Int, totalChunks: Int? = nil) {
        self.streamId = streamId
        self.content = content
        self.chunkIdx = chunkIdx
        self.totalChunks = totalChunks
    }

    /// 从 envelope JSON 解析；不符 `ai.chat.delta` 返 nil（dispatcher 应 silent drop）。
    public static func parseFromEnvelope(_ raw: String) -> ChatStreamDelta? {
        guard let data = raw.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard (dict["type"] as? String) == "chainlesschain:event" else { return nil }
        guard let payload = dict["payload"] as? [String: Any] else { return nil }
        guard (payload["event"] as? String) == "ai.chat.delta" else { return nil }
        guard let streamId = payload["streamId"] as? String,
              let content = payload["content"] as? String else {
            return nil
        }
        let chunkIdx: Int
        if let v = payload["chunkIdx"] as? Int { chunkIdx = v }
        else if let v = payload["chunkIdx"] as? Double { chunkIdx = Int(v) }
        else { chunkIdx = 0 }
        let totalChunks = payload["totalChunks"] as? Int
        return ChatStreamDelta(
            streamId: streamId,
            content: content,
            chunkIdx: chunkIdx,
            totalChunks: totalChunks
        )
    }
}

/// `ai.chat.end` push event — stream 终结，dispatcher 用 finalText 与本地累积校验。
public struct ChatStreamEnd: Sendable, Equatable {
    public let streamId: String
    public let finishReason: String     // "stop" / "length" / "cancelled" / "error"
    public let finalText: String
    public let messageId: String

    public init(streamId: String, finishReason: String, finalText: String, messageId: String) {
        self.streamId = streamId
        self.finishReason = finishReason
        self.finalText = finalText
        self.messageId = messageId
    }

    public static func parseFromEnvelope(_ raw: String) -> ChatStreamEnd? {
        guard let data = raw.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard (dict["type"] as? String) == "chainlesschain:event" else { return nil }
        guard let payload = dict["payload"] as? [String: Any] else { return nil }
        guard (payload["event"] as? String) == "ai.chat.end" else { return nil }
        guard let streamId = payload["streamId"] as? String else { return nil }
        return ChatStreamEnd(
            streamId: streamId,
            finishReason: (payload["finishReason"] as? String) ?? "stop",
            finalText: (payload["finalText"] as? String) ?? "",
            messageId: (payload["messageId"] as? String) ?? ""
        )
    }
}

/// `ai.chat.error` push event — LLM/桌面端中途出错。
public struct ChatStreamError: Sendable, Equatable {
    public let streamId: String
    public let error: String

    public init(streamId: String, error: String) {
        self.streamId = streamId
        self.error = error
    }

    public static func parseFromEnvelope(_ raw: String) -> ChatStreamError? {
        guard let data = raw.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard (dict["type"] as? String) == "chainlesschain:event" else { return nil }
        guard let payload = dict["payload"] as? [String: Any] else { return nil }
        guard (payload["event"] as? String) == "ai.chat.error" else { return nil }
        guard let streamId = payload["streamId"] as? String else { return nil }
        return ChatStreamError(
            streamId: streamId,
            error: (payload["error"] as? String) ?? "unknown error"
        )
    }
}
