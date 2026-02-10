import Foundation
import CoreCommon

// MARK: - SmartPlanCache
/// Smart task plan cache with semantic similarity matching
/// Uses LRU eviction and cosine similarity for intelligent cache hits
///
/// Features:
/// 1. LLM Embedding vectorization
/// 2. Cosine similarity matching
/// 3. LRU eviction strategy
/// 4. Statistics and monitoring
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Cache Entry

/// LRU cache entry for task plans
struct PlanCacheEntry: Identifiable {
    let id: String
    let key: String           // Hash of original request (for quick lookup)
    let request: String       // Original request text
    let plan: TaskPlan        // Cached task plan
    let embedding: [Float]    // Request embedding vector
    var hits: Int             // Hit count
    let createdAt: Date
    var lastHitAt: Date?
    var lastAccessAt: Date

    init(key: String, request: String, plan: TaskPlan, embedding: [Float]) {
        self.id = UUID().uuidString.prefix(8).lowercased()
        self.key = key
        self.request = request
        self.plan = plan
        self.embedding = embedding
        self.hits = 0
        self.createdAt = Date()
        self.lastHitAt = nil
        self.lastAccessAt = Date()
    }
}

/// Task plan structure
struct TaskPlan: Codable {
    var description: String
    var subtasks: [TaskStep]
    var metadata: [String: String]?

    struct TaskStep: Codable {
        var tool: String
        var title: String
        var params: [String: AnyCodableValue]?
        var timeout: Int?
        var retries: Int?
        var retryDelay: Int?
        var regenerateParams: Bool?
        var regenerateCode: Bool?
        var strictSyntaxCheck: Bool?
    }
}

// MARK: - Cache Statistics

/// Statistics for smart plan cache
struct PlanCacheStats {
    var totalRequests: Int = 0
    var cacheHits: Int = 0
    var cacheMisses: Int = 0
    var semanticHits: Int = 0      // Semantic matching hits
    var exactHits: Int = 0         // Exact matching hits
    var evictions: Int = 0         // Eviction count
    var embeddingCalls: Int = 0    // Embedding API calls
    var embeddingFailures: Int = 0

    var hitRate: Double {
        guard totalRequests > 0 else { return 0 }
        return Double(cacheHits) / Double(totalRequests) * 100
    }

    var semanticRate: Double {
        guard cacheHits > 0 else { return 0 }
        return Double(semanticHits) / Double(cacheHits) * 100
    }
}

// MARK: - Smart Plan Cache

/// Smart plan cache with semantic similarity matching
@MainActor
class SmartPlanCache: ObservableObject {
    // MARK: - Configuration

    struct Config {
        var maxSize: Int = 1000                        // Maximum cache entries
        var similarityThreshold: Float = 0.85          // Similarity threshold (0-1)
        var ttl: TimeInterval = 7 * 24 * 60 * 60       // 7 days TTL
        var enabled: Bool = true
    }

    // MARK: - Properties

    private var config: Config
    private var cache: [String: PlanCacheEntry] = [:]  // key -> entry
    private var accessOrder: [String] = []             // LRU order
    private var cleanupTimer: Timer?
    private let logger = Logger.shared

    @Published private(set) var stats = PlanCacheStats()
    @Published private(set) var cacheSize: Int = 0

    // LLM Manager reference for embeddings
    private weak var llmManager: LLMManager?

    // Vocabulary for TF-IDF fallback
    private let vocabulary = [
        "create", "add", "build", "generate", "implement",
        "update", "modify", "change", "edit", "refactor",
        "delete", "remove", "clean", "clear",
        "test", "check", "validate", "verify",
        "file", "code", "function", "class", "component",
        "api", "database", "server", "client",
        "feature", "bug", "fix", "improve", "optimize"
    ]

    // MARK: - Singleton

    static let shared = SmartPlanCache()

    // MARK: - Initialization

    init(config: Config = Config()) {
        self.config = config

        // Start cleanup timer (every hour)
        startCleanupTimer()

        logger.info("[SmartPlanCache] Initialized with maxSize: \(config.maxSize), threshold: \(config.similarityThreshold)")
    }

    /// Set LLM manager for embeddings
    func setLLMManager(_ manager: LLMManager) {
        self.llmManager = manager
    }

    // MARK: - Public Methods

    /// Get cached plan (supports semantic matching)
    /// - Parameter request: User request
    /// - Returns: Cached plan or nil
    func get(_ request: String) async -> TaskPlan? {
        guard config.enabled else { return nil }

        stats.totalRequests += 1

        // 1. Try exact match (fast path)
        let exactKey = hash(request)
        if let entry = cache[exactKey], !isExpired(entry) {
            recordHit(key: exactKey, type: .exact)
            stats.exactHits += 1
            stats.cacheHits += 1

            logger.debug("[SmartPlanCache] Exact hit: \(entry.id), hits: \(entry.hits)")
            return entry.plan
        }

        // 2. Semantic similarity matching
        if let semanticPlan = await semanticSearch(request) {
            stats.semanticHits += 1
            stats.cacheHits += 1
            return semanticPlan
        }

        // 3. Cache miss
        stats.cacheMisses += 1
        logger.debug("[SmartPlanCache] Cache miss")

        return nil
    }

    /// Set cache entry
    /// - Parameters:
    ///   - request: User request
    ///   - plan: Task plan
    func set(_ request: String, plan: TaskPlan) async {
        guard config.enabled else { return }

        let key = hash(request)

        // Check if already exists
        if cache[key] != nil {
            logger.debug("[SmartPlanCache] Updating existing cache: \(key)")
            cache[key]?.plan = plan
            cache[key]?.lastAccessAt = Date()
            updateAccessOrder(key)
            return
        }

        // Calculate embedding
        guard let embedding = await getEmbedding(request) else {
            logger.warning("[SmartPlanCache] Embedding failed, skipping cache")
            return
        }

        // Create new entry
        let entry = PlanCacheEntry(key: key, request: request, plan: plan, embedding: embedding)

        // Check if cache is full
        if cache.count >= config.maxSize {
            evictLRU()
        }

        // Add to cache
        cache[key] = entry
        accessOrder.append(key)
        cacheSize = cache.count

        logger.debug("[SmartPlanCache] Cache added: \(entry.id), size: \(cache.count)/\(config.maxSize)")
    }

    /// Clear all cache
    func clear() {
        cache.removeAll()
        accessOrder.removeAll()
        cacheSize = 0
        logger.info("[SmartPlanCache] Cache cleared")
    }

    /// Get cache statistics
    func getStats() -> [String: Any] {
        return [
            "totalRequests": stats.totalRequests,
            "cacheHits": stats.cacheHits,
            "cacheMisses": stats.cacheMisses,
            "exactHits": stats.exactHits,
            "semanticHits": stats.semanticHits,
            "evictions": stats.evictions,
            "embeddingCalls": stats.embeddingCalls,
            "embeddingFailures": stats.embeddingFailures,
            "hitRate": String(format: "%.2f%%", stats.hitRate),
            "semanticRate": String(format: "%.2f%%", stats.semanticRate),
            "cacheSize": cache.count,
            "maxSize": config.maxSize
        ]
    }

    /// Update configuration
    func updateConfig(_ newConfig: Config) {
        config = newConfig
        logger.info("[SmartPlanCache] Config updated: maxSize=\(config.maxSize), threshold=\(config.similarityThreshold)")
    }

    // MARK: - Private Methods

    /// Semantic search for similar plans
    private func semanticSearch(_ request: String) async -> TaskPlan? {
        guard let requestEmbedding = await getEmbedding(request) else {
            return nil
        }

        var bestMatch: PlanCacheEntry?
        var bestSimilarity: Float = 0

        // Traverse all cache entries, calculate similarity
        for entry in cache.values {
            if isExpired(entry) { continue }

            let similarity = cosineSimilarity(requestEmbedding, entry.embedding)

            if similarity > bestSimilarity && similarity >= config.similarityThreshold {
                bestSimilarity = similarity
                bestMatch = entry
            }
        }

        if let match = bestMatch {
            recordHit(key: match.key, type: .semantic)
            logger.debug("[SmartPlanCache] Semantic hit: \(match.id), similarity: \(String(format: "%.2f%%", bestSimilarity * 100)), hits: \(match.hits)")
            return match.plan
        }

        return nil
    }

    /// Get embedding vector for text
    private func getEmbedding(_ text: String) async -> [Float]? {
        stats.embeddingCalls += 1

        // Try LLM embedding first
        if let manager = llmManager {
            do {
                let embedding = try await manager.generateEmbedding(text)
                return embedding
            } catch {
                logger.debug("[SmartPlanCache] LLM embedding failed: \(error.localizedDescription)")
            }
        }

        // Fallback to TF-IDF vector
        logger.debug("[SmartPlanCache] Using TF-IDF fallback")
        return simpleTFIDFVector(text)
    }

    /// Simple TF-IDF vectorization (fallback)
    private func simpleTFIDFVector(_ text: String) -> [Float] {
        // Tokenize
        let tokens = text.lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { $0.count > 2 }

        // Calculate term frequency
        var freq: [String: Int] = [:]
        for token in tokens {
            freq[token, default: 0] += 1
        }

        // Build vector based on vocabulary
        let totalTokens = Float(tokens.count)
        var vector: [Float] = []

        for word in vocabulary {
            let tf = totalTokens > 0 ? Float(freq[word] ?? 0) / totalTokens : 0
            vector.append(tf)
        }

        return vector
    }

    /// Calculate cosine similarity
    private func cosineSimilarity(_ vec1: [Float], _ vec2: [Float]) -> Float {
        guard vec1.count == vec2.count, !vec1.isEmpty else { return 0 }

        var dotProduct: Float = 0
        var norm1: Float = 0
        var norm2: Float = 0

        for i in 0..<vec1.count {
            dotProduct += vec1[i] * vec2[i]
            norm1 += vec1[i] * vec1[i]
            norm2 += vec2[i] * vec2[i]
        }

        let denominator = sqrt(norm1) * sqrt(norm2)

        guard denominator > 0 else { return 0 }

        return dotProduct / denominator
    }

    /// Record cache hit
    private enum HitType {
        case exact, semantic
    }

    private func recordHit(key: String, type: HitType) {
        cache[key]?.hits += 1
        cache[key]?.lastHitAt = Date()
        cache[key]?.lastAccessAt = Date()
        updateAccessOrder(key)
    }

    /// Update access order (LRU)
    private func updateAccessOrder(_ key: String) {
        if let index = accessOrder.firstIndex(of: key) {
            accessOrder.remove(at: index)
        }
        accessOrder.append(key)
    }

    /// LRU eviction
    private func evictLRU() {
        guard !accessOrder.isEmpty else { return }

        let lruKey = accessOrder.removeFirst()
        if let evicted = cache.removeValue(forKey: lruKey) {
            stats.evictions += 1
            cacheSize = cache.count
            logger.debug("[SmartPlanCache] LRU evicted: \(evicted.id), hits: \(evicted.hits)")
        }
    }

    /// Check if entry is expired
    private func isExpired(_ entry: PlanCacheEntry) -> Bool {
        return Date().timeIntervalSince(entry.createdAt) > config.ttl
    }

    /// Cleanup expired entries
    private func cleanupExpired() {
        var cleanedCount = 0

        for (key, entry) in cache {
            if isExpired(entry) {
                cache.removeValue(forKey: key)
                if let index = accessOrder.firstIndex(of: key) {
                    accessOrder.remove(at: index)
                }
                cleanedCount += 1
            }
        }

        if cleanedCount > 0 {
            cacheSize = cache.count
            logger.info("[SmartPlanCache] Cleaned expired entries: \(cleanedCount)")
        }
    }

    /// Calculate string hash
    private func hash(_ str: String) -> String {
        var hash: Int = 0
        for char in str.unicodeScalars {
            hash = ((hash << 5) &- hash) &+ Int(char.value)
        }
        return String(hash, radix: 36)
    }

    /// Start cleanup timer
    private func startCleanupTimer() {
        cleanupTimer = Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.cleanupExpired()
            }
        }
    }

    deinit {
        cleanupTimer?.invalidate()
    }
}

// MARK: - Extension for mutable plan property

extension PlanCacheEntry {
    var plan: TaskPlan {
        get { _plan }
        set { _plan = newValue }
    }
    private var _plan: TaskPlan {
        get { _planStorage }
        set { _planStorage = newValue }
    }
}

// Using a separate storage since struct is immutable by default
private var _planStorage: [String: TaskPlan] = [:]

extension PlanCacheEntry {
    fileprivate var _planStorage: TaskPlan {
        get { _planStorage[id] ?? plan }
        set { _planStorage[id] = newValue }
    }
}
