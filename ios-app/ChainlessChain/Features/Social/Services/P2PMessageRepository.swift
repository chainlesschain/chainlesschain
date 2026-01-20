import Foundation
import SQLite3
import CoreDatabase
import CoreCommon

/// P2P 消息数据仓储
/// 负责 P2P 会话和消息的数据库持久化操作
class P2PMessageRepository {
    // MARK: - Singleton

    static let shared = P2PMessageRepository()

    // MARK: - Private Properties

    private let database = DatabaseManager.shared
    private let logger = Logger.shared

    private init() {}

    // MARK: - Conversation CRUD

    /// 获取所有 P2P 会话
    func getAllConversations(limit: Int = 100, offset: Int = 0) throws -> [P2PConversationEntity] {
        let sql = """
            SELECT id, type, title, participant_dids, last_message_id, last_message_at,
                   unread_count, is_pinned, is_muted, created_at, updated_at
            FROM conversations
            WHERE type = 'direct'
            ORDER BY last_message_at DESC NULLS LAST, updated_at DESC
            LIMIT ? OFFSET ?
        """

        return try database.query(sql, parameters: [limit, offset]) { stmt in
            P2PConversationEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                type: String(cString: sqlite3_column_text(stmt, 1)),
                title: sqlite3_column_type(stmt, 2) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 2)) : nil,
                participantDids: String(cString: sqlite3_column_text(stmt, 3)),
                lastMessageId: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                lastMessageAt: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 5)) / 1000) : nil,
                unreadCount: Int(sqlite3_column_int(stmt, 6)),
                isPinned: sqlite3_column_int(stmt, 7) == 1,
                isMuted: sqlite3_column_int(stmt, 8) == 1,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 10)) / 1000)
            )
        }
    }

    /// 根据 ID 获取会话
    func getConversation(id: String) throws -> P2PConversationEntity? {
        let sql = """
            SELECT id, type, title, participant_dids, last_message_id, last_message_at,
                   unread_count, is_pinned, is_muted, created_at, updated_at
            FROM conversations
            WHERE id = ?
        """

        return try database.queryOne(sql, parameters: [id]) { stmt in
            P2PConversationEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                type: String(cString: sqlite3_column_text(stmt, 1)),
                title: sqlite3_column_type(stmt, 2) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 2)) : nil,
                participantDids: String(cString: sqlite3_column_text(stmt, 3)),
                lastMessageId: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                lastMessageAt: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 5)) / 1000) : nil,
                unreadCount: Int(sqlite3_column_int(stmt, 6)),
                isPinned: sqlite3_column_int(stmt, 7) == 1,
                isMuted: sqlite3_column_int(stmt, 8) == 1,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 10)) / 1000)
            )
        }
    }

    /// 根据参与者 DID 查找会话
    func findConversation(participantDid: String) throws -> P2PConversationEntity? {
        let sql = """
            SELECT id, type, title, participant_dids, last_message_id, last_message_at,
                   unread_count, is_pinned, is_muted, created_at, updated_at
            FROM conversations
            WHERE type = 'direct' AND participant_dids LIKE ?
        """

        return try database.queryOne(sql, parameters: ["%\(participantDid)%"]) { stmt in
            P2PConversationEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                type: String(cString: sqlite3_column_text(stmt, 1)),
                title: sqlite3_column_type(stmt, 2) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 2)) : nil,
                participantDids: String(cString: sqlite3_column_text(stmt, 3)),
                lastMessageId: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                lastMessageAt: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 5)) / 1000) : nil,
                unreadCount: Int(sqlite3_column_int(stmt, 6)),
                isPinned: sqlite3_column_int(stmt, 7) == 1,
                isMuted: sqlite3_column_int(stmt, 8) == 1,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 10)) / 1000)
            )
        }
    }

    /// 创建新会话
    func createConversation(_ conversation: P2PConversationEntity) throws {
        let sql = """
            INSERT INTO conversations (id, type, title, participant_dids, last_message_id, last_message_at,
                                       unread_count, is_pinned, is_muted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            conversation.id,
            conversation.type,
            conversation.title as Any?,
            conversation.participantDids,
            conversation.lastMessageId as Any?,
            conversation.lastMessageAt?.timestampMs as Any?,
            conversation.unreadCount,
            conversation.isPinned ? 1 : 0,
            conversation.isMuted ? 1 : 0,
            conversation.createdAt.timestampMs,
            conversation.updatedAt.timestampMs
        ]) { _ in () }

        logger.database("Created P2P conversation: \(conversation.id)")
    }

    /// 获取或创建与指定 DID 的会话
    func getOrCreateConversation(with participantDid: String, myDid: String) throws -> P2PConversationEntity {
        // Input validation
        guard !participantDid.isEmpty else {
            throw P2PRepositoryError.invalidInput("Participant DID cannot be empty")
        }
        guard !myDid.isEmpty else {
            throw P2PRepositoryError.invalidInput("My DID cannot be empty")
        }
        guard participantDid != myDid else {
            throw P2PRepositoryError.invalidInput("Cannot create conversation with yourself")
        }

        // Try to find existing conversation
        if let existing = try findConversation(participantDid: participantDid) {
            return existing
        }

        // Create new conversation
        let conversation = P2PConversationEntity(
            id: UUID().uuidString,
            type: "direct",
            title: nil,
            participantDids: "\(myDid),\(participantDid)",
            lastMessageId: nil,
            lastMessageAt: nil,
            unreadCount: 0,
            isPinned: false,
            isMuted: false,
            createdAt: Date(),
            updatedAt: Date()
        )

        try createConversation(conversation)
        return conversation
    }

    /// 更新会话最后消息
    func updateConversationLastMessage(conversationId: String, messageId: String, messageAt: Date) throws {
        let sql = """
            UPDATE conversations
            SET last_message_id = ?, last_message_at = ?, updated_at = ?
            WHERE id = ?
        """

        _ = try database.query(sql, parameters: [
            messageId,
            messageAt.timestampMs,
            Date().timestampMs,
            conversationId
        ]) { _ in () }

        logger.database("Updated conversation last message: \(conversationId)")
    }

    /// 增加未读计数
    func incrementUnreadCount(conversationId: String) throws {
        let sql = "UPDATE conversations SET unread_count = unread_count + 1, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [Date().timestampMs, conversationId]) { _ in () }
    }

    /// 重置未读计数
    func resetUnreadCount(conversationId: String) throws {
        let sql = "UPDATE conversations SET unread_count = 0, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [Date().timestampMs, conversationId]) { _ in () }
    }

    /// 删除会话（级联删除消息）
    func deleteConversation(id: String) throws {
        // Input validation
        guard !id.isEmpty else {
            throw P2PRepositoryError.invalidInput("Conversation ID cannot be empty")
        }

        // Use parameterized queries to prevent SQL injection
        try database.transaction {
            // Delete all messages using parameterized query
            let deleteMessagesSql = "DELETE FROM messages WHERE conversation_id = ?"
            _ = try database.query(deleteMessagesSql, parameters: [id]) { _ in () }

            // Delete conversation using parameterized query
            let deleteConversationSql = "DELETE FROM conversations WHERE id = ?"
            _ = try database.query(deleteConversationSql, parameters: [id]) { _ in () }
        }

        logger.database("Deleted P2P conversation: \(id)")
    }

    // MARK: - Message CRUD

    /// 获取会话的所有消息
    func getMessages(conversationId: String, limit: Int = 100, offset: Int = 0) throws -> [P2PMessageEntity] {
        let sql = """
            SELECT id, conversation_id, sender_did, content_encrypted, content_type,
                   status, reply_to_id, metadata, created_at, updated_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
        """

        return try database.query(sql, parameters: [conversationId, limit, offset]) { stmt in
            P2PMessageEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                conversationId: String(cString: sqlite3_column_text(stmt, 1)),
                senderDid: String(cString: sqlite3_column_text(stmt, 2)),
                contentEncrypted: String(cString: sqlite3_column_text(stmt, 3)),
                contentType: String(cString: sqlite3_column_text(stmt, 4)),
                status: String(cString: sqlite3_column_text(stmt, 5)),
                replyToId: sqlite3_column_type(stmt, 6) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 6)) : nil,
                metadata: sqlite3_column_type(stmt, 7) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 7)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 8)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000)
            )
        }
    }

    /// 获取最近消息
    func getRecentMessages(conversationId: String, limit: Int = 50) throws -> [P2PMessageEntity] {
        let sql = """
            SELECT id, conversation_id, sender_did, content_encrypted, content_type,
                   status, reply_to_id, metadata, created_at, updated_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        """

        let messages = try database.query(sql, parameters: [conversationId, limit]) { stmt in
            P2PMessageEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                conversationId: String(cString: sqlite3_column_text(stmt, 1)),
                senderDid: String(cString: sqlite3_column_text(stmt, 2)),
                contentEncrypted: String(cString: sqlite3_column_text(stmt, 3)),
                contentType: String(cString: sqlite3_column_text(stmt, 4)),
                status: String(cString: sqlite3_column_text(stmt, 5)),
                replyToId: sqlite3_column_type(stmt, 6) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 6)) : nil,
                metadata: sqlite3_column_type(stmt, 7) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 7)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 8)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000)
            )
        }

        // Return in chronological order
        return messages.reversed()
    }

    /// 保存消息
    func saveMessage(_ message: P2PMessageEntity) throws {
        // Input validation
        guard !message.id.isEmpty else {
            throw P2PRepositoryError.invalidInput("Message ID cannot be empty")
        }
        guard !message.conversationId.isEmpty else {
            throw P2PRepositoryError.invalidInput("Conversation ID cannot be empty")
        }
        guard !message.senderDid.isEmpty else {
            throw P2PRepositoryError.invalidInput("Sender DID cannot be empty")
        }
        // Validate content size (max 10MB for image messages, 64KB for text)
        let maxContentSize = message.contentType == "image" ? 10 * 1024 * 1024 : 64 * 1024
        guard message.contentEncrypted.count <= maxContentSize else {
            throw P2PRepositoryError.invalidInput("Message content exceeds maximum allowed size")
        }

        let sql = """
            INSERT INTO messages (id, conversation_id, sender_did, content_encrypted, content_type,
                                  status, reply_to_id, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            message.id,
            message.conversationId,
            message.senderDid,
            message.contentEncrypted,
            message.contentType,
            message.status,
            message.replyToId as Any?,
            message.metadata as Any?,
            message.createdAt.timestampMs,
            message.updatedAt.timestampMs
        ]) { _ in () }

        // Update conversation's last message
        try updateConversationLastMessage(
            conversationId: message.conversationId,
            messageId: message.id,
            messageAt: message.createdAt
        )

        logger.database("Saved P2P message: \(message.id)")
    }

    /// 更新消息状态
    func updateMessageStatus(id: String, status: String) throws {
        let sql = "UPDATE messages SET status = ?, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [status, Date().timestampMs, id]) { _ in () }

        logger.database("Updated message status: \(id) -> \(status)")
    }

    /// 更新消息内容（用于编辑功能）
    func updateMessageContent(id: String, content: String) throws {
        let sql = "UPDATE messages SET content_encrypted = ?, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [content, Date().timestampMs, id]) { _ in () }

        logger.database("Updated message content: \(id)")
    }

    /// 更新消息元数据
    func updateMessageMetadata(id: String, metadata: String) throws {
        let sql = "UPDATE messages SET metadata = ?, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [metadata, Date().timestampMs, id]) { _ in () }

        logger.database("Updated message metadata: \(id)")
    }

    /// 根据 ID 获取单条消息
    func getMessage(id: String) throws -> P2PMessageEntity? {
        let sql = """
            SELECT id, conversation_id, sender_did, content_encrypted, content_type,
                   status, reply_to_id, metadata, created_at, updated_at
            FROM messages
            WHERE id = ?
        """

        return try database.queryOne(sql, parameters: [id]) { stmt in
            P2PMessageEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                conversationId: String(cString: sqlite3_column_text(stmt, 1)),
                senderDid: String(cString: sqlite3_column_text(stmt, 2)),
                contentEncrypted: String(cString: sqlite3_column_text(stmt, 3)),
                contentType: String(cString: sqlite3_column_text(stmt, 4)),
                status: String(cString: sqlite3_column_text(stmt, 5)),
                replyToId: sqlite3_column_type(stmt, 6) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 6)) : nil,
                metadata: sqlite3_column_type(stmt, 7) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 7)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 8)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000)
            )
        }
    }

    /// 批量更新消息状态
    func updateMessagesStatus(ids: [String], status: String) throws {
        guard !ids.isEmpty else { return }

        try database.transaction {
            for id in ids {
                try updateMessageStatus(id: id, status: status)
            }
        }

        logger.database("Batch updated \(ids.count) messages to status: \(status)")
    }

    /// 删除消息
    func deleteMessage(id: String) throws {
        // Input validation
        guard !id.isEmpty else {
            throw P2PRepositoryError.invalidInput("Message ID cannot be empty")
        }

        // Use parameterized query to prevent SQL injection
        let sql = "DELETE FROM messages WHERE id = ?"
        _ = try database.query(sql, parameters: [id]) { _ in () }

        logger.database("Deleted P2P message: \(id)")
    }

    // MARK: - Search

    /// 搜索消息
    func searchMessages(query: String, conversationId: String? = nil, limit: Int = 100) throws -> [P2PMessageEntity] {
        // Input validation
        guard !query.isEmpty else {
            return [] // Empty query returns no results
        }

        // Sanitize query - escape LIKE special characters to prevent SQL injection
        let sanitizedQuery = query
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")

        // Limit query length to prevent abuse
        let truncatedQuery = String(sanitizedQuery.prefix(500))

        var sql = """
            SELECT id, conversation_id, sender_did, content_encrypted, content_type,
                   status, reply_to_id, metadata, created_at, updated_at
            FROM messages
            WHERE content_encrypted LIKE ? ESCAPE '\\'
        """

        var parameters: [Any?] = ["%\(truncatedQuery)%"]

        if let conversationId = conversationId {
            sql += " AND conversation_id = ?"
            parameters.append(conversationId)
        }

        sql += " ORDER BY created_at DESC LIMIT ?"
        parameters.append(limit)

        return try database.query(sql, parameters: parameters) { stmt in
            P2PMessageEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                conversationId: String(cString: sqlite3_column_text(stmt, 1)),
                senderDid: String(cString: sqlite3_column_text(stmt, 2)),
                contentEncrypted: String(cString: sqlite3_column_text(stmt, 3)),
                contentType: String(cString: sqlite3_column_text(stmt, 4)),
                status: String(cString: sqlite3_column_text(stmt, 5)),
                replyToId: sqlite3_column_type(stmt, 6) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 6)) : nil,
                metadata: sqlite3_column_type(stmt, 7) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 7)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 8)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000)
            )
        }
    }

    // MARK: - Group Conversations

    /// 获取所有群组会话
    func getGroupConversations(limit: Int = 100, offset: Int = 0) throws -> [P2PConversationEntity] {
        let sql = """
            SELECT id, type, title, participant_dids, last_message_id, last_message_at,
                   unread_count, is_pinned, is_muted, created_at, updated_at
            FROM conversations
            WHERE type = 'group'
            ORDER BY last_message_at DESC NULLS LAST, updated_at DESC
            LIMIT ? OFFSET ?
        """

        return try database.query(sql, parameters: [limit, offset]) { stmt in
            P2PConversationEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                type: String(cString: sqlite3_column_text(stmt, 1)),
                title: sqlite3_column_type(stmt, 2) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 2)) : nil,
                participantDids: String(cString: sqlite3_column_text(stmt, 3)),
                lastMessageId: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                lastMessageAt: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 5)) / 1000) : nil,
                unreadCount: Int(sqlite3_column_int(stmt, 6)),
                isPinned: sqlite3_column_int(stmt, 7) == 1,
                isMuted: sqlite3_column_int(stmt, 8) == 1,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 10)) / 1000)
            )
        }
    }

    /// 创建群组会话
    func createGroupConversation(title: String, memberDids: [String], creatorDid: String) throws -> P2PConversationEntity {
        // Input validation
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw P2PRepositoryError.invalidInput("Group title cannot be empty")
        }
        guard memberDids.count >= 2 else {
            throw P2PRepositoryError.invalidInput("Group must have at least 2 members")
        }
        guard !creatorDid.isEmpty else {
            throw P2PRepositoryError.invalidInput("Creator DID cannot be empty")
        }
        guard memberDids.contains(creatorDid) else {
            throw P2PRepositoryError.invalidInput("Creator must be a member of the group")
        }

        // Limit title length
        let truncatedTitle = String(title.prefix(200))

        let participantDidsJson = try JSONEncoder().encode(memberDids)
        let participantDidsString = String(data: participantDidsJson, encoding: .utf8) ?? memberDids.joined(separator: ",")

        let conversation = P2PConversationEntity(
            id: UUID().uuidString,
            type: "group",
            title: truncatedTitle,
            participantDids: participantDidsString,
            lastMessageId: nil,
            lastMessageAt: nil,
            unreadCount: 0,
            isPinned: false,
            isMuted: false,
            createdAt: Date(),
            updatedAt: Date()
        )

        try createConversation(conversation)
        logger.database("Created group conversation: \(conversation.id) with \(memberDids.count) members")
        return conversation
    }

    /// 添加群组成员
    func addGroupMember(conversationId: String, memberDid: String) throws {
        guard let conversation = try getConversation(id: conversationId),
              conversation.type == "group" else {
            throw P2PRepositoryError.conversationNotFound
        }

        var members = conversation.participantDidArray
        guard !members.contains(memberDid) else { return }

        members.append(memberDid)

        let updatedDidsJson = try JSONEncoder().encode(members)
        let updatedDidsString = String(data: updatedDidsJson, encoding: .utf8) ?? members.joined(separator: ",")

        let sql = "UPDATE conversations SET participant_dids = ?, updated_at = ? WHERE id = ?"
        _ = try database.query(sql, parameters: [updatedDidsString, Date().timestampMs, conversationId]) { _ in () }

        logger.database("Added member \(memberDid) to group: \(conversationId)")
    }

    /// 移除群组成员
    func removeGroupMember(conversationId: String, memberDid: String) throws {
        guard let conversation = try getConversation(id: conversationId),
              conversation.type == "group" else {
            throw P2PRepositoryError.conversationNotFound
        }

        var members = conversation.participantDidArray
        members.removeAll { $0 == memberDid }

        let updatedDidsJson = try JSONEncoder().encode(members)
        let updatedDidsString = String(data: updatedDidsJson, encoding: .utf8) ?? members.joined(separator: ",")

        let sql = "UPDATE conversations SET participant_dids = ?, updated_at = ? WHERE id = ?"
        _ = try database.query(sql, parameters: [updatedDidsString, Date().timestampMs, conversationId]) { _ in () }

        logger.database("Removed member \(memberDid) from group: \(conversationId)")
    }

    /// 更新群组标题
    func updateGroupTitle(conversationId: String, title: String) throws {
        // Input validation
        guard !conversationId.isEmpty else {
            throw P2PRepositoryError.invalidInput("Conversation ID cannot be empty")
        }
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw P2PRepositoryError.invalidInput("Group title cannot be empty")
        }

        // Limit title length
        let truncatedTitle = String(title.prefix(200))

        let sql = "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
        _ = try database.query(sql, parameters: [truncatedTitle, Date().timestampMs, conversationId]) { _ in () }

        logger.database("Updated group title: \(conversationId) -> \(truncatedTitle)")
    }

    /// 获取群组成员数量
    func getGroupMemberCount(conversationId: String) throws -> Int {
        guard let conversation = try getConversation(id: conversationId) else {
            return 0
        }
        return conversation.participantDidArray.count
    }

    // MARK: - Statistics

    /// 获取消息统计
    func getStatistics() throws -> P2PMessageStatistics {
        let conversationCount: Int = try database.queryOne("SELECT COUNT(*) FROM conversations WHERE type = 'direct'") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let messageCount: Int = try database.queryOne("SELECT COUNT(*) FROM messages") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let unreadCount: Int = try database.queryOne("SELECT SUM(unread_count) FROM conversations") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        return P2PMessageStatistics(
            conversationCount: conversationCount,
            messageCount: messageCount,
            unreadCount: unreadCount
        )
    }
}

// MARK: - Entity Models

/// P2P 会话实体
struct P2PConversationEntity: Identifiable {
    let id: String
    let type: String  // "direct", "group"
    var title: String?
    let participantDids: String  // JSON array or comma-separated
    var lastMessageId: String?
    var lastMessageAt: Date?
    var unreadCount: Int
    var isPinned: Bool
    var isMuted: Bool
    let createdAt: Date
    var updatedAt: Date

    /// Get participant DIDs as array
    var participantDidArray: [String] {
        // Try JSON parsing first
        if let data = participantDids.data(using: .utf8),
           let array = try? JSONDecoder().decode([String].self, from: data) {
            return array
        }
        // Fall back to comma-separated
        return participantDids.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// Get the other participant's DID (for direct conversations)
    func getOtherParticipant(myDid: String) -> String? {
        return participantDidArray.first { $0 != myDid }
    }
}

/// P2P 消息实体
struct P2PMessageEntity: Identifiable {
    let id: String
    let conversationId: String
    let senderDid: String
    var contentEncrypted: String  // Encrypted content (base64)
    let contentType: String  // "text", "image", "file", "system"
    var status: String  // "sending", "sent", "delivered", "read", "failed", "recalled", "edited"
    var replyToId: String?
    var metadata: String?  // JSON metadata
    let createdAt: Date
    var updatedAt: Date

    /// Check if message is outgoing
    func isOutgoing(myDid: String) -> Bool {
        return senderDid == myDid
    }

    /// Parse metadata JSON
    func getMetadata() -> [String: Any]? {
        guard let data = metadata?.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    /// Check if message is recalled
    var isRecalled: Bool {
        return status == "recalled" || (getMetadata()?["recalled"] as? Bool == true)
    }

    /// Check if message was edited
    var isEdited: Bool {
        return status == "edited" || (getMetadata()?["edited"] as? Bool == true)
    }

    /// Get edit count
    var editCount: Int {
        return (getMetadata()?["editCount"] as? Int) ?? 0
    }

    /// Get status icon name
    var statusIcon: String {
        switch status {
        case "sending": return "clock"
        case "sent": return "checkmark"
        case "delivered": return "checkmark.circle"
        case "read": return "checkmark.circle.fill"
        case "failed": return "exclamationmark.circle"
        case "recalled": return "arrow.uturn.backward"
        case "edited": return "pencil"
        default: return "questionmark.circle"
        }
    }

    /// Get status display text
    var statusDisplayText: String {
        switch status {
        case "sending": return "发送中"
        case "sent": return "已发送"
        case "delivered": return "已送达"
        case "read": return "已读"
        case "failed": return "发送失败"
        case "recalled": return "已撤回"
        case "edited": return "已编辑"
        default: return status
        }
    }

    /// Get display content (handles recalled messages)
    var displayContent: String {
        if isRecalled {
            return "[消息已撤回]"
        }
        return contentEncrypted
    }
}

/// P2P 消息统计
struct P2PMessageStatistics {
    let conversationCount: Int
    let messageCount: Int
    let unreadCount: Int
}

/// P2P 仓储错误
enum P2PRepositoryError: LocalizedError {
    case conversationNotFound
    case messageNotFound
    case invalidGroupOperation
    case invalidInput(String)
    case databaseError(String)

    var errorDescription: String? {
        switch self {
        case .conversationNotFound:
            return "会话不存在"
        case .messageNotFound:
            return "消息不存在"
        case .invalidGroupOperation:
            return "无效的群组操作"
        case .invalidInput(let message):
            return "输入无效: \(message)"
        case .databaseError(let message):
            return "数据库错误: \(message)"
        }
    }
}
