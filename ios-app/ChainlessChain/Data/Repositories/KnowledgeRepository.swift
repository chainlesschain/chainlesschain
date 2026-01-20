import Foundation
import CoreCommon
import CoreDatabase

/// 知识库仓储
class KnowledgeRepository {
    static let shared = KnowledgeRepository()

    private let logger = Logger.shared
    private let db = DatabaseManager.shared

    private init() {}

    // MARK: - CRUD Operations

    /// 创建知识库条目
    func create(_ item: KnowledgeItem) throws {
        let sql = """
            INSERT INTO knowledge_items (
                id, title, content, content_type, tags, category, source_url,
                is_favorite, view_count, created_at, updated_at, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """

        let parameters: [Any?] = [
            item.id,
            item.title,
            item.content,
            item.contentType.rawValue,
            item.tagsString,
            item.category,
            item.sourceURL,
            item.isFavorite ? 1 : 0,
            item.viewCount,
            item.createdAt.timestampMs,
            item.updatedAt.timestampMs,
            item.deleted ? 1 : 0
        ]

        try db.execute(sql)
        logger.info("Created knowledge item: \(item.id)", category: "Knowledge")
    }

    /// 更新知识库条目
    func update(_ item: KnowledgeItem) throws {
        let sql = """
            UPDATE knowledge_items SET
                title = ?, content = ?, content_type = ?, tags = ?, category = ?,
                source_url = ?, is_favorite = ?, view_count = ?, updated_at = ?
            WHERE id = ?;
        """

        let parameters: [Any?] = [
            item.title,
            item.content,
            item.contentType.rawValue,
            item.tagsString,
            item.category,
            item.sourceURL,
            item.isFavorite ? 1 : 0,
            item.viewCount,
            Date().timestampMs,
            item.id
        ]

        try db.execute(sql)
        logger.info("Updated knowledge item: \(item.id)", category: "Knowledge")
    }

    /// 删除知识库条目 (软删除)
    func delete(id: String) throws {
        let sql = "UPDATE knowledge_items SET deleted = 1, updated_at = ? WHERE id = ?;"
        try db.execute(sql)
        logger.info("Deleted knowledge item: \(id)", category: "Knowledge")
    }

    /// 永久删除知识库条目
    func permanentDelete(id: String) throws {
        let sql = "DELETE FROM knowledge_items WHERE id = ?;"
        try db.execute(sql)
        logger.info("Permanently deleted knowledge item: \(id)", category: "Knowledge")
    }

    /// 获取单个知识库条目
    func get(id: String) throws -> KnowledgeItem? {
        let sql = """
            SELECT id, title, content, content_type, tags, category, source_url,
                   is_favorite, view_count, created_at, updated_at, deleted
            FROM knowledge_items
            WHERE id = ? AND deleted = 0;
        """

        return try db.queryOne(sql, parameters: [id], mapper: mapKnowledgeItem)
    }

    /// 获取所有知识库条目
    func getAll(limit: Int = 100, offset: Int = 0) throws -> [KnowledgeItem] {
        let sql = """
            SELECT id, title, content, content_type, tags, category, source_url,
                   is_favorite, view_count, created_at, updated_at, deleted
            FROM knowledge_items
            WHERE deleted = 0
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?;
        """

        return try db.query(sql, parameters: [limit, offset], mapper: mapKnowledgeItem)
    }

    /// 搜索知识库条目
    func search(query: String, limit: Int = 50) throws -> [KnowledgeItem] {
        let sql = """
            SELECT id, title, content, content_type, tags, category, source_url,
                   is_favorite, view_count, created_at, updated_at, deleted
            FROM knowledge_items
            WHERE deleted = 0 AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
            ORDER BY updated_at DESC
            LIMIT ?;
        """

        let searchPattern = "%\(query)%"
        return try db.query(
            sql,
            parameters: [searchPattern, searchPattern, searchPattern, limit],
            mapper: mapKnowledgeItem
        )
    }

    /// 按分类获取知识库条目
    func getByCategory(_ category: String, limit: Int = 100) throws -> [KnowledgeItem] {
        let sql = """
            SELECT id, title, content, content_type, tags, category, source_url,
                   is_favorite, view_count, created_at, updated_at, deleted
            FROM knowledge_items
            WHERE deleted = 0 AND category = ?
            ORDER BY updated_at DESC
            LIMIT ?;
        """

        return try db.query(sql, parameters: [category, limit], mapper: mapKnowledgeItem)
    }

    /// 按标签获取知识库条目
    func getByTag(_ tag: String, limit: Int = 100) throws -> [KnowledgeItem] {
        let sql = """
            SELECT id, title, content, content_type, tags, category, source_url,
                   is_favorite, view_count, created_at, updated_at, deleted
            FROM knowledge_items
            WHERE deleted = 0 AND tags LIKE ?
            ORDER BY updated_at DESC
            LIMIT ?;
        """

        let tagPattern = "%\(tag)%"
        return try db.query(sql, parameters: [tagPattern, limit], mapper: mapKnowledgeItem)
    }

    /// 获取收藏的知识库条目
    func getFavorites(limit: Int = 100) throws -> [KnowledgeItem] {
        let sql = """
            SELECT id, title, content, content_type, tags, category, source_url,
                   is_favorite, view_count, created_at, updated_at, deleted
            FROM knowledge_items
            WHERE deleted = 0 AND is_favorite = 1
            ORDER BY updated_at DESC
            LIMIT ?;
        """

        return try db.query(sql, parameters: [limit], mapper: mapKnowledgeItem)
    }

    /// 切换收藏状态
    func toggleFavorite(id: String) throws {
        let sql = """
            UPDATE knowledge_items
            SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END,
                updated_at = ?
            WHERE id = ?;
        """

        try db.execute(sql)
        logger.info("Toggled favorite for knowledge item: \(id)", category: "Knowledge")
    }

    /// 增加查看次数
    func incrementViewCount(id: String) throws {
        let sql = "UPDATE knowledge_items SET view_count = view_count + 1 WHERE id = ?;"
        try db.execute(sql)
    }

    /// 获取所有分类
    func getAllCategories() throws -> [String] {
        let sql = """
            SELECT DISTINCT category
            FROM knowledge_items
            WHERE deleted = 0 AND category IS NOT NULL
            ORDER BY category;
        """

        return try db.query(sql) { stmt in
            guard let cString = sqlite3_column_text(stmt, 0) else { return nil }
            return String(cString: cString)
        }
    }

    /// 获取所有标签
    func getAllTags() throws -> [String] {
        let sql = """
            SELECT DISTINCT tags
            FROM knowledge_items
            WHERE deleted = 0 AND tags IS NOT NULL AND tags != '';
        """

        let tagStrings: [String] = try db.query(sql) { stmt in
            guard let cString = sqlite3_column_text(stmt, 0) else { return nil }
            return String(cString: cString)
        }

        // 拆分并去重
        var allTags = Set<String>()
        for tagString in tagStrings {
            let tags = tagString.split(separator: ",").map(String.init)
            allTags.formUnion(tags)
        }

        return Array(allTags).sorted()
    }

    /// 获取统计信息
    func getStatistics() throws -> KnowledgeStatistics {
        let totalSQL = "SELECT COUNT(*) FROM knowledge_items WHERE deleted = 0;"
        let favoritesSQL = "SELECT COUNT(*) FROM knowledge_items WHERE deleted = 0 AND is_favorite = 1;"
        let categoriesSQL = "SELECT COUNT(DISTINCT category) FROM knowledge_items WHERE deleted = 0 AND category IS NOT NULL;"

        let total: Int = try db.queryOne(totalSQL) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let favorites: Int = try db.queryOne(favoritesSQL) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let categories: Int = try db.queryOne(categoriesSQL) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        return KnowledgeStatistics(
            totalItems: total,
            favoriteItems: favorites,
            categoryCount: categories
        )
    }

    // MARK: - Helper Methods

    private func mapKnowledgeItem(_ stmt: OpaquePointer) -> KnowledgeItem? {
        guard let idCString = sqlite3_column_text(stmt, 0),
              let titleCString = sqlite3_column_text(stmt, 1),
              let contentCString = sqlite3_column_text(stmt, 2),
              let contentTypeCString = sqlite3_column_text(stmt, 3) else {
            return nil
        }

        let id = String(cString: idCString)
        let title = String(cString: titleCString)
        let content = String(cString: contentCString)
        let contentType = String(cString: contentTypeCString)

        let tags = sqlite3_column_text(stmt, 4).map { String(cString: $0) }
        let category = sqlite3_column_text(stmt, 5).map { String(cString: $0) }
        let sourceURL = sqlite3_column_text(stmt, 6).map { String(cString: $0) }

        let isFavorite = Int(sqlite3_column_int(stmt, 7))
        let viewCount = Int(sqlite3_column_int(stmt, 8))
        let createdAt = sqlite3_column_int64(stmt, 9)
        let updatedAt = sqlite3_column_int64(stmt, 10)
        let deleted = Int(sqlite3_column_int(stmt, 11))

        return KnowledgeItem.fromDatabase(
            id: id,
            title: title,
            content: content,
            contentType: contentType,
            tags: tags,
            category: category,
            sourceURL: sourceURL,
            isFavorite: isFavorite,
            viewCount: viewCount,
            createdAt: createdAt,
            updatedAt: updatedAt,
            deleted: deleted
        )
    }
}

// MARK: - Knowledge Statistics

struct KnowledgeStatistics {
    let totalItems: Int
    let favoriteItems: Int
    let categoryCount: Int
}
