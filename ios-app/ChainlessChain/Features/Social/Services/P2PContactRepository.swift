import Foundation
import SQLite3
import CoreDatabase
import CoreCommon

/// P2P 联系人数据仓储
/// 负责 P2P 联系人的数据库持久化操作
class P2PContactRepository {
    // MARK: - Singleton

    static let shared = P2PContactRepository()

    // MARK: - Private Properties

    private let database = DatabaseManager.shared
    private let logger = Logger.shared

    private init() {
        // Ensure contacts table exists
        createTableIfNeeded()
    }

    // MARK: - Table Creation

    private func createTableIfNeeded() {
        let sql = """
            CREATE TABLE IF NOT EXISTS p2p_contacts (
                id TEXT PRIMARY KEY,
                did TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                avatar TEXT,
                public_key TEXT,
                pre_key_bundle TEXT,
                status TEXT DEFAULT 'active',
                is_blocked INTEGER DEFAULT 0,
                is_verified INTEGER DEFAULT 0,
                last_seen_at INTEGER,
                metadata TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """

        do {
            try database.execute(sql)
            logger.database("P2P contacts table ready")
        } catch {
            logger.error("Failed to create p2p_contacts table", error: error, category: "P2P")
        }
    }

    // MARK: - Contact CRUD

    /// 获取所有联系人
    func getAllContacts(includeBlocked: Bool = false) throws -> [P2PContactEntity] {
        var sql = """
            SELECT id, did, name, avatar, public_key, pre_key_bundle, status,
                   is_blocked, is_verified, last_seen_at, metadata, created_at, updated_at
            FROM p2p_contacts
        """

        if !includeBlocked {
            sql += " WHERE is_blocked = 0"
        }

        sql += " ORDER BY name ASC"

        return try database.query(sql, parameters: []) { stmt in
            P2PContactEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                did: String(cString: sqlite3_column_text(stmt, 1)),
                name: String(cString: sqlite3_column_text(stmt, 2)),
                avatar: sqlite3_column_type(stmt, 3) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 3)) : nil,
                publicKey: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                preKeyBundle: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 5)) : nil,
                status: String(cString: sqlite3_column_text(stmt, 6)),
                isBlocked: sqlite3_column_int(stmt, 7) == 1,
                isVerified: sqlite3_column_int(stmt, 8) == 1,
                lastSeenAt: sqlite3_column_type(stmt, 9) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000) : nil,
                metadata: sqlite3_column_type(stmt, 10) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 10)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 11)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 12)) / 1000)
            )
        }
    }

    /// 根据 ID 获取联系人
    func getContact(id: String) throws -> P2PContactEntity? {
        let sql = """
            SELECT id, did, name, avatar, public_key, pre_key_bundle, status,
                   is_blocked, is_verified, last_seen_at, metadata, created_at, updated_at
            FROM p2p_contacts
            WHERE id = ?
        """

        return try database.queryOne(sql, parameters: [id]) { stmt in
            P2PContactEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                did: String(cString: sqlite3_column_text(stmt, 1)),
                name: String(cString: sqlite3_column_text(stmt, 2)),
                avatar: sqlite3_column_type(stmt, 3) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 3)) : nil,
                publicKey: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                preKeyBundle: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 5)) : nil,
                status: String(cString: sqlite3_column_text(stmt, 6)),
                isBlocked: sqlite3_column_int(stmt, 7) == 1,
                isVerified: sqlite3_column_int(stmt, 8) == 1,
                lastSeenAt: sqlite3_column_type(stmt, 9) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000) : nil,
                metadata: sqlite3_column_type(stmt, 10) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 10)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 11)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 12)) / 1000)
            )
        }
    }

    /// 根据 DID 获取联系人
    func getContactByDid(did: String) throws -> P2PContactEntity? {
        let sql = """
            SELECT id, did, name, avatar, public_key, pre_key_bundle, status,
                   is_blocked, is_verified, last_seen_at, metadata, created_at, updated_at
            FROM p2p_contacts
            WHERE did = ?
        """

        return try database.queryOne(sql, parameters: [did]) { stmt in
            P2PContactEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                did: String(cString: sqlite3_column_text(stmt, 1)),
                name: String(cString: sqlite3_column_text(stmt, 2)),
                avatar: sqlite3_column_type(stmt, 3) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 3)) : nil,
                publicKey: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                preKeyBundle: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 5)) : nil,
                status: String(cString: sqlite3_column_text(stmt, 6)),
                isBlocked: sqlite3_column_int(stmt, 7) == 1,
                isVerified: sqlite3_column_int(stmt, 8) == 1,
                lastSeenAt: sqlite3_column_type(stmt, 9) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000) : nil,
                metadata: sqlite3_column_type(stmt, 10) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 10)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 11)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 12)) / 1000)
            )
        }
    }

    /// 添加联系人
    func addContact(_ contact: P2PContactEntity) throws {
        let sql = """
            INSERT INTO p2p_contacts (id, did, name, avatar, public_key, pre_key_bundle, status,
                                       is_blocked, is_verified, last_seen_at, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            contact.id,
            contact.did,
            contact.name,
            contact.avatar as Any?,
            contact.publicKey as Any?,
            contact.preKeyBundle as Any?,
            contact.status,
            contact.isBlocked ? 1 : 0,
            contact.isVerified ? 1 : 0,
            contact.lastSeenAt?.timestampMs as Any?,
            contact.metadata as Any?,
            contact.createdAt.timestampMs,
            contact.updatedAt.timestampMs
        ]) { _ in () }

        logger.database("Added P2P contact: \(contact.id)")
    }

    /// 更新联系人
    func updateContact(_ contact: P2PContactEntity) throws {
        let sql = """
            UPDATE p2p_contacts
            SET name = ?, avatar = ?, public_key = ?, pre_key_bundle = ?, status = ?,
                is_blocked = ?, is_verified = ?, last_seen_at = ?, metadata = ?, updated_at = ?
            WHERE id = ?
        """

        _ = try database.query(sql, parameters: [
            contact.name,
            contact.avatar as Any?,
            contact.publicKey as Any?,
            contact.preKeyBundle as Any?,
            contact.status,
            contact.isBlocked ? 1 : 0,
            contact.isVerified ? 1 : 0,
            contact.lastSeenAt?.timestampMs as Any?,
            contact.metadata as Any?,
            Date().timestampMs,
            contact.id
        ]) { _ in () }

        logger.database("Updated P2P contact: \(contact.id)")
    }

    /// 更新联系人名称
    func updateContactName(id: String, name: String) throws {
        let sql = "UPDATE p2p_contacts SET name = ?, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [name, Date().timestampMs, id]) { _ in () }

        logger.database("Updated contact name: \(id)")
    }

    /// 更新联系人最后在线时间
    func updateLastSeen(did: String, at date: Date = Date()) throws {
        let sql = "UPDATE p2p_contacts SET last_seen_at = ?, updated_at = ? WHERE did = ?"

        _ = try database.query(sql, parameters: [date.timestampMs, Date().timestampMs, did]) { _ in () }

        logger.database("Updated contact last seen: \(did)")
    }

    /// 更新 Pre-Key Bundle
    func updatePreKeyBundle(did: String, bundle: String) throws {
        let sql = "UPDATE p2p_contacts SET pre_key_bundle = ?, updated_at = ? WHERE did = ?"

        _ = try database.query(sql, parameters: [bundle, Date().timestampMs, did]) { _ in () }

        logger.database("Updated contact pre-key bundle: \(did)")
    }

    /// 屏蔽/取消屏蔽联系人
    func setBlocked(id: String, blocked: Bool) throws {
        let sql = "UPDATE p2p_contacts SET is_blocked = ?, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [blocked ? 1 : 0, Date().timestampMs, id]) { _ in () }

        logger.database("\(blocked ? "Blocked" : "Unblocked") contact: \(id)")
    }

    /// 验证/取消验证联系人
    func setVerified(id: String, verified: Bool) throws {
        let sql = "UPDATE p2p_contacts SET is_verified = ?, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [verified ? 1 : 0, Date().timestampMs, id]) { _ in () }

        logger.database("\(verified ? "Verified" : "Unverified") contact: \(id)")
    }

    /// 删除联系人
    func deleteContact(id: String) throws {
        try database.execute("DELETE FROM p2p_contacts WHERE id = '\(id)'")

        logger.database("Deleted P2P contact: \(id)")
    }

    // MARK: - Search

    /// 搜索联系人
    func searchContacts(query: String, limit: Int = 50) throws -> [P2PContactEntity] {
        let sql = """
            SELECT id, did, name, avatar, public_key, pre_key_bundle, status,
                   is_blocked, is_verified, last_seen_at, metadata, created_at, updated_at
            FROM p2p_contacts
            WHERE (name LIKE ? OR did LIKE ?) AND is_blocked = 0
            ORDER BY name ASC
            LIMIT ?
        """

        let searchPattern = "%\(query)%"

        return try database.query(sql, parameters: [searchPattern, searchPattern, limit]) { stmt in
            P2PContactEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                did: String(cString: sqlite3_column_text(stmt, 1)),
                name: String(cString: sqlite3_column_text(stmt, 2)),
                avatar: sqlite3_column_type(stmt, 3) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 3)) : nil,
                publicKey: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                preKeyBundle: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 5)) : nil,
                status: String(cString: sqlite3_column_text(stmt, 6)),
                isBlocked: sqlite3_column_int(stmt, 7) == 1,
                isVerified: sqlite3_column_int(stmt, 8) == 1,
                lastSeenAt: sqlite3_column_type(stmt, 9) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000) : nil,
                metadata: sqlite3_column_type(stmt, 10) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 10)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 11)) / 1000),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 12)) / 1000)
            )
        }
    }

    // MARK: - Statistics

    /// 获取联系人统计
    func getStatistics() throws -> P2PContactStatistics {
        let totalCount: Int = try database.queryOne("SELECT COUNT(*) FROM p2p_contacts") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let blockedCount: Int = try database.queryOne("SELECT COUNT(*) FROM p2p_contacts WHERE is_blocked = 1") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let verifiedCount: Int = try database.queryOne("SELECT COUNT(*) FROM p2p_contacts WHERE is_verified = 1") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        return P2PContactStatistics(
            totalCount: totalCount,
            blockedCount: blockedCount,
            verifiedCount: verifiedCount
        )
    }
}

// MARK: - Entity Model

/// P2P 联系人实体
struct P2PContactEntity: Identifiable {
    let id: String
    let did: String
    var name: String
    var avatar: String?
    var publicKey: String?
    var preKeyBundle: String?
    var status: String  // "active", "pending", "inactive"
    var isBlocked: Bool
    var isVerified: Bool
    var lastSeenAt: Date?
    var metadata: String?
    let createdAt: Date
    var updatedAt: Date

    init(
        id: String = UUID().uuidString,
        did: String,
        name: String,
        avatar: String? = nil,
        publicKey: String? = nil,
        preKeyBundle: String? = nil,
        status: String = "active",
        isBlocked: Bool = false,
        isVerified: Bool = false,
        lastSeenAt: Date? = nil,
        metadata: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.did = did
        self.name = name
        self.avatar = avatar
        self.publicKey = publicKey
        self.preKeyBundle = preKeyBundle
        self.status = status
        self.isBlocked = isBlocked
        self.isVerified = isVerified
        self.lastSeenAt = lastSeenAt
        self.metadata = metadata
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Get display name or truncated DID
    var displayName: String {
        return name.isEmpty ? String(did.prefix(12)) + "..." : name
    }

    /// Get initials for avatar
    var initials: String {
        let words = name.components(separatedBy: .whitespaces)
        let firstInitials = words.prefix(2).compactMap { $0.first }
        return String(firstInitials).uppercased()
    }
}

/// P2P 联系人统计
struct P2PContactStatistics {
    let totalCount: Int
    let blockedCount: Int
    let verifiedCount: Int
}
