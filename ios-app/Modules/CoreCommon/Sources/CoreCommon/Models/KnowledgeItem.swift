import Foundation

/// 知识项 — 个人知识库条目模型
///
/// Shape derived from KnowledgeRepository SQLite columns + view bindings + DAO scaffold.
/// Lives in CoreCommon so app target + CoreDatabase DAO + Knowledge feature share one truth.
public struct KnowledgeItem: Identifiable, Hashable, Codable {
    public enum ContentType: String, Codable, CaseIterable {
        case text
        case markdown
        case code
        case link
    }

    public let id: String
    public var title: String
    public var content: String
    public var contentType: ContentType
    public var tags: [String]
    public var category: String?
    public var sourceURL: String?
    public var isFavorite: Bool
    public var viewCount: Int
    public let createdAt: Date
    public var updatedAt: Date
    public var deleted: Bool

    public init(
        id: String = UUID().uuidString,
        title: String,
        content: String,
        contentType: ContentType = .text,
        tags: [String] = [],
        category: String? = nil,
        sourceURL: String? = nil,
        isFavorite: Bool = false,
        viewCount: Int = 0,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        deleted: Bool = false
    ) {
        self.id = id
        self.title = title
        self.content = content
        self.contentType = contentType
        self.tags = tags
        self.category = category
        self.sourceURL = sourceURL
        self.isFavorite = isFavorite
        self.viewCount = viewCount
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deleted = deleted
    }

    /// CSV form for DB persistence — KnowledgeRepository writes `item.tagsString`.
    public var tagsString: String {
        tags.joined(separator: ",")
    }

    /// Alias for HybridSearchEngine.createDocument(from:) — expects `item.type: String`.
    public var type: String { contentType.rawValue }

    /// Build from raw SQLite reads. KnowledgeRepository.mapKnowledgeItem call site
    /// passes: TEXT id/title/content/contentType, optional TEXT tags(CSV)/category/sourceURL,
    /// INT isFavorite/deleted (0/1), INT viewCount, INT64 createdAt/updatedAt (epoch ms).
    public static func fromDatabase(
        id: String,
        title: String,
        content: String,
        contentType: String,
        tags: String?,
        category: String?,
        sourceURL: String?,
        isFavorite: Int,
        viewCount: Int,
        createdAt: Int64,
        updatedAt: Int64,
        deleted: Int
    ) -> KnowledgeItem {
        let parsedTags = tags?
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty } ?? []
        return KnowledgeItem(
            id: id,
            title: title,
            content: content,
            contentType: ContentType(rawValue: contentType) ?? .text,
            tags: parsedTags,
            category: category,
            sourceURL: sourceURL,
            isFavorite: isFavorite != 0,
            viewCount: viewCount,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAt) / 1000.0),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAt) / 1000.0),
            deleted: deleted != 0
        )
    }
}
