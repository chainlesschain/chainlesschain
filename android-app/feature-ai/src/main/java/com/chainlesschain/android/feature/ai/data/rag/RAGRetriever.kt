package com.chainlesschain.android.feature.ai.data.rag

import android.util.Log
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * RAG检索器
 *
 * 从知识库检索相关内容，增强AI对话
 * 支持多种检索策略：
 * - FTS5全文搜索（快速）
 * - 向量相似度搜索（语义）
 * - BM25检索（平衡）
 * - 混合检索（最佳效果）
 */
@Singleton
class RAGRetriever @Inject constructor(
    private val knowledgeItemDao: KnowledgeItemDao,
    private val vectorEmbedderFactory: VectorEmbedderFactory,
    private val enhancedTfIdfEmbedder: EnhancedTfIdfEmbedder
) {
    companion object {
        private const val TAG = "RAGRetriever"
        private const val MAX_CONTEXT_LENGTH = 2000
        private const val DEFAULT_TOP_K = 3
    }

    private val mutex = Mutex()

    // 使用增强版TF-IDF嵌入器
    private val embedder: VectorEmbedder by lazy { enhancedTfIdfEmbedder }

    // BM25检索器
    private val bm25Retriever: BM25Retriever by lazy { BM25Retriever() }

    // 混合检索器
    private val hybridRetriever: HybridRetriever by lazy {
        HybridRetriever(
            bm25Retriever = bm25Retriever,
            vectorEmbedder = embedder,
            config = HybridRetriever.HybridConfig(
                bm25Weight = 0.4,
                vectorWeight = 0.4,
                keywordWeight = 0.2,
                enableReranking = true
            )
        )
    }

    // 是否已初始化索引
    private var isIndexed = false

    /**
     * 初始化检索器，建立索引
     */
    suspend fun initialize(): Unit = withContext(Dispatchers.IO) {
        mutex.withLock {
            if (isIndexed) return@withContext

            try {
                Log.i(TAG, "Initializing RAG retriever...")

                // 初始化增强嵌入器
                enhancedTfIdfEmbedder.initialize()

                // 从数据库获取所有知识库项
                val allItems = knowledgeItemDao.getAllItemsSync()
                Log.i(TAG, "Found ${allItems.size} knowledge items")

                if (allItems.isNotEmpty()) {
                    // 转换为可索引文档
                    val documents = allItems.map { entity ->
                        IndexableDocument(
                            id = entity.id,
                            title = entity.title,
                            content = entity.content
                        )
                    }

                    // 建立索引
                    hybridRetriever.indexDocuments(documents)

                    // 更新TF-IDF文档频率统计
                    enhancedTfIdfEmbedder.updateFromCorpus(documents.map { it.content })

                    isIndexed = true
                    Log.i(TAG, "RAG retriever initialized with ${documents.size} documents")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize RAG retriever", e)
            }
        }
    }

    /**
     * 刷新索引
     */
    suspend fun refreshIndex() = withContext(Dispatchers.IO) {
        mutex.withLock {
            isIndexed = false
        }
        initialize()
    }

    /**
     * 检索相关知识库内容
     *
     * @param query 用户查询
     * @param topK 返回最相关的K个结果
     * @param strategy 检索策略
     * @return 相关知识库内容列表
     */
    suspend fun retrieve(
        query: String,
        topK: Int = DEFAULT_TOP_K,
        strategy: RetrievalStrategy = RetrievalStrategy.HYBRID
    ): List<RetrievalResult> {
        if (query.isBlank()) return emptyList()

        // 确保已初始化
        if (!isIndexed) {
            initialize()
        }

        return when (strategy) {
            RetrievalStrategy.FTS5 -> retrieveByFTS5(query, topK)
            RetrievalStrategy.VECTOR -> retrieveByVector(query, topK)
            RetrievalStrategy.BM25 -> retrieveByBM25(query, topK)
            RetrievalStrategy.HYBRID -> retrieveByHybrid(query, topK)
        }
    }

    /**
     * FTS4全文搜索检索（使用FTS索引）
     */
    private suspend fun retrieveByFTS5(query: String, topK: Int): List<RetrievalResult> {
        return try {
            // 使用FTS4索引搜索（比LIKE查询快10-60倍）
            val ftsQuery = buildFtsQuery(query)
            val searchResults = knowledgeItemDao.searchItems(ftsQuery)
                .load(
                    androidx.paging.PagingSource.LoadParams.Refresh(
                        key = 0,
                        loadSize = topK,
                        placeholdersEnabled = false
                    )
                )

            when (searchResults) {
                is androidx.paging.PagingSource.LoadResult.Page -> {
                    searchResults.data.mapIndexed { index, entity ->
                        RetrievalResult(
                            id = entity.id,
                            title = entity.title,
                            content = entity.content,
                            score = calculateKeywordRelevanceScore(query, entity.content, index),
                            source = "知识库: ${entity.title}",
                            searchMethod = "FTS5",
                            matchedTerms = extractMatchedTerms(query, entity.content)
                        )
                    }
                }
                else -> emptyList()
            }
        } catch (e: Exception) {
            Log.e(TAG, "FTS5 search failed", e)
            emptyList()
        }
    }

    /**
     * 向量相似度检索
     */
    private suspend fun retrieveByVector(query: String, topK: Int): List<RetrievalResult> {
        return try {
            val queryVector = embedder.embed(query)
            val allItems = knowledgeItemDao.getAllItemsSync()

            val scoredResults = allItems.map { entity ->
                val docVector = embedder.embed(entity.content)
                val similarity = VectorMath.cosineSimilarity(queryVector, docVector)

                RetrievalResult(
                    id = entity.id,
                    title = entity.title,
                    content = entity.content,
                    score = similarity,
                    source = "知识库: ${entity.title}",
                    searchMethod = "Vector",
                    matchedTerms = emptyList()
                )
            }

            scoredResults
                .filter { it.score > 0.1 }
                .sortedByDescending { it.score }
                .take(topK)
        } catch (e: Exception) {
            Log.e(TAG, "Vector search failed", e)
            emptyList()
        }
    }

    /**
     * BM25检索
     */
    private suspend fun retrieveByBM25(query: String, topK: Int): List<RetrievalResult> {
        return try {
            // 确保BM25已索引
            if (!isIndexed) {
                initialize()
            }

            bm25Retriever.search(query, topK).map { result ->
                RetrievalResult(
                    id = result.id,
                    title = result.title,
                    content = result.content,
                    score = result.score,
                    source = "知识库: ${result.title}",
                    searchMethod = "BM25",
                    matchedTerms = result.matchedTerms
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "BM25 search failed", e)
            emptyList()
        }
    }

    /**
     * 混合检索（推荐）
     */
    private suspend fun retrieveByHybrid(query: String, topK: Int): List<RetrievalResult> {
        return try {
            // 确保已索引
            if (!isIndexed) {
                initialize()
            }

            hybridRetriever.search(query, topK, SearchMode.HYBRID).map { result ->
                RetrievalResult(
                    id = result.id,
                    title = result.title,
                    content = result.content,
                    score = result.score,
                    source = "知识库: ${result.title}",
                    searchMethod = "Hybrid(BM25=${String.format("%.2f", result.bm25Score)}, " +
                            "Vec=${String.format("%.2f", result.vectorScore)}, " +
                            "Key=${String.format("%.2f", result.keywordScore)})",
                    matchedTerms = result.matchedTerms
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Hybrid search failed", e)
            // 降级到FTS5
            retrieveByFTS5(query, topK)
        }
    }

    /**
     * 计算关键词匹配相关性分数
     */
    private fun calculateKeywordRelevanceScore(
        query: String,
        content: String,
        position: Int
    ): Double {
        val queryTerms = tokenizeQuery(query)
        val contentLower = content.lowercase()

        val matchCount = queryTerms.count { term ->
            contentLower.contains(term)
        }

        val matchScore = matchCount.toDouble() / queryTerms.size.coerceAtLeast(1)
        val positionPenalty = position * 0.1

        return (matchScore - positionPenalty).coerceAtLeast(0.0)
    }

    /**
     * 提取匹配的词
     */
    private fun extractMatchedTerms(query: String, content: String): List<String> {
        val queryTerms = tokenizeQuery(query)
        val contentLower = content.lowercase()

        return queryTerms.filter { term ->
            contentLower.contains(term)
        }
    }

    /**
     * 查询分词
     */
    private fun tokenizeQuery(query: String): List<String> {
        val tokens = mutableListOf<String>()
        val processedText = query.lowercase().replace(Regex("[\\p{P}\\p{S}]"), " ")

        val segments = processedText.split(Regex("(?<=[\\u4e00-\\u9fa5])|(?=[\\u4e00-\\u9fa5])"))

        for (segment in segments) {
            val trimmed = segment.trim()
            if (trimmed.isEmpty()) continue

            if (trimmed.any { it in '\u4e00'..'\u9fa5' }) {
                trimmed.forEach { char ->
                    tokens.add(char.toString())
                }
            } else {
                trimmed.split(Regex("\\s+")).filter { it.isNotBlank() }.forEach {
                    tokens.add(it)
                }
            }
        }

        return tokens
    }

    /**
     * 构建RAG增强的上下文
     *
     * @param query 用户查询
     * @param topK 检索数量
     * @param strategy 检索策略
     * @return 格式化的上下文字符串
     */
    suspend fun buildContext(
        query: String,
        topK: Int = DEFAULT_TOP_K,
        strategy: RetrievalStrategy = RetrievalStrategy.HYBRID
    ): String {
        val results = retrieve(query, topK, strategy)

        if (results.isEmpty()) {
            return ""
        }

        val contextBuilder = StringBuilder()
        contextBuilder.append("以下是相关的知识库内容，请参考这些信息回答用户问题：\n\n")

        var totalLength = 0
        results.forEachIndexed { index, result ->
            val contentPreview = result.content.take(MAX_CONTEXT_LENGTH / topK)
            val needTruncate = result.content.length > contentPreview.length

            if (totalLength + contentPreview.length > MAX_CONTEXT_LENGTH) {
                return@forEachIndexed
            }

            contextBuilder.append("【参考资料 ${index + 1}】\n")
            contextBuilder.append("标题: ${result.title}\n")
            contextBuilder.append("相关度: ${String.format("%.2f", result.score)}\n")
            if (result.matchedTerms.isNotEmpty()) {
                contextBuilder.append("匹配词: ${result.matchedTerms.joinToString(", ")}\n")
            }
            contextBuilder.append("内容: $contentPreview")
            if (needTruncate) {
                contextBuilder.append("...")
            }
            contextBuilder.append("\n\n")

            totalLength += contentPreview.length
        }

        contextBuilder.append("---\n\n")
        return contextBuilder.toString()
    }

    /**
     * 获取检索器统计信息
     */
    fun getStats(): RAGRetrieverStats {
        return RAGRetrieverStats(
            isIndexed = isIndexed,
            embedderStats = enhancedTfIdfEmbedder.getStats(),
            bm25Stats = bm25Retriever.getStats(),
            hybridStats = if (isIndexed) hybridRetriever.getStats() else null
        )
    }

    /**
     * 构建安全的FTS查询字符串
     *
     * 将用户输入转换为FTS4 MATCH格式
     * - 规范化空白字符
     * - 转义特殊字符
     * - 添加前缀匹配支持（*）
     *
     * @param query 原始查询字符串
     * @return FTS4格式的查询字符串
     */
    private fun buildFtsQuery(query: String): String {
        val normalized = query.trim().replace(Regex("\\s+"), " ")
        if (normalized.isEmpty()) return ""
        return normalized
            .split(" ")
            .joinToString(" ") { token ->
                val safeToken = token.replace("\"", "")
                "$safeToken*"
            }
    }
}

/**
 * 检索策略
 */
enum class RetrievalStrategy {
    /** FTS5全文搜索（快速，适合精确匹配） */
    FTS5,
    /** 向量相似度搜索（语义理解，较慢） */
    VECTOR,
    /** BM25算法（平衡速度和准确性） */
    BM25,
    /** 混合检索（最佳效果，推荐） */
    HYBRID
}

/**
 * 检索结果
 */
data class RetrievalResult(
    val id: String = "",
    val title: String,
    val content: String,
    val score: Double,
    val source: String,
    val searchMethod: String = "FTS5",
    val matchedTerms: List<String> = emptyList()
)

/**
 * RAG检索器统计信息
 */
data class RAGRetrieverStats(
    val isIndexed: Boolean,
    val embedderStats: EmbedderStats,
    val bm25Stats: BM25Stats,
    val hybridStats: HybridRetrieverStats?
)

/**
 * 向量化工具（保留向后兼容）
 */
@Deprecated("Use VectorMath instead", ReplaceWith("VectorMath"))
object VectorUtils {
    fun embed(text: String): FloatArray {
        return FloatArray(384) { Math.random().toFloat() }
    }

    fun cosineSimilarity(vec1: FloatArray, vec2: FloatArray): Double {
        return VectorMath.cosineSimilarity(vec1, vec2)
    }
}
