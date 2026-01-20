import Foundation
import SQLite3
import CoreDatabase
import CoreCommon

/// 向量存储持久化仓储
/// 将向量数据持久化到 SQLite 数据库中
class VectorStoreRepository {
    // MARK: - Singleton

    static let shared = VectorStoreRepository()

    // MARK: - Private Properties

    private let database = DatabaseManager.shared
    private let logger = Logger.shared

    // Dimension for embeddings (typical for most embedding models)
    private let embeddingDimension = 384  // nomic-embed-text default

    private init() {
        createTableIfNeeded()
    }

    // MARK: - Table Creation

    private func createTableIfNeeded() {
        // Create vector storage table
        let createVectorsTable = """
            CREATE TABLE IF NOT EXISTS vector_embeddings (
                id TEXT PRIMARY KEY,
                embedding BLOB NOT NULL,
                document TEXT NOT NULL,
                title TEXT NOT NULL,
                content_type TEXT DEFAULT 'text',
                metadata TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """

        // Create embedding cache table for query embeddings
        let createCacheTable = """
            CREATE TABLE IF NOT EXISTS embedding_cache (
                text_hash TEXT PRIMARY KEY,
                embedding BLOB NOT NULL,
                model TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER
            )
        """

        do {
            try database.execute(createVectorsTable)
            try database.execute(createCacheTable)

            // Create indexes
            try database.execute("CREATE INDEX IF NOT EXISTS idx_vector_type ON vector_embeddings(content_type)")
            try database.execute("CREATE INDEX IF NOT EXISTS idx_cache_expires ON embedding_cache(expires_at)")

            logger.database("Vector store tables ready")
        } catch {
            logger.error("Failed to create vector store tables", error: error, category: "RAG")
        }
    }

    // MARK: - Vector CRUD

    /// Save vector embedding
    func saveVector(_ entry: RepoVectorEntry) throws {
        let sql = """
            INSERT OR REPLACE INTO vector_embeddings
            (id, embedding, document, title, content_type, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

        let embeddingData = encodeEmbedding(entry.embedding)
        let metadataJson = try? JSONEncoder().encode(entry.metadata)
        let metadataString = metadataJson.flatMap { String(data: $0, encoding: .utf8) }

        _ = try database.query(sql, parameters: [
            entry.id,
            embeddingData,
            entry.document,
            entry.metadata.title,
            entry.metadata.type,
            metadataString as Any?,
            entry.timestamp.timestampMs,
            Date().timestampMs
        ]) { _ in () }

        logger.database("Saved vector: \(entry.id)")
    }

    /// Save vectors in batch
    func saveVectorsBatch(_ entries: [RepoVectorEntry]) throws {
        try database.transaction {
            for entry in entries {
                try saveVector(entry)
            }
        }

        logger.database("Batch saved \(entries.count) vectors")
    }

    /// Get vector by ID
    func getVector(id: String) throws -> RepoVectorEntry? {
        let sql = """
            SELECT id, embedding, document, title, content_type, metadata, created_at, updated_at
            FROM vector_embeddings
            WHERE id = ?
        """

        return try database.queryOne(sql, parameters: [id]) { stmt in
            parseVectorEntry(stmt)
        }
    }

    /// Get all vectors
    func getAllVectors() throws -> [RepoVectorEntry] {
        let sql = """
            SELECT id, embedding, document, title, content_type, metadata, created_at, updated_at
            FROM vector_embeddings
            ORDER BY created_at DESC
        """

        return try database.query(sql, parameters: []) { stmt in
            parseVectorEntry(stmt)
        }
    }

    /// Get vectors by type
    func getVectorsByType(_ type: String) throws -> [RepoVectorEntry] {
        let sql = """
            SELECT id, embedding, document, title, content_type, metadata, created_at, updated_at
            FROM vector_embeddings
            WHERE content_type = ?
            ORDER BY created_at DESC
        """

        return try database.query(sql, parameters: [type]) { stmt in
            parseVectorEntry(stmt)
        }
    }

    /// Delete vector by ID
    func deleteVector(id: String) throws {
        let sql = "DELETE FROM vector_embeddings WHERE id = ?"
        _ = try database.query(sql, parameters: [id]) { _ in () }
        logger.database("Deleted vector: \(id)")
    }

    /// Delete all vectors
    func deleteAllVectors() throws {
        try database.execute("DELETE FROM vector_embeddings")
        logger.database("Deleted all vectors")
    }

    /// Get vector count
    func getVectorCount() throws -> Int {
        let result: Int? = try database.queryOne("SELECT COUNT(*) FROM vector_embeddings") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        }
        return result ?? 0
    }

    // MARK: - Embedding Cache

    /// Cache embedding for a text
    func cacheEmbedding(textHash: String, embedding: [Float], model: String, expiresIn: TimeInterval? = nil) throws {
        let sql = """
            INSERT OR REPLACE INTO embedding_cache
            (text_hash, embedding, model, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
        """

        let embeddingData = encodeEmbedding(embedding)
        let expiresAt = expiresIn.map { Date().addingTimeInterval($0).timestampMs }

        _ = try database.query(sql, parameters: [
            textHash,
            embeddingData,
            model,
            Date().timestampMs,
            expiresAt as Any?
        ]) { _ in () }
    }

    /// Get cached embedding
    func getCachedEmbedding(textHash: String) throws -> [Float]? {
        let sql = """
            SELECT embedding FROM embedding_cache
            WHERE text_hash = ? AND (expires_at IS NULL OR expires_at > ?)
        """

        let embeddingData: Data? = try database.queryOne(sql, parameters: [textHash, Date().timestampMs]) { stmt in
            let blobPointer = sqlite3_column_blob(stmt, 0)
            let blobSize = Int(sqlite3_column_bytes(stmt, 0))
            guard let ptr = blobPointer, blobSize > 0 else { return nil }
            return Data(bytes: ptr, count: blobSize)
        }

        return embeddingData.flatMap { decodeEmbedding($0) }
    }

    /// Clear expired cache entries
    func clearExpiredCache() throws {
        let sql = "DELETE FROM embedding_cache WHERE expires_at IS NOT NULL AND expires_at < ?"
        _ = try database.query(sql, parameters: [Date().timestampMs]) { _ in () }
        logger.database("Cleared expired embedding cache")
    }

    /// Clear all cache
    func clearCache() throws {
        try database.execute("DELETE FROM embedding_cache")
        logger.database("Cleared embedding cache")
    }

    /// Get cache statistics
    func getCacheStats() throws -> RepoCacheStatistics {
        let totalCount: Int = try database.queryOne("SELECT COUNT(*) FROM embedding_cache") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let expiredCount: Int = try database.queryOne(
            "SELECT COUNT(*) FROM embedding_cache WHERE expires_at IS NOT NULL AND expires_at < ?"
        , parameters: [Date().timestampMs]) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        return RepoCacheStatistics(
            totalCount: totalCount,
            expiredCount: expiredCount,
            validCount: totalCount - expiredCount
        )
    }

    // MARK: - Similarity Search (SQLite-based)

    /// Perform similarity search using brute-force cosine similarity
    /// For large datasets, consider using approximate nearest neighbor algorithms
    func search(queryEmbedding: [Float], topK: Int = 10, similarityThreshold: Float = 0.6, typeFilter: String? = nil) throws -> [RepoSearchResult] {
        var sql = """
            SELECT id, embedding, document, title, content_type, metadata, created_at, updated_at
            FROM vector_embeddings
        """

        var parameters: [Any?] = []

        if let type = typeFilter {
            sql += " WHERE content_type = ?"
            parameters.append(type)
        }

        let entries = try database.query(sql, parameters: parameters) { stmt in
            parseVectorEntry(stmt)
        }

        // Calculate similarities in memory (for small-medium datasets)
        var results: [RepoSearchResult] = []

        for entry in entries {
            let similarity = cosineSimilarity(queryEmbedding, entry.embedding)

            if similarity >= similarityThreshold {
                results.append(RepoSearchResult(
                    id: entry.id,
                    score: similarity,
                    document: entry.document,
                    metadata: entry.metadata
                ))
            }
        }

        // Sort by similarity and return top-K
        results.sort { $0.score > $1.score }
        return Array(results.prefix(topK))
    }

    // MARK: - Helper Methods

    /// Encode embedding array to Data
    private func encodeEmbedding(_ embedding: [Float]) -> Data {
        return embedding.withUnsafeBytes { Data($0) }
    }

    /// Decode Data to embedding array
    private func decodeEmbedding(_ data: Data) -> [Float] {
        return data.withUnsafeBytes { ptr in
            Array(ptr.bindMemory(to: Float.self))
        }
    }

    /// Parse VectorEntry from SQLite statement
    private func parseVectorEntry(_ stmt: OpaquePointer?) -> RepoVectorEntry {
        let id = String(cString: sqlite3_column_text(stmt, 0))

        // Safely handle embedding data
        var embedding: [Float] = []
        if let embeddingPointer = sqlite3_column_blob(stmt, 1) {
            let embeddingSize = Int(sqlite3_column_bytes(stmt, 1))
            if embeddingSize > 0 {
                let embeddingData = Data(bytes: embeddingPointer, count: embeddingSize)
                embedding = decodeEmbedding(embeddingData)
            }
        }

        let document = String(cString: sqlite3_column_text(stmt, 2))
        let title = String(cString: sqlite3_column_text(stmt, 3))
        let contentType = String(cString: sqlite3_column_text(stmt, 4))

        var metadata = RepoVectorMetadata(title: title, type: contentType, createdAt: nil, updatedAt: nil)
        if sqlite3_column_type(stmt, 5) != SQLITE_NULL {
            let metadataString = String(cString: sqlite3_column_text(stmt, 5))
            if let metadataData = metadataString.data(using: .utf8),
               let decoded = try? JSONDecoder().decode(RepoVectorMetadata.self, from: metadataData) {
                metadata = decoded
            }
        }

        let timestamp = Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 6)) / 1000)

        return RepoVectorEntry(
            id: id,
            embedding: embedding,
            metadata: metadata,
            document: document,
            timestamp: timestamp
        )
    }

    /// Calculate cosine similarity between two vectors
    private func cosineSimilarity(_ vecA: [Float], _ vecB: [Float]) -> Float {
        guard vecA.count == vecB.count, !vecA.isEmpty else {
            return 0
        }

        var dotProduct: Float = 0
        var normA: Float = 0
        var normB: Float = 0

        for i in 0..<vecA.count {
            dotProduct += vecA[i] * vecB[i]
            normA += vecA[i] * vecA[i]
            normB += vecB[i] * vecB[i]
        }

        guard normA > 0, normB > 0 else {
            return 0
        }

        return dotProduct / (sqrt(normA) * sqrt(normB))
    }

    // MARK: - Statistics

    func getStatistics() throws -> RepoVectorStoreStatistics {
        let vectorCount = try getVectorCount()
        let cacheStats = try getCacheStats()

        // Calculate storage size
        let storageSize: Int64 = try database.queryOne(
            "SELECT SUM(LENGTH(embedding)) FROM vector_embeddings"
        ) { stmt in
            sqlite3_column_int64(stmt, 0)
        } ?? 0

        return RepoVectorStoreStatistics(
            vectorCount: vectorCount,
            cacheCount: cacheStats.totalCount,
            storageSizeBytes: storageSize,
            mode: "sqlite"
        )
    }
}

// MARK: - Data Models

struct RepoVectorEntry: Identifiable {
    let id: String
    let embedding: [Float]
    let metadata: RepoVectorMetadata
    let document: String
    let timestamp: Date
}

struct RepoVectorMetadata: Codable {
    let title: String
    let type: String
    let createdAt: String?
    let updatedAt: String?
}

struct RepoSearchResult {
    let id: String
    let score: Float
    let document: String
    let metadata: RepoVectorMetadata
}

struct RepoCacheStatistics {
    let totalCount: Int
    let expiredCount: Int
    let validCount: Int
}

struct RepoVectorStoreStatistics {
    let vectorCount: Int
    let cacheCount: Int
    let storageSizeBytes: Int64
    let mode: String

    var storageSizeMB: Double {
        Double(storageSizeBytes) / (1024 * 1024)
    }
}
