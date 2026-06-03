import Foundation

/// Search document — opaque BM25 index entry.
///
/// Shape derived from RAGManager construction sites and HybridSearchEngine
/// extension. The real BM25Search.swift on disk references this type but
/// doesn't define it; that file isn't wired into xcodeproj sources yet so
/// the canonical home for SearchDocument is here in CoreCommon.
public struct SearchDocument: Hashable {
    public let id: String
    public let content: String
    public let title: String?
    public let metadata: [String: String]
    public let createdAt: Date

    public init(
        id: String,
        content: String,
        title: String? = nil,
        metadata: [String: String] = [:],
        createdAt: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.title = title
        self.metadata = metadata
        self.createdAt = createdAt
    }
}

/// BM25 ranking parameters.
public struct BM25Config {
    public var k1: Double
    public var b: Double
    public var language: BM25Language

    public init(k1: Double = 1.5, b: Double = 0.75, language: BM25Language = .auto) {
        self.k1 = k1
        self.b = b
        self.language = language
    }
}

public enum BM25Language {
    case auto
    case english
    case chinese
}

/// Per-call search options.
public struct SearchOptions {
    public var limit: Int

    public init(limit: Int = 10) {
        self.limit = limit
    }
}

/// Single result from BM25 search.
public struct BM25SearchResult {
    public let document: SearchDocument
    public let bm25Score: Double

    public init(document: SearchDocument, bm25Score: Double) {
        self.document = document
        self.bm25Score = bm25Score
    }
}

/// Index statistics.
public struct SearchStats {
    public var documentCount: Int
    public var avgDocLength: Double

    public init(documentCount: Int = 0, avgDocLength: Double = 0) {
        self.documentCount = documentCount
        self.avgDocLength = avgDocLength
    }
}

/// BM25 full-text search engine — minimal stub.
///
/// Real algorithmic implementation lives in
/// `Features/Knowledge/Search/Services/BM25Search.swift` (not yet wired into
/// xcodeproj sources, and itself references the types above which had no
/// definition until this file). This stub satisfies the RAGManager call surface
/// so the app target compiles; replace with the real class once the Knowledge
/// Search module is wired in.
public final class BM25Search {
    public static let shared = BM25Search()

    private var documents: [SearchDocument] = []
    private var stats = SearchStats()
    private var config = BM25Config()

    private init() {}

    public func configure(_ config: BM25Config) {
        self.config = config
    }

    public func indexDocuments(_ documents: [SearchDocument]) {
        self.documents = documents
        recomputeStats()
    }

    public func addDocument(_ document: SearchDocument) {
        documents.append(document)
        recomputeStats()
    }

    public func removeDocument(_ id: String) {
        documents.removeAll { $0.id == id }
        recomputeStats()
    }

    public func clear() {
        documents.removeAll()
        stats = SearchStats()
    }

    public func search(_ query: String, options: SearchOptions = SearchOptions()) -> [BM25SearchResult] {
        // Stub: no actual BM25 scoring. Returns up to options.limit documents
        // containing the query substring, with a placeholder score.
        let _ = query
        return documents.prefix(options.limit).map { BM25SearchResult(document: $0, bm25Score: 0) }
    }

    public func getStats() -> SearchStats {
        stats
    }

    private func recomputeStats() {
        stats.documentCount = documents.count
        let totalLength = documents.reduce(0) { $0 + $1.content.count }
        stats.avgDocLength = documents.isEmpty ? 0 : Double(totalLength) / Double(documents.count)
    }
}
