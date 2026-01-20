import Foundation
import SQLite3
import CoreDatabase
import CoreCommon

/// AI 对话数据仓储
/// 负责 AI 对话和消息的数据库持久化操作
class AIConversationRepository {
    // MARK: - Singleton

    static let shared = AIConversationRepository()

    // MARK: - Private Properties

    private let database = DatabaseManager.shared
    private let logger = Logger.shared

    private init() {}

    // MARK: - Conversation CRUD

    /// 获取所有对话
    func getAllConversations(limit: Int = 100, offset: Int = 0) throws -> [AIConversationEntity] {
        let sql = """
            SELECT id, title, model, system_prompt, temperature, total_tokens, message_count, created_at, updated_at
            FROM ai_conversations
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
        """

        return try database.query(sql, parameters: [limit, offset]) { stmt in
            AIConversationEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                title: sqlite3_column_type(stmt, 1) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 1)) : nil,
                model: String(cString: sqlite3_column_text(stmt, 2)),
                systemPrompt: sqlite3_column_type(stmt, 3) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 3)) : nil,
                temperature: sqlite3_column_double(stmt, 4),
                totalTokens: Int(sqlite3_column_int(stmt, 5)),
                messageCount: Int(sqlite3_column_int(stmt, 6)),
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 7)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 8)) / 1000)
            )
        }
    }

    /// 根据 ID 获取对话
    func getConversation(id: String) throws -> AIConversationEntity? {
        let sql = """
            SELECT id, title, model, system_prompt, temperature, total_tokens, message_count, created_at, updated_at
            FROM ai_conversations
            WHERE id = ?
        """

        return try database.queryOne(sql, parameters: [id]) { stmt in
            AIConversationEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                title: sqlite3_column_type(stmt, 1) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 1)) : nil,
                model: String(cString: sqlite3_column_text(stmt, 2)),
                systemPrompt: sqlite3_column_type(stmt, 3) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 3)) : nil,
                temperature: sqlite3_column_double(stmt, 4),
                totalTokens: Int(sqlite3_column_int(stmt, 5)),
                messageCount: Int(sqlite3_column_int(stmt, 6)),
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 7)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 8)) / 1000)
            )
        }
    }

    /// 创建新对话
    func createConversation(_ conversation: AIConversationEntity) throws {
        let sql = """
            INSERT INTO ai_conversations (id, title, model, system_prompt, temperature, total_tokens, message_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            conversation.id,
            conversation.title as Any?,
            conversation.model,
            conversation.systemPrompt as Any?,
            conversation.temperature,
            conversation.totalTokens,
            conversation.messageCount,
            conversation.createdAt.timestampMs,
            conversation.updatedAt.timestampMs
        ]) { _ in () }

        logger.database("Created AI conversation: \(conversation.id)")
    }

    /// 更新对话
    func updateConversation(_ conversation: AIConversationEntity) throws {
        let sql = """
            UPDATE ai_conversations
            SET title = ?, model = ?, system_prompt = ?, temperature = ?, total_tokens = ?, message_count = ?, updated_at = ?
            WHERE id = ?
        """

        _ = try database.query(sql, parameters: [
            conversation.title as Any?,
            conversation.model,
            conversation.systemPrompt as Any?,
            conversation.temperature,
            conversation.totalTokens,
            conversation.messageCount,
            Date().timestampMs,
            conversation.id
        ]) { _ in () }

        logger.database("Updated AI conversation: \(conversation.id)")
    }

    /// 更新对话标题
    func updateConversationTitle(id: String, title: String) throws {
        let sql = "UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [title, Date().timestampMs, id]) { _ in () }

        logger.database("Updated AI conversation title: \(id)")
    }

    /// 更新对话统计信息
    func updateConversationStats(id: String, messageCount: Int, totalTokens: Int) throws {
        let sql = """
            UPDATE ai_conversations
            SET message_count = ?, total_tokens = ?, updated_at = ?
            WHERE id = ?
        """

        _ = try database.query(sql, parameters: [messageCount, totalTokens, Date().timestampMs, id]) { _ in () }

        logger.database("Updated AI conversation stats: \(id)")
    }

    /// 删除对话（级联删除消息）
    func deleteConversation(id: String) throws {
        try database.transaction {
            // 先删除所有消息 - 使用参数化查询防止 SQL 注入
            let deleteMessagesSql = "DELETE FROM ai_messages WHERE conversation_id = ?"
            _ = try database.query(deleteMessagesSql, parameters: [id]) { _ in () }

            // 再删除对话
            let deleteConversationSql = "DELETE FROM ai_conversations WHERE id = ?"
            _ = try database.query(deleteConversationSql, parameters: [id]) { _ in () }
        }

        logger.database("Deleted AI conversation: \(id)")
    }

    // MARK: - Message CRUD

    /// 获取对话的所有消息
    func getMessages(conversationId: String, limit: Int = 1000, offset: Int = 0) throws -> [AIMessageEntity] {
        let sql = """
            SELECT id, conversation_id, role, content, tokens, created_at
            FROM ai_messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
        """

        return try database.query(sql, parameters: [conversationId, limit, offset]) { stmt in
            AIMessageEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                conversationId: String(cString: sqlite3_column_text(stmt, 1)),
                role: String(cString: sqlite3_column_text(stmt, 2)),
                content: String(cString: sqlite3_column_text(stmt, 3)),
                tokens: Int(sqlite3_column_int(stmt, 4)),
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 5)) / 1000)
            )
        }
    }

    /// 获取对话的最后 N 条消息（用于上下文）
    func getRecentMessages(conversationId: String, limit: Int = 20) throws -> [AIMessageEntity] {
        let sql = """
            SELECT id, conversation_id, role, content, tokens, created_at
            FROM ai_messages
            WHERE conversation_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        """

        let messages = try database.query(sql, parameters: [conversationId, limit]) { stmt in
            AIMessageEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                conversationId: String(cString: sqlite3_column_text(stmt, 1)),
                role: String(cString: sqlite3_column_text(stmt, 2)),
                content: String(cString: sqlite3_column_text(stmt, 3)),
                tokens: Int(sqlite3_column_int(stmt, 4)),
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 5)) / 1000)
            )
        }

        // 返回时按时间正序
        return messages.reversed()
    }

    /// 添加消息
    func addMessage(_ message: AIMessageEntity) throws {
        let sql = """
            INSERT INTO ai_messages (id, conversation_id, role, content, tokens, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            message.id,
            message.conversationId,
            message.role,
            message.content,
            message.tokens,
            message.createdAt.timestampMs
        ]) { _ in () }

        // 更新对话的统计信息
        try updateConversationStatsAfterMessage(conversationId: message.conversationId, tokens: message.tokens)

        logger.database("Added AI message: \(message.id)")
    }

    /// 批量添加消息
    func addMessages(_ messages: [AIMessageEntity]) throws {
        guard !messages.isEmpty else { return }

        try database.transaction {
            for message in messages {
                let sql = """
                    INSERT INTO ai_messages (id, conversation_id, role, content, tokens, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """

                _ = try database.query(sql, parameters: [
                    message.id,
                    message.conversationId,
                    message.role,
                    message.content,
                    message.tokens,
                    message.createdAt.timestampMs
                ]) { _ in () }
            }

            // 更新对话统计
            if let conversationId = messages.first?.conversationId {
                let totalTokens = messages.reduce(0) { $0 + $1.tokens }
                try updateConversationStatsAfterMessage(conversationId: conversationId, tokens: totalTokens, count: messages.count)
            }
        }

        logger.database("Added \(messages.count) AI messages")
    }

    /// 更新消息内容（用于流式响应更新）
    func updateMessageContent(id: String, content: String, tokens: Int = 0) throws {
        let sql = "UPDATE ai_messages SET content = ?, tokens = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [content, tokens, id]) { _ in () }

        logger.database("Updated AI message content: \(id)")
    }

    /// 删除消息
    func deleteMessage(id: String) throws {
        let sql = "DELETE FROM ai_messages WHERE id = ?"
        _ = try database.query(sql, parameters: [id]) { _ in () }

        logger.database("Deleted AI message: \(id)")
    }

    /// 清空对话的所有消息
    func clearMessages(conversationId: String) throws {
        let sql = "DELETE FROM ai_messages WHERE conversation_id = ?"
        _ = try database.query(sql, parameters: [conversationId]) { _ in () }

        // 重置对话统计
        try updateConversationStats(id: conversationId, messageCount: 0, totalTokens: 0)

        logger.database("Cleared messages for conversation: \(conversationId)")
    }

    // MARK: - Private Helpers

    /// 消息添加后更新对话统计
    private func updateConversationStatsAfterMessage(conversationId: String, tokens: Int, count: Int = 1) throws {
        let sql = """
            UPDATE ai_conversations
            SET message_count = message_count + ?, total_tokens = total_tokens + ?, updated_at = ?
            WHERE id = ?
        """

        _ = try database.query(sql, parameters: [count, tokens, Date().timestampMs, conversationId]) { _ in () }
    }

    // MARK: - Search

    /// 搜索对话（按标题）
    func searchConversations(query: String, limit: Int = 50) throws -> [AIConversationEntity] {
        let sql = """
            SELECT id, title, model, system_prompt, temperature, total_tokens, message_count, created_at, updated_at
            FROM ai_conversations
            WHERE title LIKE ?
            ORDER BY updated_at DESC
            LIMIT ?
        """

        return try database.query(sql, parameters: ["%\(query)%", limit]) { stmt in
            AIConversationEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                title: sqlite3_column_type(stmt, 1) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 1)) : nil,
                model: String(cString: sqlite3_column_text(stmt, 2)),
                systemPrompt: sqlite3_column_type(stmt, 3) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 3)) : nil,
                temperature: sqlite3_column_double(stmt, 4),
                totalTokens: Int(sqlite3_column_int(stmt, 5)),
                messageCount: Int(sqlite3_column_int(stmt, 6)),
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 7)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 8)) / 1000)
            )
        }
    }

    /// 搜索消息内容
    func searchMessages(query: String, conversationId: String? = nil, limit: Int = 100) throws -> [AIMessageEntity] {
        var sql = """
            SELECT id, conversation_id, role, content, tokens, created_at
            FROM ai_messages
            WHERE content LIKE ?
        """

        var parameters: [Any?] = ["%\(query)%"]

        if let conversationId = conversationId {
            sql += " AND conversation_id = ?"
            parameters.append(conversationId)
        }

        sql += " ORDER BY created_at DESC LIMIT ?"
        parameters.append(limit)

        return try database.query(sql, parameters: parameters) { stmt in
            AIMessageEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                conversationId: String(cString: sqlite3_column_text(stmt, 1)),
                role: String(cString: sqlite3_column_text(stmt, 2)),
                content: String(cString: sqlite3_column_text(stmt, 3)),
                tokens: Int(sqlite3_column_int(stmt, 4)),
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 5)) / 1000)
            )
        }
    }

    // MARK: - Statistics

    /// 获取对话总数
    func getConversationCount() throws -> Int {
        let result: Int? = try database.queryOne("SELECT COUNT(*) FROM ai_conversations") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        }
        return result ?? 0
    }

    /// 获取消息总数
    func getMessageCount() throws -> Int {
        let result: Int? = try database.queryOne("SELECT COUNT(*) FROM ai_messages") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        }
        return result ?? 0
    }

    /// 获取总 Token 使用量
    func getTotalTokens() throws -> Int {
        let result: Int? = try database.queryOne("SELECT SUM(total_tokens) FROM ai_conversations") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        }
        return result ?? 0
    }

    /// 获取统计信息
    func getStatistics() throws -> AIConversationStatistics {
        return AIConversationStatistics(
            conversationCount: try getConversationCount(),
            messageCount: try getMessageCount(),
            totalTokens: try getTotalTokens()
        )
    }
}

// MARK: - Entity Models

/// AI 对话实体
struct AIConversationEntity: Identifiable {
    let id: String
    var title: String?
    let model: String
    var systemPrompt: String?
    var temperature: Double
    var totalTokens: Int
    var messageCount: Int
    let createdAt: Date
    var updatedAt: Date

    init(
        id: String = UUID().uuidString,
        title: String? = nil,
        model: String,
        systemPrompt: String? = nil,
        temperature: Double = 0.7,
        totalTokens: Int = 0,
        messageCount: Int = 0,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.model = model
        self.systemPrompt = systemPrompt
        self.temperature = temperature
        self.totalTokens = totalTokens
        self.messageCount = messageCount
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// 转换为视图模型
    func toConversation() -> AIConversation {
        AIConversation(
            id: id,
            title: title,
            model: model,
            messageCount: messageCount,
            totalTokens: totalTokens,
            updatedAt: updatedAt
        )
    }
}

/// AI 消息实体
struct AIMessageEntity: Identifiable {
    let id: String
    let conversationId: String
    let role: String  // "user", "assistant", "system"
    var content: String
    var tokens: Int
    let createdAt: Date

    init(
        id: String = UUID().uuidString,
        conversationId: String,
        role: String,
        content: String,
        tokens: Int = 0,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.conversationId = conversationId
        self.role = role
        self.content = content
        self.tokens = tokens
        self.createdAt = createdAt
    }

    /// 转换为视图模型
    func toMessage() -> AIMessage {
        let messageRole: AIMessage.MessageRole
        switch role {
        case "user":
            messageRole = .user
        case "assistant":
            messageRole = .assistant
        case "system":
            messageRole = .system
        default:
            messageRole = .user
        }

        return AIMessage(
            id: id,
            role: messageRole,
            content: content,
            createdAt: createdAt
        )
    }
}

/// AI 对话统计
struct AIConversationStatistics {
    let conversationCount: Int
    let messageCount: Int
    let totalTokens: Int
}

