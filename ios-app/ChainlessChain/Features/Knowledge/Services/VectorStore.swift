import Foundation

/// Vector Store - Manages vector storage and similarity search
/// Reference: desktop-app-vue/src/main/vector/vector-store.js
/// iOS implementation uses in-memory storage (no ChromaDB dependency)
@MainActor
class VectorStore: ObservableObject {
    // Configuration
    private let similarityThreshold: Float
    private let topK: Int

    // In-memory vector storage
    private var vectors: [String: VectorEntry] = [:]

    @Published var isInitialized = false

    struct VectorEntry {
        let id: String
        let embedding: [Float]
        let metadata: VectorMetadata
        let document: String
        let timestamp: Date
    }

    struct VectorMetadata: Codable {
        let title: String
        let type: String
        let createdAt: String?
        let updatedAt: String?
    }

    struct SearchResult {
        let id: String
        let score: Float
        let metadata: VectorMetadata
        let document: String
    }

    init(similarityThreshold: Float = 0.6, topK: Int = 10) {
        self.similarityThreshold = similarityThreshold
        self.topK = topK
    }

    /// Initialize vector store
    func initialize() async -> Bool {
        AppLogger.log("[VectorStore] Initializing vector store (in-memory mode)...")

        isInitialized = true
        AppLogger.log("[VectorStore] Vector store initialized successfully")

        return true
    }

    /// Add a single vector
    func addVector(id: String, embedding: [Float], metadata: VectorMetadata, document: String) async throws {
        let entry = VectorEntry(
            id: id,
            embedding: embedding,
            metadata: metadata,
            document: document,
            timestamp: Date()
        )

        vectors[id] = entry
        AppLogger.log("[VectorStore] Added vector: \(metadata.title)")
    }

    /// Add multiple vectors in batch
    func addVectorsBatch(items: [(id: String, embedding: [Float], metadata: VectorMetadata, document: String)]) async throws -> Int {
        for item in items {
            let entry = VectorEntry(
                id: item.id,
                embedding: item.embedding,
                metadata: item.metadata,
                document: item.document,
                timestamp: Date()
            )
            vectors[item.id] = entry
        }

        AppLogger.log("[VectorStore] Batch added \(items.count) vectors")
        return items.count
    }

    /// Update a vector
    func updateVector(id: String, embedding: [Float], metadata: VectorMetadata? = nil) async throws {
        guard var entry = vectors[id] else {
            throw VectorStoreError.vectorNotFound(id)
        }

        entry = VectorEntry(
            id: entry.id,
            embedding: embedding,
            metadata: metadata ?? entry.metadata,
            document: entry.document,
            timestamp: Date()
        )

        vectors[id] = entry
        AppLogger.log("[VectorStore] Updated vector: \(id)")
    }

    /// Delete a vector
    func deleteVector(id: String) async throws {
        guard vectors.removeValue(forKey: id) != nil else {
            throw VectorStoreError.vectorNotFound(id)
        }

        AppLogger.log("[VectorStore] Deleted vector: \(id)")
    }

    /// Search for similar vectors
    /// - Parameters:
    ///   - queryEmbedding: Query vector
    ///   - topK: Number of results to return (optional, uses default if nil)
    ///   - filter: Metadata filter (optional)
    /// - Returns: Array of search results sorted by similarity
    func search(queryEmbedding: [Float], topK: Int? = nil, filter: [String: String]? = nil) async throws -> [SearchResult] {
        let k = topK ?? self.topK
        var results: [SearchResult] = []

        // Calculate similarity for all vectors
        for (id, entry) in vectors {
            // Apply filter if provided
            if let filter = filter {
                var matches = true
                for (key, value) in filter {
                    let metadataValue: String?
                    switch key {
                    case "type":
                        metadataValue = entry.metadata.type
                    case "title":
                        metadataValue = entry.metadata.title
                    default:
                        metadataValue = nil
                    }

                    if metadataValue != value {
                        matches = false
                        break
                    }
                }

                if !matches {
                    continue
                }
            }

            let similarity = cosineSimilarity(queryEmbedding, entry.embedding)

            // Only include results above threshold
            if similarity >= similarityThreshold {
                results.append(SearchResult(
                    id: id,
                    score: similarity,
                    metadata: entry.metadata,
                    document: entry.document
                ))
            }
        }

        // Sort by similarity (descending)
        results.sort { $0.score > $1.score }

        // Return top-K results
        let topResults = Array(results.prefix(k))
        AppLogger.log("[VectorStore] Search returned \(topResults.count) results")

        return topResults
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

    /// Get vector store statistics
    func getStats() async -> VectorStoreStats {
        return VectorStoreStats(
            mode: "memory",
            count: vectors.count,
            collectionName: "knowledge_base"
        )
    }

    /// Clear all vectors
    func clear() async throws {
        vectors.removeAll()
        AppLogger.log("[VectorStore] Vector store cleared")
    }

    /// Rebuild index from knowledge items
    /// - Parameters:
    ///   - items: Knowledge items to index
    ///   - embeddingFn: Function to generate embeddings
    func rebuildIndex(items: [KnowledgeItem], embeddingFn: (String) async throws -> [Float]) async throws {
        AppLogger.log("[VectorStore] Rebuilding index for \(items.count) items...")

        // Clear existing index
        try await clear()

        let batchSize = 10
        var processed = 0

        for i in stride(from: 0, to: items.count, by: batchSize) {
            let endIndex = min(i + batchSize, items.count)
            let batch = Array(items[i..<endIndex])

            // Generate embeddings for batch
            var batchItems: [(id: String, embedding: [Float], metadata: VectorMetadata, document: String)] = []

            for item in batch {
                let text = "\(item.title)\n\(item.content ?? "")"
                let embedding = try await embeddingFn(text)

                let metadata = VectorMetadata(
                    title: item.title,
                    type: item.type,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt
                )

                batchItems.append((
                    id: item.id,
                    embedding: embedding,
                    metadata: metadata,
                    document: item.content ?? item.title
                ))
            }

            // Add batch to vector store
            _ = try await addVectorsBatch(items: batchItems)

            processed += batch.count
            let percentage = Int((Float(processed) / Float(items.count)) * 100)
            AppLogger.log("[VectorStore] Rebuild progress: \(processed)/\(items.count) (\(percentage)%)")
        }

        AppLogger.log("[VectorStore] Index rebuild complete")
    }

    struct VectorStoreStats {
        let mode: String
        let count: Int
        let collectionName: String
    }
}

// MARK: - Error Types

enum VectorStoreError: LocalizedError {
    case vectorNotFound(String)
    case invalidEmbedding
    case searchFailed(String)

    var errorDescription: String? {
        switch self {
        case .vectorNotFound(let id):
            return "Vector not found: \(id)"
        case .invalidEmbedding:
            return "Invalid embedding vector"
        case .searchFailed(let message):
            return "Search failed: \(message)"
        }
    }
}

// MARK: - Logger

private struct AppLogger {
    static func log(_ message: String) {
        print(message)
    }

    static func error(_ message: String) {
        print("❌ \(message)")
    }
}
