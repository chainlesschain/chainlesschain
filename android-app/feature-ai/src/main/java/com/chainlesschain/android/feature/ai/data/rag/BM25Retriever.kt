package com.chainlesschain.android.feature.ai.data.rag

import timber.log.Timber
import kotlin.math.ln

/**
 * BM25检索器
 *
 * 实现BM25（Best Matching 25）算法
 * 这是一种基于概率的信息检索算法，比TF-IDF更先进
 *
 * BM25公式:
 * score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D|/avgdl))
 *
 * 其中:
 * - f(qi, D): 词qi在文档D中的频率
 * - |D|: 文档D的长度
 * - avgdl: 平均文档长度
 * - k1: 词频饱和参数（通常1.2-2.0）
 * - b: 文档长度归一化参数（通常0.75）
 */
class BM25Retriever(
    private val k1: Double = 1.5,
    private val b: Double = 0.75
) {
    companion object {
        // 停用词
        private val STOP_WORDS = setOf(
            "的", "了", "和", "是", "就", "都", "而", "及", "与", "着",
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "to", "of", "in", "for", "on", "with", "at", "by", "from"
        )
    }

    // 文档集合
    private val documents = mutableListOf<BM25Document>()

    // 逆文档频率缓存
    private val idfCache = mutableMapOf<String, Double>()

    // 平均文档长度
    private var avgDocLength = 0.0

    /**
     * 索引文档
     */
    fun indexDocuments(docs: List<IndexableDocument>) {
        documents.clear()
        idfCache.clear()

        var totalLength = 0

        docs.forEach { doc ->
            val tokens = tokenize(doc.content)
            val termFrequency = calculateTermFrequency(tokens)

            documents.add(
                BM25Document(
                    id = doc.id,
                    title = doc.title,
                    content = doc.content,
                    tokens = tokens,
                    termFrequency = termFrequency,
                    length = tokens.size
                )
            )

            totalLength += tokens.size
        }

        avgDocLength = if (documents.isNotEmpty()) {
            totalLength.toDouble() / documents.size
        } else {
            0.0
        }

        // 预计算IDF
        calculateAllIDF()

        Timber.i("Indexed ${documents.size} documents, avgLength=$avgDocLength")
    }

    /**
     * 搜索文档
     */
    fun search(query: String, topK: Int = 5): List<BM25SearchResult> {
        if (documents.isEmpty()) return emptyList()

        val queryTokens = tokenize(query)
        if (queryTokens.isEmpty()) return emptyList()

        val scores = documents.map { doc ->
            val score = calculateBM25Score(queryTokens, doc)
            BM25SearchResult(
                id = doc.id,
                title = doc.title,
                content = doc.content,
                score = score,
                matchedTerms = queryTokens.filter { doc.termFrequency.containsKey(it) }
            )
        }

        return scores
            .filter { it.score > 0 }
            .sortedByDescending { it.score }
            .take(topK)
    }

    /**
     * 计算BM25分数
     */
    private fun calculateBM25Score(queryTokens: List<String>, doc: BM25Document): Double {
        var score = 0.0

        queryTokens.forEach { term ->
            val tf = doc.termFrequency[term] ?: 0
            if (tf > 0) {
                val idf = idfCache[term] ?: calculateIDF(term)

                // BM25公式
                val numerator = tf * (k1 + 1)
                val denominator = tf + k1 * (1 - b + b * doc.length / avgDocLength.coerceAtLeast(1.0))

                score += idf * numerator / denominator
            }
        }

        return score
    }

    /**
     * 计算所有词的IDF
     */
    private fun calculateAllIDF() {
        val allTerms = documents.flatMap { it.termFrequency.keys }.toSet()

        allTerms.forEach { term ->
            idfCache[term] = calculateIDF(term)
        }
    }

    /**
     * 计算IDF（逆文档频率）
     */
    private fun calculateIDF(term: String): Double {
        val n = documents.size
        val df = documents.count { it.termFrequency.containsKey(term) }

        // 使用BM25的IDF公式
        return ln((n - df + 0.5) / (df + 0.5) + 1.0)
    }

    /**
     * 分词
     */
    private fun tokenize(text: String): List<String> {
        val tokens = mutableListOf<String>()

        val processedText = text.lowercase()
            .replace(Regex("[\\p{P}\\p{S}]"), " ")

        // 处理中文和英文
        val segments = processedText.split(Regex("(?<=[\\u4e00-\\u9fa5])|(?=[\\u4e00-\\u9fa5])"))

        for (segment in segments) {
            val trimmed = segment.trim()
            if (trimmed.isEmpty()) continue

            if (trimmed.any { it in '\u4e00'..'\u9fa5' }) {
                // 中文：字符级 + 双字词
                val chars = trimmed.toCharArray()
                for (i in chars.indices) {
                    val char = chars[i].toString()
                    if (!STOP_WORDS.contains(char)) {
                        tokens.add(char)
                    }
                    if (i < chars.size - 1) {
                        val biGram = "${chars[i]}${chars[i + 1]}"
                        tokens.add(biGram)
                    }
                }
            } else {
                // 英文
                val words = trimmed.split(Regex("\\s+"))
                for (word in words) {
                    if (word.length >= 2 && !STOP_WORDS.contains(word)) {
                        tokens.add(word)
                    }
                }
            }
        }

        return tokens
    }

    /**
     * 计算词频
     */
    private fun calculateTermFrequency(tokens: List<String>): Map<String, Int> {
        val termCount = mutableMapOf<String, Int>()
        tokens.forEach { term ->
            termCount[term] = termCount.getOrDefault(term, 0) + 1
        }
        return termCount
    }

    /**
     * 获取统计信息
     */
    fun getStats(): BM25Stats {
        return BM25Stats(
            documentCount = documents.size,
            avgDocumentLength = avgDocLength,
            vocabularySize = idfCache.size,
            k1 = k1,
            b = b
        )
    }
}

/**
 * BM25文档
 */
data class BM25Document(
    val id: String,
    val title: String,
    val content: String,
    val tokens: List<String>,
    val termFrequency: Map<String, Int>,
    val length: Int
)

/**
 * 可索引文档接口
 */
data class IndexableDocument(
    val id: String,
    val title: String,
    val content: String
)

/**
 * BM25搜索结果
 */
data class BM25SearchResult(
    val id: String,
    val title: String,
    val content: String,
    val score: Double,
    val matchedTerms: List<String>
)

/**
 * BM25统计信息
 */
data class BM25Stats(
    val documentCount: Int,
    val avgDocumentLength: Double,
    val vocabularySize: Int,
    val k1: Double,
    val b: Double
)
