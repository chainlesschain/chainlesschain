package com.chainlesschain.android.feature.ai.domain.summary

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件摘要缓存
 *
 * 使用 LRU 缓存策略，支持：
 * - 内存缓存（快速访问）
 * - 持久化缓存（重启后保留）
 * - 过期清理
 *
 * @since v0.32.0
 */
@Singleton
class FileSummaryCache @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val TAG = "FileSummaryCache"
        private const val CACHE_DIR = "file_summaries"
        private const val MAX_MEMORY_CACHE_SIZE = 100
        private const val MAX_DISK_CACHE_SIZE = 500
        private const val DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000L // 7 天
    }

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = false
    }

    // 内存缓存（LRU, thread-safe）
    private val memoryCache: MutableMap<String, FileSummary> = java.util.Collections.synchronizedMap(
        object : LinkedHashMap<String, FileSummary>(
            MAX_MEMORY_CACHE_SIZE,
            0.75f,
            true // access order
        ) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, FileSummary>?): Boolean {
                return size > MAX_MEMORY_CACHE_SIZE
            }
        }
    )

    // 缓存目录
    private val cacheDir: File by lazy {
        File(context.cacheDir, CACHE_DIR).apply {
            if (!exists()) mkdirs()
        }
    }

    init {
        // 启动时加载热门缓存到内存
        loadHotCache()
    }

    /**
     * 获取缓存的摘要
     *
     * @param contentHash 内容哈希
     * @return 缓存的摘要，如果不存在或已过期则返回 null
     */
    fun get(contentHash: String): FileSummary? {
        // 1. 先检查内存缓存
        memoryCache[contentHash]?.let { summary ->
            if (!isExpired(summary)) {
                return summary
            } else {
                memoryCache.remove(contentHash)
            }
        }

        // 2. 检查磁盘缓存
        return getFromDisk(contentHash)?.also { summary ->
            if (!isExpired(summary)) {
                // 加载到内存缓存
                memoryCache[contentHash] = summary
            } else {
                // 删除过期缓存
                deleteFromDisk(contentHash)
            }
        }?.takeIf { !isExpired(it) }
    }

    /**
     * 保存摘要到缓存
     *
     * @param contentHash 内容哈希
     * @param summary 摘要
     */
    fun put(contentHash: String, summary: FileSummary) {
        // 保存到内存缓存
        memoryCache[contentHash] = summary

        // 异步保存到磁盘
        saveToDisk(contentHash, summary)
    }

    /**
     * 删除缓存
     */
    fun remove(contentHash: String) {
        memoryCache.remove(contentHash)
        deleteFromDisk(contentHash)
    }

    /**
     * 清空所有缓存
     */
    fun clear() {
        memoryCache.clear()
        cacheDir.listFiles()?.forEach { it.delete() }
    }

    /**
     * 获取缓存统计信息
     */
    fun getStats(): CacheStats {
        val diskFiles = cacheDir.listFiles() ?: emptyArray()
        val totalDiskSize = diskFiles.sumOf { it.length() }

        return CacheStats(
            memoryCacheSize = memoryCache.size,
            diskCacheSize = diskFiles.size,
            totalDiskBytes = totalDiskSize
        )
    }

    /**
     * 清理过期缓存
     */
    suspend fun cleanupExpired(): Int = withContext(Dispatchers.IO) {
        var cleanedCount = 0

        // 清理内存缓存
        val expiredKeys: List<String>
        synchronized(memoryCache) {
            expiredKeys = memoryCache.entries
                .filter { isExpired(it.value) }
                .map { it.key }
        }
        expiredKeys.forEach { key ->
            memoryCache.remove(key)
            cleanedCount++
        }

        // 清理磁盘缓存
        cacheDir.listFiles()?.forEach { file ->
            try {
                val cached = json.decodeFromString<CachedSummary>(file.readText())
                if (isExpired(cached.toFileSummary())) {
                    file.delete()
                    cleanedCount++
                }
            } catch (e: Exception) {
                // 解析失败，删除损坏的缓存文件
                file.delete()
                cleanedCount++
            }
        }

        Log.d(TAG, "Cleaned up $cleanedCount expired cache entries")
        cleanedCount
    }

    /**
     * 检查摘要是否过期
     */
    private fun isExpired(summary: FileSummary): Boolean {
        return System.currentTimeMillis() - summary.generatedAt > DEFAULT_TTL_MS
    }

    /**
     * 从磁盘读取缓存
     */
    private fun getFromDisk(contentHash: String): FileSummary? {
        val file = File(cacheDir, "$contentHash.json")
        if (!file.exists()) return null

        return try {
            val cached = json.decodeFromString<CachedSummary>(file.readText())
            cached.toFileSummary()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read cache: $contentHash", e)
            file.delete()
            null
        }
    }

    /**
     * 保存到磁盘
     */
    private fun saveToDisk(contentHash: String, summary: FileSummary) {
        try {
            // 检查磁盘缓存大小
            val diskFiles = cacheDir.listFiles() ?: emptyArray()
            if (diskFiles.size >= MAX_DISK_CACHE_SIZE) {
                // 删除最老的缓存
                diskFiles.sortedBy { it.lastModified() }
                    .take(diskFiles.size - MAX_DISK_CACHE_SIZE + 1)
                    .forEach { it.delete() }
            }

            val file = File(cacheDir, "$contentHash.json")
            val cached = CachedSummary(summary)
            file.writeText(json.encodeToString(cached))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save cache: $contentHash", e)
        }
    }

    /**
     * 从磁盘删除缓存
     */
    private fun deleteFromDisk(contentHash: String) {
        try {
            File(cacheDir, "$contentHash.json").delete()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to delete cache: $contentHash", e)
        }
    }

    /**
     * 加载热门缓存到内存
     */
    private fun loadHotCache() {
        try {
            // 加载最近访问的缓存文件
            cacheDir.listFiles()
                ?.sortedByDescending { it.lastModified() }
                ?.take(20)
                ?.forEach { file ->
                    try {
                        val cached = json.decodeFromString<CachedSummary>(file.readText())
                        if (!isExpired(cached.toFileSummary())) {
                            val contentHash = file.nameWithoutExtension
                            memoryCache[contentHash] = cached.toFileSummary()
                        }
                    } catch (e: Exception) {
                        // 忽略解析错误
                    }
                }

            Log.d(TAG, "Loaded ${memoryCache.size} hot cache entries")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load hot cache", e)
        }
    }
}

/**
 * 缓存包装类（用于序列化）
 */
@Serializable
private data class CachedSummary(
    val fileName: String,
    val fileType: String,
    val contentHash: String,
    val summary: String,
    val contentLength: Int,
    val generatedAt: Long,
    val isCodeFile: Boolean
) {
    constructor(summary: FileSummary) : this(
        fileName = summary.fileName,
        fileType = summary.fileType,
        contentHash = summary.contentHash,
        summary = summary.summary,
        contentLength = summary.contentLength,
        generatedAt = summary.generatedAt,
        isCodeFile = summary.isCodeFile
    )

    fun toFileSummary(): FileSummary = FileSummary(
            fileName = fileName,
            fileType = fileType,
            contentHash = contentHash,
            summary = summary,
            contentLength = contentLength,
            generatedAt = generatedAt,
            isCodeFile = isCodeFile
        )
}

/**
 * 缓存统计信息
 */
data class CacheStats(
    val memoryCacheSize: Int,
    val diskCacheSize: Int,
    val totalDiskBytes: Long
)
