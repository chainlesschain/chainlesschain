import Foundation
import CoreCommon

/// Embeddings Service - Generates text embeddings for semantic search
/// Reference: desktop-app-vue/src/main/rag/embeddings-service.js
@MainActor
class EmbeddingsService: ObservableObject {
    private let llmManager: LLMManager
    private let logger = Logger.shared

    // LRU Cache for embeddings (max 2000 entries, 1 hour TTL)
    private var cache: [String: CachedEmbedding] = [:]
    private var cacheAccessOrder: [String] = [] // For LRU eviction
    private let maxCacheSize = 2000
    private let cacheMaxAge: TimeInterval = 3600 // 1 hour

    // Cache statistics
    private(set) var cacheHits = 0
    private(set) var cacheMisses = 0

    @Published var isInitialized = false

    struct CachedEmbedding {
        let embedding: [Float]
        let timestamp: Date
    }

    init(llmManager: LLMManager = .shared) {
        self.llmManager = llmManager
    }

    /// Initialize the embeddings service
    func initialize() async throws {
        logger.debug("[EmbeddingsService] Initializing embeddings service...")

        guard llmManager.isInitialized else {
            logger.warning("[EmbeddingsService] LLM service not initialized")
            isInitialized = false
            return
        }

        isInitialized = true
        logger.debug("[EmbeddingsService] Embeddings service initialized successfully")
    }

    /// Generate embedding for text
    /// - Parameters:
    ///   - text: Text to embed
    ///   - skipCache: Whether to skip cache lookup
    /// - Returns: Embedding vector
    func generateEmbedding(_ text: String, skipCache: Bool = false) async throws -> [Float] {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EmbeddingsError.emptyText
        }

        // Check cache
        let cacheKey = getCacheKey(text)
        if !skipCache, let cached = cache[cacheKey] {
            // Check if cache entry is still valid
            if Date().timeIntervalSince(cached.timestamp) < cacheMaxAge {
                cacheHits += 1
                updateCacheAccessOrder(cacheKey)
                logger.debug("[EmbeddingsService] Using cached embedding (hit rate: \(getCacheHitRate()))")
                return cached.embedding
            } else {
                // Remove expired entry
                cache.removeValue(forKey: cacheKey)
                cacheAccessOrder.removeAll { $0 == cacheKey }
            }
        }

        cacheMisses += 1

        do {
            // Generate embedding using LLM manager
            let embedding = try await llmManager.generateEmbedding(text)

            // Cache the result
            cacheEmbedding(embedding, forKey: cacheKey)

            return embedding
        } catch {
            logger.error("[EmbeddingsService] Failed to generate embedding, using fallback: \(error)")
            // Fallback to simple embedding
            return generateSimpleEmbedding(text)
        }
    }

    /// Generate embeddings for multiple texts
    func generateEmbeddings(_ texts: [String], skipCache: Bool = false) async throws -> [[Float]] {
        var embeddings: [[Float]] = []

        for text in texts {
            do {
                let embedding = try await generateEmbedding(text, skipCache: skipCache)
                embeddings.append(embedding)
            } catch {
                logger.error("[EmbeddingsService] Failed to generate embedding for text: \(error)")
                embeddings.append(generateSimpleEmbedding(text))
            }
        }

        return embeddings
    }

    /// Calculate cosine similarity between two vectors
    /// - Returns: Similarity score (0-1)
    func cosineSimilarity(_ vec1: [Float], _ vec2: [Float]) -> Float {
        guard vec1.count == vec2.count, !vec1.isEmpty else {
            return 0
        }

        var dotProduct: Float = 0
        var norm1: Float = 0
        var norm2: Float = 0

        for i in 0..<vec1.count {
            dotProduct += vec1[i] * vec2[i]
            norm1 += vec1[i] * vec1[i]
            norm2 += vec2[i] * vec2[i]
        }

        let magnitude = sqrt(norm1) * sqrt(norm2)

        guard magnitude > 0 else {
            return 0
        }

        return dotProduct / magnitude
    }

    // MARK: - Cache Management

    private func cacheEmbedding(_ embedding: [Float], forKey key: String) {
        // Evict oldest entry if cache is full
        if cache.count >= maxCacheSize, let oldestKey = cacheAccessOrder.first {
            cache.removeValue(forKey: oldestKey)
            cacheAccessOrder.removeFirst()
        }

        cache[key] = CachedEmbedding(embedding: embedding, timestamp: Date())
        updateCacheAccessOrder(key)
    }

    private func updateCacheAccessOrder(_ key: String) {
        // Remove existing occurrence
        cacheAccessOrder.removeAll { $0 == key }
        // Add to end (most recently used)
        cacheAccessOrder.append(key)
    }

    private func getCacheKey(_ text: String) -> String {
        // Simple hash function
        var hash: UInt32 = 0
        for char in text.utf16 {
            hash = hash &<< 5 &- hash &+ UInt32(char)
        }
        return String(hash)
    }

    private func getCacheHitRate() -> Double {
        let total = cacheHits + cacheMisses
        return total > 0 ? Double(cacheHits) / Double(total) : 0
    }

    /// Clear cache
    func clearCache() {
        cache.removeAll()
        cacheAccessOrder.removeAll()
        cacheHits = 0
        cacheMisses = 0
        logger.debug("[EmbeddingsService] Cache cleared")
    }

    /// Get cache statistics
    func getCacheStats() -> CacheStats {
        let totalRequests = cacheHits + cacheMisses
        let hitRate = totalRequests > 0 ? Double(cacheHits) / Double(totalRequests) : 0

        return CacheStats(
            size: cache.count,
            maxSize: maxCacheSize,
            hitRate: hitRate,
            hits: cacheHits,
            misses: cacheMisses,
            totalRequests: totalRequests
        )
    }

    struct CacheStats {
        let size: Int
        let maxSize: Int
        let hitRate: Double
        let hits: Int
        let misses: Int
        let totalRequests: Int
    }

    // MARK: - Fallback Simple Embedding

    /// Generate simple embedding using character and word frequency features
    /// This is a fallback when LLM embeddings are not available
    private func generateSimpleEmbedding(_ text: String) -> [Float] {
        var features = [Float](repeating: 0, count: 128)

        let cleanText = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        // Character frequency (first 64 dimensions)
        for char in cleanText.utf16 {
            if char < 128 {
                features[Int(char) % 64] += 1
            }
        }

        // Word length distribution (last 64 dimensions)
        let words = cleanText.components(separatedBy: .whitespaces)
        for word in words {
            let len = min(word.count, 63)
            features[64 + len] += 1
        }

        // Normalize
        if let max = features.max(), max > 0 {
            for i in 0..<features.count {
                features[i] = features[i] / max
            }
        }

        return features
    }
}

// MARK: - Error Types

enum EmbeddingsError: LocalizedError {
    case emptyText
    case llmNotAvailable
    case generationFailed(String)

    var errorDescription: String? {
        switch self {
        case .emptyText:
            return "Text content cannot be empty"
        case .llmNotAvailable:
            return "LLM service is not available"
        case .generationFailed(let message):
            return "Failed to generate embedding: \(message)"
        }
    }
}

