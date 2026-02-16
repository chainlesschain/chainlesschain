package com.chainlesschain.android.feature.ai.data.rag

import timber.log.Timber
import kotlin.math.exp

/**
 * 混合检索器
 *
 * 结合多种检索方法以获得最佳检索效果：
 * - FTS5 全文搜索：快速关键词匹配
 * - BM25 算法：改进的关键词检索
 * - 向量相似度：语义相似性搜索
 *
 * 使用 Reciprocal Rank Fusion (RRF) 算法融合多个检索结果
 */
class HybridRetriever(
    private val bm25Retriever: BM25Retriever,
    private val vectorEmbedder: VectorEmbedder,
    private val config: HybridConfig = HybridConfig()
) {
    // 文档向量缓存
    private val documentVectors = mutableMapOf<String, FloatArray>()

    // 索引的文档
    private val indexedDocuments = mutableMapOf<String, IndexedDocument>()

    /**
     * 混合检索配置
     */
    data class HybridConfig(
        /** BM25权重 */
        val bm25Weight: Double = 0.4,
        /** 向量搜索权重 */
        val vectorWeight: Double = 0.4,
        /** 关键词匹配权重 */
        val keywordWeight: Double = 0.2,
        /** RRF常数k (通常60) */
        val rrfK: Int = 60,
        /** 最小相似度阈值 */
        val minSimilarity: Double = 0.1,
        /** 是否启用语义重排 */
        val enableReranking: Boolean = true
    )

    /**
     * 索引文档
     */
    suspend fun indexDocuments(documents: List<IndexableDocument>) {
        Timber.i("Indexing ${documents.size} documents for hybrid search")

        // 清理旧索引
        indexedDocuments.clear()
        documentVectors.clear()

        // 索引到BM25
        bm25Retriever.indexDocuments(documents)

        // 计算文档向量
        documents.forEach { doc ->
            try {
                val vector = vectorEmbedder.embed(doc.content)
                documentVectors[doc.id] = vector
                indexedDocuments[doc.id] = IndexedDocument(
                    id = doc.id,
                    title = doc.title,
                    content = doc.content
                )
            } catch (e: Exception) {
                Timber.e(e, "Failed to embed document: ${doc.id}")
            }
        }

        Timber.i("Indexed ${indexedDocuments.size} documents with vectors")
    }

    /**
     * 混合检索
     *
     * @param query 查询文本
     * @param topK 返回结果数量
     * @param searchMode 搜索模式
     * @return 排序后的检索结果
     */
    suspend fun search(
        query: String,
        topK: Int = 5,
        searchMode: SearchMode = SearchMode.HYBRID
    ): List<HybridSearchResult> {
        if (query.isBlank() || indexedDocuments.isEmpty()) {
            return emptyList()
        }

        return when (searchMode) {
            SearchMode.BM25_ONLY -> searchBM25Only(query, topK)
            SearchMode.VECTOR_ONLY -> searchVectorOnly(query, topK)
            SearchMode.KEYWORD_ONLY -> searchKeywordOnly(query, topK)
            SearchMode.HYBRID -> searchHybrid(query, topK)
        }
    }

    /**
     * 仅BM25搜索
     */
    private fun searchBM25Only(query: String, topK: Int): List<HybridSearchResult> {
        return bm25Retriever.search(query, topK).map { result ->
            HybridSearchResult(
                id = result.id,
                title = result.title,
                content = result.content,
                score = result.score,
                bm25Score = result.score,
                vectorScore = 0.0,
                keywordScore = 0.0,
                matchedTerms = result.matchedTerms,
                searchMethod = "BM25"
            )
        }
    }

    /**
     * 仅向量搜索
     */
    private suspend fun searchVectorOnly(query: String, topK: Int): List<HybridSearchResult> {
        val queryVector = vectorEmbedder.embed(query)

        return documentVectors.mapNotNull { (docId, docVector) ->
            val doc = indexedDocuments[docId] ?: return@mapNotNull null
            val similarity = VectorMath.cosineSimilarity(queryVector, docVector)

            if (similarity >= config.minSimilarity) {
                HybridSearchResult(
                    id = docId,
                    title = doc.title,
                    content = doc.content,
                    score = similarity,
                    bm25Score = 0.0,
                    vectorScore = similarity,
                    keywordScore = 0.0,
                    matchedTerms = emptyList(),
                    searchMethod = "Vector"
                )
            } else null
        }
            .sortedByDescending { it.score }
            .take(topK)
    }

    /**
     * 仅关键词搜索
     */
    private fun searchKeywordOnly(query: String, topK: Int): List<HybridSearchResult> {
        val queryTerms = tokenizeQuery(query)

        return indexedDocuments.values.mapNotNull { doc ->
            val keywordScore = calculateKeywordScore(queryTerms, doc.content)
            val matchedTerms = queryTerms.filter { term ->
                doc.content.lowercase().contains(term.lowercase())
            }

            if (keywordScore > 0) {
                HybridSearchResult(
                    id = doc.id,
                    title = doc.title,
                    content = doc.content,
                    score = keywordScore,
                    bm25Score = 0.0,
                    vectorScore = 0.0,
                    keywordScore = keywordScore,
                    matchedTerms = matchedTerms,
                    searchMethod = "Keyword"
                )
            } else null
        }
            .sortedByDescending { it.score }
            .take(topK)
    }

    /**
     * 混合搜索 - 使用RRF融合多个检索结果
     */
    private suspend fun searchHybrid(query: String, topK: Int): List<HybridSearchResult> {
        // 获取各方法的检索结果
        val bm25Results = bm25Retriever.search(query, topK * 2)
        val queryVector = vectorEmbedder.embed(query)
        val queryTerms = tokenizeQuery(query)

        // 计算每个文档的综合分数
        val scoredDocs = indexedDocuments.values.map { doc ->
            // BM25分数
            val bm25Score = bm25Results.find { it.id == doc.id }?.score ?: 0.0

            // 向量相似度分数
            val docVector = documentVectors[doc.id]
            val vectorScore = if (docVector != null) {
                VectorMath.cosineSimilarity(queryVector, docVector)
            } else 0.0

            // 关键词匹配分数
            val keywordScore = calculateKeywordScore(queryTerms, doc.content)

            // 计算匹配的词
            val matchedTerms = queryTerms.filter { term ->
                doc.content.lowercase().contains(term.lowercase())
            }

            // RRF融合分数
            val rrfScore = calculateRRFScore(
                bm25Score = bm25Score,
                vectorScore = vectorScore,
                keywordScore = keywordScore,
                bm25Rank = bm25Results.indexOfFirst { it.id == doc.id }.takeIf { it >= 0 },
                config = config
            )

            HybridSearchResult(
                id = doc.id,
                title = doc.title,
                content = doc.content,
                score = rrfScore,
                bm25Score = bm25Score,
                vectorScore = vectorScore,
                keywordScore = keywordScore,
                matchedTerms = matchedTerms,
                searchMethod = "Hybrid"
            )
        }

        // 过滤和排序
        var results = scoredDocs
            .filter { it.score > 0 }
            .sortedByDescending { it.score }

        // 可选的语义重排
        if (config.enableReranking && results.size > 1) {
            results = rerank(results, query, queryVector)
        }

        return results.take(topK)
    }

    /**
     * 计算RRF (Reciprocal Rank Fusion) 分数
     *
     * RRF公式: score = Σ (1 / (k + rank_i))
     * 其中k是常数（通常60），rank_i是文档在第i个检索系统中的排名
     */
    private fun calculateRRFScore(
        bm25Score: Double,
        vectorScore: Double,
        keywordScore: Double,
        bm25Rank: Int?,
        config: HybridConfig
    ): Double {
        val k = config.rrfK

        // 使用加权平均和RRF结合
        var score = 0.0

        // BM25贡献
        if (bm25Score > 0) {
            val rank = bm25Rank ?: 100
            score += config.bm25Weight * (1.0 / (k + rank + 1))
            score += config.bm25Weight * normalizeScore(bm25Score, 0.0, 20.0)
        }

        // 向量相似度贡献
        if (vectorScore > config.minSimilarity) {
            score += config.vectorWeight * vectorScore
        }

        // 关键词匹配贡献
        if (keywordScore > 0) {
            score += config.keywordWeight * keywordScore
        }

        return score
    }

    /**
     * 语义重排
     */
    private fun rerank(
        results: List<HybridSearchResult>,
        query: String,
        queryVector: FloatArray
    ): List<HybridSearchResult> {
        // 使用向量相似度进行二次排序
        return results.map { result ->
            val docVector = documentVectors[result.id]
            val rerankScore = if (docVector != null) {
                // 结合原始分数和向量相似度
                val similarity = VectorMath.cosineSimilarity(queryVector, docVector)
                result.score * 0.6 + similarity * 0.4
            } else {
                result.score
            }

            result.copy(score = rerankScore)
        }.sortedByDescending { it.score }
    }

    /**
     * 计算关键词匹配分数
     */
    private fun calculateKeywordScore(queryTerms: List<String>, content: String): Double {
        if (queryTerms.isEmpty()) return 0.0

        val contentLower = content.lowercase()
        var matchCount = 0
        var totalWeight = 0.0

        queryTerms.forEachIndexed { index, term ->
            if (contentLower.contains(term.lowercase())) {
                matchCount++
                // 前面的词权重更高（假设更重要）
                totalWeight += 1.0 / (index + 1)
            }
        }

        if (matchCount == 0) return 0.0

        // 计算覆盖率和权重
        val coverage = matchCount.toDouble() / queryTerms.size
        val weightedScore = totalWeight / queryTerms.size

        return (coverage + weightedScore) / 2
    }

    /**
     * 查询分词
     */
    private fun tokenizeQuery(query: String): List<String> {
        val tokens = mutableListOf<String>()
        val processedText = query.lowercase().replace(Regex("[\\p{P}\\p{S}]"), " ")

        // 分离中英文
        val segments = processedText.split(Regex("(?<=[\\u4e00-\\u9fa5])|(?=[\\u4e00-\\u9fa5])"))

        for (segment in segments) {
            val trimmed = segment.trim()
            if (trimmed.isEmpty()) continue

            if (trimmed.any { it in '\u4e00'..'\u9fa5' }) {
                // 中文
                trimmed.forEach { char ->
                    tokens.add(char.toString())
                }
            } else {
                // 英文
                trimmed.split(Regex("\\s+")).filter { it.isNotBlank() }.forEach {
                    tokens.add(it)
                }
            }
        }

        return tokens
    }

    /**
     * 分数归一化到0-1范围
     */
    private fun normalizeScore(score: Double, min: Double, max: Double): Double {
        if (max <= min) return 0.0
        return ((score - min) / (max - min)).coerceIn(0.0, 1.0)
    }

    /**
     * 获取统计信息
     */
    fun getStats(): HybridRetrieverStats {
        return HybridRetrieverStats(
            documentCount = indexedDocuments.size,
            vectorCacheSize = documentVectors.size,
            bm25Stats = bm25Retriever.getStats(),
            config = config
        )
    }

    /**
     * 清除索引
     */
    fun clear() {
        indexedDocuments.clear()
        documentVectors.clear()
    }
}

/**
 * 索引文档
 */
data class IndexedDocument(
    val id: String,
    val title: String,
    val content: String
)

/**
 * 混合搜索结果
 */
data class HybridSearchResult(
    val id: String,
    val title: String,
    val content: String,
    val score: Double,
    val bm25Score: Double,
    val vectorScore: Double,
    val keywordScore: Double,
    val matchedTerms: List<String>,
    val searchMethod: String
)

/**
 * 搜索模式
 */
enum class SearchMode {
    /** 仅BM25 */
    BM25_ONLY,
    /** 仅向量搜索 */
    VECTOR_ONLY,
    /** 仅关键词匹配 */
    KEYWORD_ONLY,
    /** 混合搜索（推荐） */
    HYBRID
}

/**
 * 混合检索器统计信息
 */
data class HybridRetrieverStats(
    val documentCount: Int,
    val vectorCacheSize: Int,
    val bm25Stats: BM25Stats,
    val config: HybridRetriever.HybridConfig
)
