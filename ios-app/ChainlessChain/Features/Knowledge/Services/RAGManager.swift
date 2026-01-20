import Foundation
import CoreCommon

/// RAG Manager - Retrieval-Augmented Generation for knowledge base
/// Reference: desktop-app-vue/src/main/rag/rag-manager.js
@MainActor
class RAGManager: ObservableObject {
    static let shared = RAGManager()

    private let logger = Logger.shared

    // Services
    private let embeddingsService: EmbeddingsService
    private let vectorStore: VectorStore
    private var llmManager: LLMManager
    private var knowledgeRepository: KnowledgeRepository?

    // Configuration
    @Published var config: RAGConfig

    @Published var isInitialized = false
    @Published var indexProgress: IndexProgress?

    struct RAGConfig {
        var enableRAG: Bool = true
        var topK: Int = 10
        var similarityThreshold: Float = 0.6
        var maxContextLength: Int = 6000
        var enableHybridSearch: Bool = true
        var vectorWeight: Float = 0.6
        var keywordWeight: Float = 0.4
        var chunkSize: Int = 500
        var chunkOverlap: Int = 50
    }

    struct IndexProgress {
        let processed: Int
        let total: Int
        var percentage: Int {
            total > 0 ? Int((Float(processed) / Float(total)) * 100) : 0
        }
    }

    private init() {
        self.llmManager = LLMManager.shared
        self.embeddingsService = EmbeddingsService(llmManager: llmManager)
        self.vectorStore = VectorStore(
            similarityThreshold: 0.6,
            topK: 10
        )
        self.config = RAGConfig()
    }

    /// Set knowledge repository
    func setKnowledgeRepository(_ repository: KnowledgeRepository) {
        self.knowledgeRepository = repository
    }

    /// Initialize RAG manager
    func initialize() async throws {
        logger.debug("[RAGManager] Initializing RAG manager...")

        // Initialize embeddings service
        try await embeddingsService.initialize()

        // Initialize vector store
        _ = await vectorStore.initialize()

        // Build vector index
        await buildVectorIndex()

        isInitialized = true
        logger.debug("[RAGManager] RAG manager initialized successfully")
    }

    /// Build vector index from knowledge base
    func buildVectorIndex() async {
        guard config.enableRAG else {
            logger.debug("[RAGManager] RAG disabled, skipping index build")
            return
        }

        guard let repository = knowledgeRepository else {
            logger.warning("[RAGManager] Knowledge repository not set")
            return
        }

        logger.debug("[RAGManager] Building vector index...")

        do {
            // Get all knowledge items
            let items = repository.getAllItems()

            guard !items.isEmpty else {
                logger.debug("[RAGManager] Knowledge base is empty")
                return
            }

            logger.debug("[RAGManager] Indexing \(items.count) items...")

            // Rebuild index
            try await vectorStore.rebuildIndex(items: items) { text in
                try await self.embeddingsService.generateEmbedding(text)
            }

            let stats = await vectorStore.getStats()
            logger.debug("[RAGManager] Index built successfully, \(stats.count) items indexed")

        } catch {
            logger.error("[RAGManager] Failed to build index: \(error)")
        }
    }

    /// Retrieve relevant knowledge for a query
    /// - Parameters:
    ///   - query: User query
    ///   - options: Retrieval options
    /// - Returns: Array of relevant documents
    func retrieve(query: String, options: RetrievalOptions? = nil) async throws -> [RetrievedDocument] {
        guard config.enableRAG else {
            return []
        }

        let opts = options ?? RetrievalOptions()
        logger.debug("[RAGManager] Retrieving for query: \"\(query)\"")

        var results: [RetrievedDocument] = []

        if opts.useHybridSearch {
            // Hybrid search: vector + keyword
            let vectorResults = try await vectorSearch(query, topK: config.topK * 2)
            let keywordResults = await keywordSearch(query, topK: config.topK * 2)

            results = mergeResults(vectorResults: vectorResults, keywordResults: keywordResults)
        } else {
            // Vector search only
            results = try await vectorSearch(query, topK: config.topK * 2)
        }

        // Deduplicate
        results = deduplicateResults(results)

        // Filter by similarity threshold
        results = results.filter { $0.score >= (opts.similarityThreshold ?? config.similarityThreshold) }

        // Limit to topK
        results = Array(results.prefix(opts.topK ?? config.topK))

        logger.debug("[RAGManager] Retrieved \(results.count) relevant items")

        return results
    }

    /// Vector search
    private func vectorSearch(_ query: String, topK: Int) async throws -> [RetrievedDocument] {
        // Generate query embedding
        let queryEmbedding = try await embeddingsService.generateEmbedding(query)

        // Search vector store
        let searchResults = try await vectorStore.search(queryEmbedding: queryEmbedding, topK: topK)

        // Convert to RetrievedDocument
        return searchResults.map { result in
            RetrievedDocument(
                id: result.id,
                title: result.metadata.title,
                content: result.document,
                type: result.metadata.type,
                score: result.score,
                source: .vector
            )
        }
    }

    /// Keyword search using knowledge repository
    private func keywordSearch(_ query: String, topK: Int) async -> [RetrievedDocument] {
        guard let repository = knowledgeRepository else {
            return []
        }

        // Search knowledge base
        let items = repository.searchItems(query: query, limit: topK)

        // Convert to RetrievedDocument with estimated score
        return items.map { item in
            RetrievedDocument(
                id: item.id,
                title: item.title,
                content: item.content ?? "",
                type: item.type,
                score: 0.5, // FTS doesn't provide scores, use default
                source: .keyword
            )
        }
    }

    /// Merge vector and keyword search results
    private func mergeResults(vectorResults: [RetrievedDocument], keywordResults: [RetrievedDocument]) -> [RetrievedDocument] {
        var merged: [String: RetrievedDocument] = [:]

        // Add vector results
        for result in vectorResults {
            var doc = result
            doc.vectorScore = result.score * config.vectorWeight
            doc.keywordScore = 0
            doc.score = doc.vectorScore
            merged[result.id] = doc
        }

        // Merge keyword results
        for result in keywordResults {
            if var existing = merged[result.id] {
                existing.keywordScore = result.score * config.keywordWeight
                existing.score = existing.vectorScore + existing.keywordScore
                existing.source = .hybrid
                merged[result.id] = existing
            } else {
                var doc = result
                doc.vectorScore = 0
                doc.keywordScore = result.score * config.keywordWeight
                doc.score = doc.keywordScore
                merged[result.id] = doc
            }
        }

        // Sort by combined score
        return merged.values.sorted { $0.score > $1.score }
    }

    /// Deduplicate results by ID, keeping higher score
    private func deduplicateResults(_ results: [RetrievedDocument]) -> [RetrievedDocument] {
        var seen: [String: RetrievedDocument] = [:]

        for result in results {
            if let existing = seen[result.id] {
                if result.score > existing.score {
                    seen[result.id] = result
                }
            } else {
                seen[result.id] = result
            }
        }

        return seen.values.sorted { $0.score > $1.score }
    }

    /// Build enhanced context for LLM from retrieved documents
    func buildEnhancedContext(query: String, retrievedDocs: [RetrievedDocument]) -> String {
        guard !retrievedDocs.isEmpty else {
            return ""
        }

        var context = "# 相关知识库内容\n\n"
        var currentLength = context.count

        for doc in retrievedDocs {
            let docText = "## \(doc.title)\n\(doc.content)\n\n"

            // Check length limit
            if currentLength + docText.count > config.maxContextLength {
                break
            }

            context += docText
            currentLength += docText.count
        }

        context += "\n# 用户问题\n\(query)\n\n请基于以上知识库内容回答用户问题。"

        return context
    }

    /// RAG-enhanced query
    func enhanceQuery(query: String, options: RetrievalOptions? = nil) async throws -> EnhancedQuery {
        guard config.enableRAG else {
            return EnhancedQuery(query: query, context: "", retrievedDocs: [])
        }

        do {
            let retrievedDocs = try await retrieve(query: query, options: options)
            let context = buildEnhancedContext(query: query, retrievedDocs: retrievedDocs)

            return EnhancedQuery(
                query: query,
                context: context,
                retrievedDocs: retrievedDocs
            )
        } catch {
            logger.error("[RAGManager] Failed to enhance query: \(error)")
            return EnhancedQuery(query: query, context: "", retrievedDocs: [])
        }
    }

    /// Add item to vector index
    func addToIndex(_ item: KnowledgeItem) async throws {
        guard config.enableRAG else { return }

        let text = "\(item.title)\n\(item.content ?? "")"
        let embedding = try await embeddingsService.generateEmbedding(text)

        let metadata = VectorStore.VectorMetadata(
            title: item.title,
            type: item.type,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
        )

        try await vectorStore.addVector(
            id: item.id,
            embedding: embedding,
            metadata: metadata,
            document: item.content ?? item.title
        )

        logger.debug("[RAGManager] Added item to index: \(item.id)")
    }

    /// Remove item from index
    func removeFromIndex(_ itemId: String) async throws {
        try await vectorStore.deleteVector(id: itemId)
        logger.debug("[RAGManager] Removed item from index: \(itemId)")
    }

    /// Update item in index
    func updateIndex(_ item: KnowledgeItem) async throws {
        try await removeFromIndex(item.id)
        try await addToIndex(item)
    }

    /// Rebuild entire index
    func rebuildIndex() async throws {
        logger.debug("[RAGManager] Rebuilding index...")
        embeddingsService.clearCache()
        await buildVectorIndex()
    }

    /// Get index statistics
    func getIndexStats() async -> IndexStats {
        let vectorStats = await vectorStore.getStats()
        let cacheStats = embeddingsService.getCacheStats()

        return IndexStats(
            totalItems: vectorStats.count,
            storageMode: vectorStats.mode,
            cacheHitRate: cacheStats.hitRate,
            cacheSize: cacheStats.size
        )
    }

    struct IndexStats {
        let totalItems: Int
        let storageMode: String
        let cacheHitRate: Double
        let cacheSize: Int
    }
}

// MARK: - Data Types

struct RetrievalOptions {
    var topK: Int?
    var similarityThreshold: Float?
    var useHybridSearch: Bool = true
}

struct RetrievedDocument: Identifiable {
    let id: String
    let title: String
    let content: String
    let type: String
    var score: Float
    var source: SearchSource
    var vectorScore: Float = 0
    var keywordScore: Float = 0
}

enum SearchSource {
    case vector
    case keyword
    case hybrid
}

struct EnhancedQuery {
    let query: String
    let context: String
    let retrievedDocs: [RetrievedDocument]
}

