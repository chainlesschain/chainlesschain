package com.chainlesschain.android.feature.ai.data.rag

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.ln
import kotlin.math.sqrt

/**
 * 增强版TF-IDF向量嵌入器
 *
 * 改进点：
 * - 支持中文分词
 * - 词汇表持久化
 * - 文档频率统计持久化
 * - 向量缓存
 * - 更高的向量维度
 */
@Singleton
class EnhancedTfIdfEmbedder @Inject constructor(
    @ApplicationContext private val context: Context
) : VectorEmbedder {

    companion object {
        private const val TAG = "EnhancedTfIdfEmbedder"
        private const val VECTOR_DIM = 256
        private const val MIN_WORD_LENGTH = 1  // 中文单字也有效
        private const val MAX_VOCAB_SIZE = 10000
        private const val VOCAB_FILE = "tfidf_vocabulary.json"
        private const val CACHE_FILE = "tfidf_cache.json"
        private const val MAX_CACHE_SIZE = 1000

        // 中文停用词
        private val CHINESE_STOP_WORDS = setOf(
            "的", "了", "和", "是", "就", "都", "而", "及", "与", "着",
            "或", "一个", "没有", "我们", "你们", "他们", "它们", "这个",
            "那个", "之", "以", "其", "为", "此", "彼", "何", "乎", "者",
            "也", "矣", "焉", "哉", "呢", "吗", "啊", "呀", "吧", "嘛"
        )

        // 英文停用词
        private val ENGLISH_STOP_WORDS = setOf(
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "could", "should", "may", "might", "must", "shall",
            "can", "need", "dare", "ought", "used", "to", "of", "in",
            "for", "on", "with", "at", "by", "from", "as", "into", "through",
            "during", "before", "after", "above", "below", "between", "under",
            "again", "further", "then", "once", "here", "there", "when",
            "where", "why", "how", "all", "each", "few", "more", "most",
            "other", "some", "such", "no", "nor", "not", "only", "own",
            "same", "so", "than", "too", "very", "just", "and", "but",
            "if", "or", "because", "until", "while", "this", "that", "these", "those"
        )
    }

    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }
    private val mutex = Mutex()

    // 词汇表
    private val vocabulary = mutableMapOf<String, Int>()
    private var nextVocabIndex = 0

    // 文档频率
    private val documentFrequency = mutableMapOf<String, Int>()
    private var totalDocuments = 0

    // 向量缓存 (文本hash -> 向量)
    private val vectorCache = mutableMapOf<String, FloatArray>()

    private var isInitialized = false

    /**
     * 初始化嵌入器
     */
    suspend fun initialize() = withContext(Dispatchers.IO) {
        mutex.withLock {
            if (isInitialized) return@withContext

            try {
                loadVocabulary()
                loadCache()
                isInitialized = true
                Log.i(TAG, "Embedder initialized: vocab=${vocabulary.size}, cache=${vectorCache.size}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize embedder", e)
            }
        }
    }

    override suspend fun embed(text: String): FloatArray {
        if (!isInitialized) initialize()

        // 检查缓存
        val textHash = hashText(text)
        vectorCache[textHash]?.let {
            return it
        }

        val tokens = tokenize(text)
        val termFrequency = calculateTermFrequency(tokens)

        // 计算TF-IDF向量
        val vector = FloatArray(VECTOR_DIM) { 0f }

        termFrequency.forEach { (term, tf) ->
            val wordIndex = getOrCreateWordIndex(term)
            if (wordIndex < VECTOR_DIM) {
                val idf = calculateIDF(term)
                vector[wordIndex] += (tf * idf).toFloat()
            }
        }

        // 归一化
        val normalizedVector = normalize(vector)

        // 添加到缓存
        addToCache(textHash, normalizedVector)

        return normalizedVector
    }

    override fun getDimension(): Int = VECTOR_DIM

    /**
     * 中英文混合分词
     */
    private fun tokenize(text: String): List<String> {
        val tokens = mutableListOf<String>()

        // 预处理
        val processedText = text.lowercase()
            .replace(Regex("[\\p{P}\\p{S}]"), " ")  // 移除标点符号

        // 分离中英文
        val segments = processedText.split(Regex("(?<=[\\u4e00-\\u9fa5])|(?=[\\u4e00-\\u9fa5])"))

        for (segment in segments) {
            val trimmed = segment.trim()
            if (trimmed.isEmpty()) continue

            if (isChinese(trimmed)) {
                // 中文：使用字符级分词 + 双字词
                val chars = trimmed.toCharArray()
                for (i in chars.indices) {
                    val char = chars[i].toString()
                    if (!CHINESE_STOP_WORDS.contains(char)) {
                        tokens.add(char)
                    }
                    // 添加双字词
                    if (i < chars.size - 1) {
                        val biGram = "${chars[i]}${chars[i + 1]}"
                        if (!CHINESE_STOP_WORDS.contains(biGram)) {
                            tokens.add(biGram)
                        }
                    }
                }
            } else {
                // 英文：按空格分词
                val words = trimmed.split(Regex("\\s+"))
                for (word in words) {
                    if (word.length >= MIN_WORD_LENGTH && !ENGLISH_STOP_WORDS.contains(word)) {
                        tokens.add(word)
                    }
                }
            }
        }

        return tokens
    }

    private fun isChinese(text: String): Boolean {
        return text.any { it in '\u4e00'..'\u9fa5' }
    }

    /**
     * 计算词频（Term Frequency）- 使用增强版公式
     */
    private fun calculateTermFrequency(tokens: List<String>): Map<String, Double> {
        if (tokens.isEmpty()) return emptyMap()

        val termCount = mutableMapOf<String, Int>()
        tokens.forEach { term ->
            termCount[term] = termCount.getOrDefault(term, 0) + 1
        }

        // 使用 log-normalized TF
        return termCount.mapValues { (_, count) ->
            1 + ln(count.toDouble())
        }
    }

    /**
     * 计算逆文档频率（IDF）- 使用平滑版公式
     */
    private fun calculateIDF(term: String): Double {
        val df = documentFrequency.getOrDefault(term, 0)
        val total = totalDocuments.coerceAtLeast(1)
        // 使用平滑IDF
        return ln((total + 1).toDouble() / (df + 1)) + 1.0
    }

    /**
     * 获取或创建词汇索引（使用哈希分桶）
     */
    private fun getOrCreateWordIndex(word: String): Int {
        return vocabulary.getOrPut(word) {
            if (nextVocabIndex < MAX_VOCAB_SIZE) {
                val index = nextVocabIndex % VECTOR_DIM
                nextVocabIndex++
                index
            } else {
                // 词汇表满了，使用哈希
                (word.hashCode() and 0x7FFFFFFF) % VECTOR_DIM
            }
        }
    }

    /**
     * 向量归一化（L2范数）
     */
    private fun normalize(vector: FloatArray): FloatArray {
        val magnitude = sqrt(vector.sumOf { (it * it).toDouble() }).toFloat()
        if (magnitude == 0f) return vector

        return FloatArray(vector.size) { i ->
            vector[i] / magnitude
        }
    }

    /**
     * 更新文档频率统计（批量处理）
     */
    suspend fun updateFromCorpus(documents: List<String>) = withContext(Dispatchers.IO) {
        mutex.withLock {
            Log.i(TAG, "Updating corpus with ${documents.size} documents")

            totalDocuments += documents.size

            documents.forEach { doc ->
                val uniqueTerms = tokenize(doc).toSet()
                uniqueTerms.forEach { term ->
                    documentFrequency[term] = documentFrequency.getOrDefault(term, 0) + 1
                }
            }

            // 保存词汇表
            saveVocabulary()
            Log.i(TAG, "Corpus updated: totalDocs=$totalDocuments, vocab=${vocabulary.size}")
        }
    }

    /**
     * 计算文本哈希
     */
    private fun hashText(text: String): String {
        val md = MessageDigest.getInstance("MD5")
        val digest = md.digest(text.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    /**
     * 添加到缓存
     */
    private fun addToCache(hash: String, vector: FloatArray) {
        if (vectorCache.size >= MAX_CACHE_SIZE) {
            // LRU: 移除最早的项
            val firstKey = vectorCache.keys.firstOrNull()
            firstKey?.let { vectorCache.remove(it) }
        }
        vectorCache[hash] = vector
    }

    /**
     * 保存词汇表
     */
    private suspend fun saveVocabulary() = withContext(Dispatchers.IO) {
        try {
            val data = VocabularyData(
                vocabulary = vocabulary.toMap(),
                documentFrequency = documentFrequency.toMap(),
                totalDocuments = totalDocuments,
                nextVocabIndex = nextVocabIndex
            )
            val jsonString = json.encodeToString(data)
            File(context.filesDir, VOCAB_FILE).writeText(jsonString)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save vocabulary", e)
        }
    }

    /**
     * 加载词汇表
     */
    private suspend fun loadVocabulary() = withContext(Dispatchers.IO) {
        try {
            val file = File(context.filesDir, VOCAB_FILE)
            if (!file.exists()) return@withContext

            val jsonString = file.readText()
            val data = json.decodeFromString<VocabularyData>(jsonString)

            vocabulary.clear()
            vocabulary.putAll(data.vocabulary)
            documentFrequency.clear()
            documentFrequency.putAll(data.documentFrequency)
            totalDocuments = data.totalDocuments
            nextVocabIndex = data.nextVocabIndex

            Log.d(TAG, "Vocabulary loaded: ${vocabulary.size} terms")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load vocabulary", e)
        }
    }

    /**
     * 保存缓存
     */
    suspend fun saveCache() = withContext(Dispatchers.IO) {
        try {
            val cacheData = vectorCache.mapValues { (_, vector) ->
                vector.toList()
            }
            val jsonString = json.encodeToString(cacheData)
            File(context.filesDir, CACHE_FILE).writeText(jsonString)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save cache", e)
        }
    }

    /**
     * 加载缓存
     */
    private suspend fun loadCache() = withContext(Dispatchers.IO) {
        try {
            val file = File(context.filesDir, CACHE_FILE)
            if (!file.exists()) return@withContext

            val jsonString = file.readText()
            val cacheData = json.decodeFromString<Map<String, List<Float>>>(jsonString)

            vectorCache.clear()
            cacheData.forEach { (hash, list) ->
                vectorCache[hash] = list.toFloatArray()
            }

            Log.d(TAG, "Cache loaded: ${vectorCache.size} vectors")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load cache", e)
        }
    }

    /**
     * 清除缓存
     */
    suspend fun clearCache() = withContext(Dispatchers.IO) {
        mutex.withLock {
            vectorCache.clear()
            File(context.filesDir, CACHE_FILE).delete()
            Log.i(TAG, "Cache cleared")
        }
    }

    /**
     * 获取统计信息
     */
    fun getStats(): EmbedderStats {
        return EmbedderStats(
            vocabularySize = vocabulary.size,
            totalDocuments = totalDocuments,
            cacheSize = vectorCache.size,
            vectorDimension = VECTOR_DIM
        )
    }
}

/**
 * 词汇表持久化数据
 */
@Serializable
private data class VocabularyData(
    val vocabulary: Map<String, Int>,
    val documentFrequency: Map<String, Int>,
    val totalDocuments: Int,
    val nextVocabIndex: Int
)

/**
 * 嵌入器统计信息
 */
data class EmbedderStats(
    val vocabularySize: Int,
    val totalDocuments: Int,
    val cacheSize: Int,
    val vectorDimension: Int
)
