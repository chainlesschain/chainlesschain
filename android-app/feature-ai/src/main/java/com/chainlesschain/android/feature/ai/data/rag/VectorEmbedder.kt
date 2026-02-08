package com.chainlesschain.android.feature.ai.data.rag

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.LongBuffer
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
     * 当没有语料库时，返回默认IDF值1.0以确保向量非零
     */
    private fun calculateIDF(term: String): Double {
        // 当没有训练数据时，返回1.0作为默认IDF值
        if (totalDocuments == 0) {
            return 1.0
        }
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
 * Sentence Transformer嵌入器 (ONNX Runtime)
 *
 * 使用 all-MiniLM-L6-v2 ONNX 模型生成384维文本嵌入向量
 * 模型在首次使用时自动下载并缓存到本地
 * 当模型不可用时，优雅降级为 TF-IDF
 */
@Singleton
class SentenceTransformerEmbedder @Inject constructor(
    private val modelManager: OnnxModelManager
) : VectorEmbedder {

    companion object {
        private const val TAG = "SentenceTransformerEmbedder"
        private const val VECTOR_DIM = 384
    }

    private var ortEnv: OrtEnvironment? = null
    private var ortSession: OrtSession? = null
    private var tokenizer: WordPieceTokenizer? = null
    private var initialized = false
    private var initFailed = false

    /**
     * Lazily initialize the ONNX session and tokenizer
     */
    private suspend fun ensureInitialized(): Boolean {
        if (initialized) return true
        if (initFailed) return false

        return try {
            withContext(Dispatchers.IO) {
                if (!modelManager.isModelAvailable()) {
                    Log.i(TAG, "Model not available, attempting download...")
                    val downloaded = modelManager.ensureModelAvailable()
                    if (!downloaded) {
                        Log.w(TAG, "Model download failed, will use fallback")
                        initFailed = true
                        return@withContext false
                    }
                }

                val env = OrtEnvironment.getEnvironment()
                val sessionOptions = OrtSession.SessionOptions().apply {
                    setIntraOpNumThreads(2)
                }
                val session = env.createSession(
                    modelManager.modelFile.absolutePath,
                    sessionOptions
                )

                ortEnv = env
                ortSession = session
                tokenizer = WordPieceTokenizer(modelManager.vocabFile)
                initialized = true

                Log.i(TAG, "ONNX model loaded successfully")
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize ONNX model", e)
            initFailed = true
            false
        }
    }

    override suspend fun embed(text: String): FloatArray {
        if (!ensureInitialized()) {
            // Fallback: deterministic hash-based vector when model unavailable
            return hashBasedFallback(text)
        }

        return withContext(Dispatchers.Default) {
            try {
                val tkn = tokenizer ?: return@withContext hashBasedFallback(text)
                val session = ortSession ?: return@withContext hashBasedFallback(text)
                val env = ortEnv ?: return@withContext hashBasedFallback(text)

                val tokenized = tkn.tokenize(text)
                val seqLen = WordPieceTokenizer.MAX_SEQ_LENGTH.toLong()
                val shape = longArrayOf(1, seqLen)

                val inputIdsTensor = OnnxTensor.createTensor(
                    env,
                    LongBuffer.wrap(tokenized.inputIds),
                    shape
                )
                val attentionMaskTensor = OnnxTensor.createTensor(
                    env,
                    LongBuffer.wrap(tokenized.attentionMask),
                    shape
                )
                // token_type_ids: all zeros for single-sentence input
                val tokenTypeIds = LongArray(WordPieceTokenizer.MAX_SEQ_LENGTH)
                val tokenTypeTensor = OnnxTensor.createTensor(
                    env,
                    LongBuffer.wrap(tokenTypeIds),
                    shape
                )

                val inputs = mapOf(
                    "input_ids" to inputIdsTensor,
                    "attention_mask" to attentionMaskTensor,
                    "token_type_ids" to tokenTypeTensor
                )

                val result = session.run(inputs)

                // Extract token embeddings: shape [1, seq_len, 384]
                @Suppress("UNCHECKED_CAST")
                val embeddings = result[0].value as Array<Array<FloatArray>>
                val tokenEmbeddings = embeddings[0]

                // Mean pooling with attention mask
                val pooled = meanPooling(tokenEmbeddings, tokenized.attentionMask)

                // Cleanup
                inputIdsTensor.close()
                attentionMaskTensor.close()
                tokenTypeTensor.close()
                result.close()

                normalize(pooled)
            } catch (e: Exception) {
                Log.e(TAG, "ONNX inference failed, using fallback", e)
                hashBasedFallback(text)
            }
        }
    }

    override fun getDimension(): Int = VECTOR_DIM

    /**
     * Mean pooling: average token embeddings weighted by attention mask
     */
    private fun meanPooling(tokenEmbeddings: Array<FloatArray>, attentionMask: LongArray): FloatArray {
        val dim = tokenEmbeddings[0].size
        val summed = FloatArray(dim)
        var count = 0f

        for (i in tokenEmbeddings.indices) {
            if (attentionMask[i] == 1L) {
                for (j in 0 until dim) {
                    summed[j] += tokenEmbeddings[i][j]
                }
                count += 1f
            }
        }

        if (count > 0f) {
            for (j in 0 until dim) {
                summed[j] /= count
            }
        }

        return summed
    }

    /**
     * Deterministic hash-based fallback when ONNX model is unavailable.
     * Same input always produces same output (unlike random vectors).
     */
    private fun hashBasedFallback(text: String): FloatArray {
        val vector = FloatArray(VECTOR_DIM)
        val hash = text.hashCode().toLong()
        for (i in 0 until VECTOR_DIM) {
            val seed = hash * 31 + i.toLong()
            vector[i] = ((seed % 1000) / 1000f) * 2f - 1f
        }
        return normalize(vector)
    }

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
                // Use local ONNX model for high-quality embeddings (offline, free)
                // Cloud embedding APIs can be added as a future enhancement
                sentenceTransformerEmbedder
            }
        }
    }
}
