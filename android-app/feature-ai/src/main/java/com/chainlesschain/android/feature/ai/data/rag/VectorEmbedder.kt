package com.chainlesschain.android.feature.ai.data.rag

import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.ln
import kotlin.math.sqrt

/**
 * 向量嵌入器接口
 *
 * 定义文本向量化的统一接口
 */
interface VectorEmbedder {
    /**
     * 将文本转换为向量
     *
     * @param text 输入文本
     * @return 向量表示
     */
    suspend fun embed(text: String): FloatArray

    /**
     * 获取向量维度
     */
    fun getDimension(): Int
}

/**
 * TF-IDF向量嵌入器
 *
 * 基于TF-IDF的简单文本向量化实现
 * 适合作为基础方案或ML模型的后备方案
 */
@Singleton
class TfIdfEmbedder @Inject constructor() : VectorEmbedder {

    companion object {
        private const val VECTOR_DIM = 128
        private const val MIN_WORD_LENGTH = 2
    }

    // 词汇表（简化版，实际应该从语料库构建）
    private val vocabulary = mutableMapOf<String, Int>()
    private var vocabularySize = 0

    // 文档频率（Document Frequency）
    private val documentFrequency = mutableMapOf<String, Int>()
    private var totalDocuments = 0

    override suspend fun embed(text: String): FloatArray {
        val tokens = tokenize(text)
        val termFrequency = calculateTermFrequency(tokens)

        // 计算TF-IDF向量
        val vector = FloatArray(VECTOR_DIM) { 0f }

        termFrequency.forEach { (term, tf) ->
            val wordIndex = getOrCreateWordIndex(term)
            if (wordIndex < VECTOR_DIM) {
                val idf = calculateIDF(term)
                vector[wordIndex] = (tf * idf).toFloat()
            }
        }

        // 归一化
        return normalize(vector)
    }

    override fun getDimension(): Int = VECTOR_DIM

    /**
     * 分词（简单实现）
     */
    private fun tokenize(text: String): List<String> {
        return text.lowercase()
            .replace(Regex("[^a-z0-9\\u4e00-\\u9fa5\\s]"), " ")
            .split(Regex("\\s+"))
            .filter { it.length >= MIN_WORD_LENGTH }
    }

    /**
     * 计算词频（Term Frequency）
     */
    private fun calculateTermFrequency(tokens: List<String>): Map<String, Double> {
        if (tokens.isEmpty()) return emptyMap()

        val termCount = mutableMapOf<String, Int>()
        tokens.forEach { term ->
            termCount[term] = termCount.getOrDefault(term, 0) + 1
        }

        val maxFreq = termCount.values.maxOrNull() ?: 1
        return termCount.mapValues { (_, count) ->
            count.toDouble() / maxFreq
        }
    }

    /**
     * 计算逆文档频率（Inverse Document Frequency）
     */
    private fun calculateIDF(term: String): Double {
        val df = documentFrequency.getOrDefault(term, 1)
        val total = totalDocuments.coerceAtLeast(1)
        return ln((total + 1).toDouble() / (df + 1))
    }

    /**
     * 获取或创建词汇索引
     */
    private fun getOrCreateWordIndex(word: String): Int {
        return vocabulary.getOrPut(word) {
            val index = vocabularySize % VECTOR_DIM
            vocabularySize++
            index
        }
    }

    /**
     * 向量归一化
     */
    private fun normalize(vector: FloatArray): FloatArray {
        val magnitude = sqrt(vector.sumOf { (it * it).toDouble() }).toFloat()
        if (magnitude == 0f) return vector

        return FloatArray(vector.size) { i ->
            vector[i] / magnitude
        }
    }

    /**
     * 更新文档频率统计（用于训练）
     */
    fun updateDocumentFrequency(documents: List<String>) {
        totalDocuments = documents.size

        documents.forEach { doc ->
            val uniqueTerms = tokenize(doc).toSet()
            uniqueTerms.forEach { term ->
                documentFrequency[term] = documentFrequency.getOrDefault(term, 0) + 1
            }
        }
    }
}

/**
 * Sentence Transformer嵌入器（占位实现）
 *
 * 未来可集成实际的ML模型：
 * - TensorFlow Lite
 * - ONNX Runtime
 * - 云端API（如OpenAI Embeddings）
 */
@Singleton
class SentenceTransformerEmbedder @Inject constructor() : VectorEmbedder {

    companion object {
        private const val VECTOR_DIM = 384 // 典型的sentence-transformers维度
    }

    override suspend fun embed(text: String): FloatArray {
        // TODO: 集成实际的ML模型
        // 选项1: TensorFlow Lite (推荐)
        // 选项2: ONNX Runtime
        // 选项3: 云端API（OpenAI、Cohere等）

        // 占位实现：返回归一化的随机向量
        val vector = FloatArray(VECTOR_DIM) {
            (Math.random() * 2 - 1).toFloat()
        }
        return normalize(vector)
    }

    override fun getDimension(): Int = VECTOR_DIM

    private fun normalize(vector: FloatArray): FloatArray {
        val magnitude = sqrt(vector.sumOf { (it * it).toDouble() }).toFloat()
        if (magnitude == 0f) return vector

        return FloatArray(vector.size) { i ->
            vector[i] / magnitude
        }
    }
}

/**
 * 向量工具类
 */
object VectorMath {

    /**
     * 计算余弦相似度
     */
    fun cosineSimilarity(vec1: FloatArray, vec2: FloatArray): Double {
        require(vec1.size == vec2.size) { "向量维度不匹配: ${vec1.size} vs ${vec2.size}" }

        var dotProduct = 0.0
        var norm1 = 0.0
        var norm2 = 0.0

        for (i in vec1.indices) {
            dotProduct += vec1[i] * vec2[i]
            norm1 += vec1[i] * vec1[i]
            norm2 += vec2[i] * vec2[i]
        }

        val denominator = sqrt(norm1) * sqrt(norm2)
        return if (denominator == 0.0) {
            0.0
        } else {
            dotProduct / denominator
        }
    }

    /**
     * 计算欧几里得距离
     */
    fun euclideanDistance(vec1: FloatArray, vec2: FloatArray): Double {
        require(vec1.size == vec2.size) { "向量维度不匹配" }

        var sum = 0.0
        for (i in vec1.indices) {
            val diff = vec1[i] - vec2[i]
            sum += diff * diff
        }

        return sqrt(sum)
    }

    /**
     * 归一化向量
     */
    fun normalize(vector: FloatArray): FloatArray {
        val magnitude = sqrt(vector.sumOf { (it * it).toDouble() }).toFloat()
        if (magnitude == 0f) return vector

        return FloatArray(vector.size) { i ->
            vector[i] / magnitude
        }
    }
}

/**
 * 嵌入器配置
 */
enum class EmbedderType {
    /** TF-IDF基础实现（快速，离线） */
    TF_IDF,

    /** Sentence Transformers（高质量，需ML模型） */
    SENTENCE_TRANSFORMER,

    /** OpenAI Embeddings（云端API） */
    OPENAI_API
}

/**
 * 嵌入器工厂
 */
@Singleton
class VectorEmbedderFactory @Inject constructor(
    private val tfIdfEmbedder: TfIdfEmbedder,
    private val sentenceTransformerEmbedder: SentenceTransformerEmbedder
) {

    fun createEmbedder(type: EmbedderType): VectorEmbedder {
        return when (type) {
            EmbedderType.TF_IDF -> tfIdfEmbedder
            EmbedderType.SENTENCE_TRANSFORMER -> sentenceTransformerEmbedder
            EmbedderType.OPENAI_API -> {
                // TODO: 实现OpenAI Embeddings集成
                tfIdfEmbedder // 临时降级到TF-IDF
            }
        }
    }
}
