import Foundation
import Combine
import CoreCommon

/// 混合搜索引擎
///
/// 结合 Vector Search (语义相似度) 和 BM25 Search (关键词匹配)
/// 使用 Reciprocal Rank Fusion (RRF) 算法融合结果
///
/// 参考:
/// - Clawdbot Memory System: https://docs.openclaw.ai/concepts/memory
/// - desktop-app-vue/src/main/rag/hybrid-search-engine.js
///
@MainActor
public class HybridSearchEngine: ObservableObject {

    // MARK: - Singleton

    public static let shared = HybridSearchEngine()

    // MARK: - Configuration

    @Published public private(set) var config: HybridSearchConfig

    // MARK: - Dependencies

    private let bm25Search: BM25Search
    private weak var ragManager: RAGManager?

    // MARK: - State

    /// 文档缓存
    private var documents: [SearchDocument] = []

    /// 搜索事件历史
    @Published public private(set) var searchHistory: [SearchEvent] = []

    /// 统计信息
    @Published public private(set) var stats: SearchStats

    // MARK: - Initialization

    private init() {
        self.config = HybridSearchConfig()
        self.bm25Search = BM25Search.shared
        self.stats = SearchStats()

        Logger.shared.info("[HybridSearchEngine] 初始化完成 vectorWeight=\(config.vectorWeight) textWeight=\(config.textWeight)")
    }

    /// 配置搜索引擎
    public func configure(_ config: HybridSearchConfig) {
        self.config = config
        self.bm25Search.configure(config.bm25Config)

        stats.vectorWeight = config.vectorWeight
        stats.textWeight = config.textWeight
        stats.rrfK = config.rrfK

        Logger.shared.info("[HybridSearchEngine] 配置已更新")
    }

    /// 设置 RAG 管理器
    public func setRAGManager(_ ragManager: RAGManager) {
        self.ragManager = ragManager
        Logger.shared.info("[HybridSearchEngine] RAG Manager 已设置")
    }

    // MARK: - Indexing

    /// 索引文档
    /// - Parameter documents: 文档列表
    public func indexDocuments(_ documents: [SearchDocument]) async {
        Logger.shared.info("[HybridSearchEngine] 开始索引 \(documents.count) 个文档")

        // 缓存文档
        self.documents = documents

        // BM25 索引
        bm25Search.indexDocuments(documents)

        // Vector 索引由 RAG Manager 管理
        // 这里假设 RAG Manager 已经索引了这些文档

        stats.documentCount = documents.count

        Logger.shared.info("[HybridSearchEngine] 索引完成")
    }

    /// 添加单个文档
    public func addDocument(_ document: SearchDocument) {
        documents.append(document)
        bm25Search.addDocument(document)
        stats.documentCount = documents.count

        Logger.shared.info("[HybridSearchEngine] 添加文档: \(document.id)")
    }

    /// 移除文档
    public func removeDocument(_ documentId: String) {
        documents.removeAll { $0.id == documentId }
        bm25Search.removeDocument(documentId)
        stats.documentCount = documents.count

        Logger.shared.info("[HybridSearchEngine] 移除文档: \(documentId)")
    }

    /// 清空索引
    public func clear() {
        documents.removeAll()
        bm25Search.clear()
        stats.documentCount = 0

        Logger.shared.info("[HybridSearchEngine] 索引已清空")
    }

    // MARK: - Search

    /// 混合搜索
    /// - Parameters:
    ///   - query: 查询字符串
    ///   - options: 搜索选项
    /// - Returns: 融合后的搜索结果
    public func search(_ query: String, options: SearchOptions = SearchOptions()) async -> [SearchResult] {
        let startTime = Date()

        Logger.shared.info("[HybridSearchEngine] 执行混合搜索: \"\(query)\"")

        let effectiveOptions = mergeOptions(options)

        // 并行执行 Vector Search 和 BM25 Search
        async let vectorTask = effectiveOptions.enableVector ? vectorSearch(query, limit: config.vectorLimit) : []
        async let bm25Task = effectiveOptions.enableBM25 ? bm25Search.search(query, options: SearchOptions(limit: config.bm25Limit)) : []

        let vectorResults = await vectorTask
        let bm25Results = await bm25Task

        Logger.shared.info("[HybridSearchEngine] 搜索结果 - Vector: \(vectorResults.count), BM25: \(bm25Results.count)")

        // RRF 融合
        var fusedResults = fusionRank(
            vectorResults: vectorResults,
            bm25Results: bm25Results
        )

        // 过滤低分结果
        fusedResults = fusedResults.filter { $0.score > effectiveOptions.threshold }

        // 返回 top-k
        let finalResults = Array(fusedResults.prefix(effectiveOptions.limit))

        // 记录搜索事件
        let elapsed = Date().timeIntervalSince(startTime) * 1000
        let event = SearchEvent(
            query: query,
            source: .hybrid,
            resultCount: finalResults.count,
            latencyMs: elapsed
        )
        searchHistory.append(event)

        // 保持历史记录在合理范围
        if searchHistory.count > 100 {
            searchHistory = Array(searchHistory.suffix(50))
        }

        // 更新统计
        stats.hybridSearches += 1
        stats.totalSearches += 1
        stats.avgLatencyMs = (stats.avgLatencyMs * Double(stats.totalSearches - 1) + elapsed) / Double(stats.totalSearches)

        Logger.shared.info("[HybridSearchEngine] 搜索完成，耗时=\(Int(elapsed))ms，结果数=\(finalResults.count)")

        return finalResults
    }

    /// 仅 Vector 搜索
    public func vectorOnlySearch(_ query: String, limit: Int = 10) async -> [SearchResult] {
        var options = SearchOptions()
        options.limit = limit
        options.enableVector = true
        options.enableBM25 = false

        return await search(query, options: options)
    }

    /// 仅 BM25 搜索
    public func bm25OnlySearch(_ query: String, limit: Int = 10) -> [SearchResult] {
        let options = SearchOptions(limit: limit)
        return bm25Search.search(query, options: options)
    }

    // MARK: - Vector Search

    /// Vector 搜索 (通过 RAG Manager)
    private func vectorSearch(_ query: String, limit: Int) async -> [SearchResult] {
        guard let ragManager = ragManager else {
            Logger.shared.warning("[HybridSearchEngine] RAG Manager 未设置，跳过 Vector Search")
            return []
        }

        do {
            let retrievalOptions = RetrievalOptions(topK: limit, useHybridSearch: false)
            let retrievedDocs = try await ragManager.retrieve(query: query, options: retrievalOptions)

            // 转换为 SearchResult
            return retrievedDocs.enumerated().map { (rank, doc) in
                var result = SearchResult(
                    document: SearchDocument(
                        id: doc.id,
                        content: doc.content,
                        title: doc.title,
                        metadata: ["type": doc.type]
                    ),
                    score: Double(doc.score),
                    source: .vector
                )
                result.vectorScore = Double(doc.score)
                result.vectorRank = rank
                return result
            }
        } catch {
            Logger.shared.error("[HybridSearchEngine] Vector Search 失败: \(error)")
            return []
        }
    }

    // MARK: - RRF Fusion

    /// Reciprocal Rank Fusion (RRF) 算法
    ///
    /// RRF 分数 = Σ 1 / (k + rank)
    ///
    /// - Parameters:
    ///   - vectorResults: Vector 搜索结果
    ///   - bm25Results: BM25 搜索结果
    /// - Returns: 融合后的结果
    private func fusionRank(
        vectorResults: [SearchResult],
        bm25Results: [SearchResult]
    ) -> [SearchResult] {
        let k = Double(config.rrfK)
        let vectorWeight = config.vectorWeight
        let textWeight = config.textWeight

        // 构建文档 ID → 分数映射
        var scoreMap: [String: Double] = [:]
        var resultMap: [String: SearchResult] = [:]

        // Vector Search 分数
        for (rank, result) in vectorResults.enumerated() {
            let docId = result.document.id
            let score = vectorWeight / (k + Double(rank + 1))

            scoreMap[docId, default: 0] += score

            if var existing = resultMap[docId] {
                existing.vectorScore = result.vectorScore
                existing.vectorRank = rank
                resultMap[docId] = existing
            } else {
                var newResult = result
                newResult.vectorRank = rank
                resultMap[docId] = newResult
            }
        }

        // BM25 Search 分数
        for (rank, result) in bm25Results.enumerated() {
            let docId = result.document.id
            let score = textWeight / (k + Double(rank + 1))

            scoreMap[docId, default: 0] += score

            if var existing = resultMap[docId] {
                existing.bm25Score = result.bm25Score
                existing.bm25Rank = rank
                existing.source = .hybrid
                resultMap[docId] = existing
            } else {
                var newResult = result
                newResult.bm25Rank = rank
                resultMap[docId] = newResult
            }
        }

        // 构建最终结果
        var mergedResults: [SearchResult] = []

        for (docId, rrfScore) in scoreMap {
            guard var result = resultMap[docId] else { continue }

            result.rrfScore = rrfScore
            result.score = rrfScore

            // 如果同时出现在两个结果中，标记为 hybrid
            if result.vectorRank != nil && result.bm25Rank != nil {
                result.source = .hybrid
            }

            mergedResults.append(result)
        }

        // 按 RRF 分数降序排序
        mergedResults.sort { $0.score > $1.score }

        return mergedResults
    }

    // MARK: - Options

    /// 合并选项
    private func mergeOptions(_ options: SearchOptions) -> SearchOptions {
        var merged = options

        if options.enableVector && !config.enableVector {
            merged.enableVector = false
        }
        if options.enableBM25 && !config.enableBM25 {
            merged.enableBM25 = false
        }

        return merged
    }

    // MARK: - Statistics

    /// 获取统计信息
    public func getStats() -> SearchStats {
        var combined = stats
        let bm25Stats = bm25Search.getStats()

        combined.k1 = bm25Stats.k1
        combined.b = bm25Stats.b
        combined.bm25Searches = bm25Stats.bm25Searches

        return combined
    }

    /// 更新权重
    public func updateWeights(vectorWeight: Double, textWeight: Double) {
        var newConfig = config
        newConfig.vectorWeight = vectorWeight
        newConfig.textWeight = textWeight
        configure(newConfig)

        Logger.shared.info("[HybridSearchEngine] 权重已更新 vector=\(vectorWeight) text=\(textWeight)")
    }

    /// 重置统计
    public func resetStats() {
        stats = SearchStats()
        stats.vectorWeight = config.vectorWeight
        stats.textWeight = config.textWeight
        stats.rrfK = config.rrfK
        stats.documentCount = documents.count

        Logger.shared.info("[HybridSearchEngine] 统计已重置")
    }

    // MARK: - Debug

    /// 获取搜索历史
    public func getSearchHistory(limit: Int = 20) -> [SearchEvent] {
        return Array(searchHistory.suffix(limit))
    }

    /// 清除搜索历史
    public func clearSearchHistory() {
        searchHistory.removeAll()
        Logger.shared.info("[HybridSearchEngine] 搜索历史已清除")
    }
}

// MARK: - Extension for KnowledgeItem

extension HybridSearchEngine {
    /// 从 KnowledgeItem 创建 SearchDocument
    public static func createDocument(from item: KnowledgeItem) -> SearchDocument {
        return SearchDocument(
            id: item.id,
            content: item.content ?? "",
            title: item.title,
            metadata: ["type": item.type],
            createdAt: item.createdAt
        )
    }

    /// 索引 KnowledgeItem 列表
    public func indexKnowledgeItems(_ items: [KnowledgeItem]) async {
        let documents = items.map { Self.createDocument(from: $0) }
        await indexDocuments(documents)
    }
}

// MARK: - KnowledgeItem Protocol

/// 知识项协议 (用于与 Knowledge 模块解耦)
public protocol KnowledgeItemProtocol {
    var id: String { get }
    var title: String { get }
    var content: String? { get }
    var type: String { get }
    var createdAt: Date { get }
}
