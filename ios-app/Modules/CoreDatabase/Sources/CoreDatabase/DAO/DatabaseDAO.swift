import Foundation
import SQLite3
import CoreCommon

// MARK: - Base DAO Protocol

public protocol BaseDAO {
    associatedtype Entity: DatabaseEntity

    func insert(_ entity: Entity) throws
    func update(_ entity: Entity) throws
    func delete(id: String) throws
    func findById(_ id: String) throws -> Entity?
    func findAll() throws -> [Entity]
}

// MARK: - Knowledge Item DAO

public class KnowledgeItemDAO {
    private let db: DatabaseManager

    public init(db: DatabaseManager = .shared) {
        self.db = db
    }

    public func insert(_ item: KnowledgeItem) throws {
        let sql = """
            INSERT INTO knowledge_items (id, title, content, content_type, tags, category, source_url, is_favorite, view_count, created_at, updated_at, deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        try db.execute(sql)
    }

    public func update(_ item: KnowledgeItem) throws {
        let sql = """
            UPDATE knowledge_items
            SET title = ?, content = ?, content_type = ?, tags = ?, category = ?, source_url = ?, is_favorite = ?, view_count = ?, updated_at = ?
            WHERE id = ?;
        """
        try db.execute(sql)
    }

    public func delete(id: String) throws {
        let sql = "UPDATE knowledge_items SET deleted = 1, updated_at = ? WHERE id = ?;"
        try db.execute(sql)
    }

    public func hardDelete(id: String) throws {
        let sql = "DELETE FROM knowledge_items WHERE id = ?;"
        try db.execute(sql)
    }

    public func findById(_ id: String) throws -> KnowledgeItem? {
        let sql = "SELECT * FROM knowledge_items WHERE id = ? AND deleted = 0;"
        return try db.queryOne(sql, parameters: [id], mapper: Self.mapRow)
    }

    public func findAll(limit: Int = 50, offset: Int = 0) throws -> [KnowledgeItem] {
        let sql = "SELECT * FROM knowledge_items WHERE deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?;"
        return try db.query(sql, parameters: [limit, offset], mapper: Self.mapRow)
    }

    public func search(query: String, limit: Int = 50) throws -> [KnowledgeItem] {
        let sql = """
            SELECT * FROM knowledge_items
            WHERE deleted = 0 AND (title LIKE ? OR content LIKE ?)
            ORDER BY created_at DESC LIMIT ?;
        """
        let pattern = "%\(query)%"
        return try db.query(sql, parameters: [pattern, pattern, limit], mapper: Self.mapRow)
    }

    public func findByCategory(_ category: String, limit: Int = 50) throws -> [KnowledgeItem] {
        let sql = "SELECT * FROM knowledge_items WHERE deleted = 0 AND category = ? ORDER BY created_at DESC LIMIT ?;"
        return try db.query(sql, parameters: [category, limit], mapper: Self.mapRow)
    }

    public func findFavorites(limit: Int = 50) throws -> [KnowledgeItem] {
        let sql = "SELECT * FROM knowledge_items WHERE deleted = 0 AND is_favorite = 1 ORDER BY created_at DESC LIMIT ?;"
        return try db.query(sql, parameters: [limit], mapper: Self.mapRow)
    }

    public func incrementViewCount(id: String) throws {
        let sql = "UPDATE knowledge_items SET view_count = view_count + 1 WHERE id = ?;"
        try db.execute(sql)
    }

    private static func mapRow(_ stmt: OpaquePointer) -> KnowledgeItem? {
        let id = String(cString: sqlite3_column_text(stmt, 0))
        let title = String(cString: sqlite3_column_text(stmt, 1))
        let content = String(cString: sqlite3_column_text(stmt, 2))
        let contentType = String(cString: sqlite3_column_text(stmt, 3))
        let tagsStr = sqlite3_column_text(stmt, 4).map { String(cString: $0) }
        let category = sqlite3_column_text(stmt, 5).map { String(cString: $0) }
        let sourceUrl = sqlite3_column_text(stmt, 6).map { String(cString: $0) }
        let isFavorite = sqlite3_column_int(stmt, 7) == 1
        let viewCount = Int(sqlite3_column_int(stmt, 8))
        let createdAt = sqlite3_column_int64(stmt, 9)
        let updatedAt = sqlite3_column_int64(stmt, 10)
        let deleted = sqlite3_column_int(stmt, 11) == 1

        let tags = tagsStr?.split(separator: ",").map { String($0) } ?? []

        return KnowledgeItem(
            id: id,
            title: title,
            content: content,
            contentType: contentType,
            tags: tags,
            category: category,
            sourceUrl: sourceUrl,
            isFavorite: isFavorite,
            viewCount: viewCount,
            createdAt: createdAt,
            updatedAt: updatedAt,
            deleted: deleted
        )
    }
}

// MARK: - AI Conversation DAO

public class AIConversationDAO {
    private let db: DatabaseManager

    public init(db: DatabaseManager = .shared) {
        self.db = db
    }

    public func insert(_ conversation: AIConversation) throws {
        let sql = """
            INSERT INTO ai_conversations (id, title, model, system_prompt, temperature, total_tokens, message_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        try db.execute(sql)
    }

    public func update(_ conversation: AIConversation) throws {
        let sql = """
            UPDATE ai_conversations
            SET title = ?, system_prompt = ?, temperature = ?, total_tokens = ?, message_count = ?, updated_at = ?
            WHERE id = ?;
        """
        try db.execute(sql)
    }

    public func delete(id: String) throws {
        // 删除关联消息
        try db.execute("DELETE FROM ai_messages WHERE conversation_id = '\(id)';")
        // 删除对话
        try db.execute("DELETE FROM ai_conversations WHERE id = '\(id)';")
    }

    public func findById(_ id: String) throws -> AIConversation? {
        let sql = "SELECT * FROM ai_conversations WHERE id = ?;"
        return try db.queryOne(sql, parameters: [id], mapper: Self.mapRow)
    }

    public func findAll(limit: Int = 50, offset: Int = 0) throws -> [AIConversation] {
        let sql = "SELECT * FROM ai_conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?;"
        return try db.query(sql, parameters: [limit, offset], mapper: Self.mapRow)
    }

    public func updateTokenCount(id: String, tokens: Int) throws {
        let sql = "UPDATE ai_conversations SET total_tokens = total_tokens + ?, message_count = message_count + 1, updated_at = ? WHERE id = ?;"
        try db.execute(sql)
    }

    private static func mapRow(_ stmt: OpaquePointer) -> AIConversation? {
        let id = String(cString: sqlite3_column_text(stmt, 0))
        let title = sqlite3_column_text(stmt, 1).map { String(cString: $0) }
        let model = String(cString: sqlite3_column_text(stmt, 2))
        let systemPrompt = sqlite3_column_text(stmt, 3).map { String(cString: $0) }
        let temperature = sqlite3_column_double(stmt, 4)
        let totalTokens = Int(sqlite3_column_int(stmt, 5))
        let messageCount = Int(sqlite3_column_int(stmt, 6))
        let createdAt = sqlite3_column_int64(stmt, 7)
        let updatedAt = sqlite3_column_int64(stmt, 8)

        return AIConversation(
            id: id,
            title: title,
            model: model,
            systemPrompt: systemPrompt,
            temperature: temperature,
            totalTokens: totalTokens,
            messageCount: messageCount,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

// MARK: - AI Message DAO

public class AIMessageDAO {
    private let db: DatabaseManager

    public init(db: DatabaseManager = .shared) {
        self.db = db
    }

    public func insert(_ message: AIMessage) throws {
        let sql = """
            INSERT INTO ai_messages (id, conversation_id, role, content, tokens, created_at)
            VALUES (?, ?, ?, ?, ?, ?);
        """
        try db.execute(sql)
    }

    public func delete(id: String) throws {
        let sql = "DELETE FROM ai_messages WHERE id = ?;"
        try db.execute(sql)
    }

    public func findByConversation(_ conversationId: String, limit: Int = 100, offset: Int = 0) throws -> [AIMessage] {
        let sql = "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?;"
        return try db.query(sql, parameters: [conversationId, limit, offset], mapper: Self.mapRow)
    }

    public func deleteByConversation(_ conversationId: String) throws {
        let sql = "DELETE FROM ai_messages WHERE conversation_id = ?;"
        try db.execute(sql)
    }

    private static func mapRow(_ stmt: OpaquePointer) -> AIMessage? {
        let id = String(cString: sqlite3_column_text(stmt, 0))
        let conversationId = String(cString: sqlite3_column_text(stmt, 1))
        let roleStr = String(cString: sqlite3_column_text(stmt, 2))
        let content = String(cString: sqlite3_column_text(stmt, 3))
        let tokens = Int(sqlite3_column_int(stmt, 4))
        let createdAt = sqlite3_column_int64(stmt, 5)

        guard let role = AIMessageRole(rawValue: roleStr) else { return nil }

        return AIMessage(
            id: id,
            conversationId: conversationId,
            role: role,
            content: content,
            tokens: tokens,
            createdAt: createdAt
        )
    }
}

// MARK: - Contact DAO

public class ContactDAO {
    private let db: DatabaseManager

    public init(db: DatabaseManager = .shared) {
        self.db = db
    }

    public func insert(_ contact: Contact) throws {
        let sql = """
            INSERT INTO contacts (id, did, display_name, avatar_url, public_key, status, is_blocked, added_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        try db.execute(sql)
    }

    public func update(_ contact: Contact) throws {
        let sql = """
            UPDATE contacts
            SET display_name = ?, avatar_url = ?, public_key = ?, status = ?, is_blocked = ?, updated_at = ?
            WHERE id = ?;
        """
        try db.execute(sql)
    }

    public func delete(id: String) throws {
        let sql = "DELETE FROM contacts WHERE id = ?;"
        try db.execute(sql)
    }

    public func findById(_ id: String) throws -> Contact? {
        let sql = "SELECT * FROM contacts WHERE id = ?;"
        return try db.queryOne(sql, parameters: [id], mapper: Self.mapRow)
    }

    public func findByDid(_ did: String) throws -> Contact? {
        let sql = "SELECT * FROM contacts WHERE did = ?;"
        return try db.queryOne(sql, parameters: [did], mapper: Self.mapRow)
    }

    public func findAll(limit: Int = 100) throws -> [Contact] {
        let sql = "SELECT * FROM contacts WHERE is_blocked = 0 ORDER BY display_name ASC LIMIT ?;"
        return try db.query(sql, parameters: [limit], mapper: Self.mapRow)
    }

    public func findBlocked() throws -> [Contact] {
        let sql = "SELECT * FROM contacts WHERE is_blocked = 1 ORDER BY display_name ASC;"
        return try db.query(sql, mapper: Self.mapRow)
    }

    public func search(query: String) throws -> [Contact] {
        let sql = "SELECT * FROM contacts WHERE display_name LIKE ? OR did LIKE ? ORDER BY display_name ASC;"
        let pattern = "%\(query)%"
        return try db.query(sql, parameters: [pattern, pattern], mapper: Self.mapRow)
    }

    private static func mapRow(_ stmt: OpaquePointer) -> Contact? {
        let id = String(cString: sqlite3_column_text(stmt, 0))
        let did = String(cString: sqlite3_column_text(stmt, 1))
        let displayName = sqlite3_column_text(stmt, 2).map { String(cString: $0) }
        let avatarUrl = sqlite3_column_text(stmt, 3).map { String(cString: $0) }
        let publicKey = sqlite3_column_text(stmt, 4).map { String(cString: $0) }
        let statusStr = String(cString: sqlite3_column_text(stmt, 5))
        let isBlocked = sqlite3_column_int(stmt, 6) == 1
        let addedAt = sqlite3_column_int64(stmt, 7)
        let updatedAt = sqlite3_column_int64(stmt, 8)

        let status = ContactStatus(rawValue: statusStr) ?? .pending

        return Contact(
            id: id,
            did: did,
            displayName: displayName,
            avatarUrl: avatarUrl,
            publicKey: publicKey,
            status: status,
            isBlocked: isBlocked,
            addedAt: addedAt,
            updatedAt: updatedAt
        )
    }
}

// MARK: - Settings DAO

public class SettingsDAO {
    private let db: DatabaseManager

    public init(db: DatabaseManager = .shared) {
        self.db = db
    }

    public func set(key: String, value: String) throws {
        let sql = """
            INSERT OR REPLACE INTO settings (key, value, updated_at)
            VALUES (?, ?, ?);
        """
        try db.execute(sql)
    }

    public func get(key: String) throws -> String? {
        let sql = "SELECT value FROM settings WHERE key = ?;"
        return try db.queryOne(sql, parameters: [key]) { stmt in
            return String(cString: sqlite3_column_text(stmt, 0))
        }
    }

    public func delete(key: String) throws {
        let sql = "DELETE FROM settings WHERE key = ?;"
        try db.execute(sql)
    }

    public func getAll() throws -> [Setting] {
        let sql = "SELECT key, value, updated_at FROM settings;"
        return try db.query(sql) { stmt in
            let key = String(cString: sqlite3_column_text(stmt, 0))
            let value = String(cString: sqlite3_column_text(stmt, 1))
            let updatedAt = sqlite3_column_int64(stmt, 2)
            return Setting(key: key, value: value, updatedAt: updatedAt)
        }
    }
}
