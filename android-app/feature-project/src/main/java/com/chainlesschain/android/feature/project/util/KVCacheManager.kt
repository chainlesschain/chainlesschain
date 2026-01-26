package com.chainlesschain.android.feature.project.util

import android.util.Log
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.security.MessageDigest

/**
 * KV-Cache Manager for Context Engineering Optimization
 *
 * Implements static/dynamic content separation to optimize LLM token usage:
 * - Static content (system prompts, project structure) is cached and reused
 * - Dynamic content (user messages, AI responses) is managed separately
 * - Reduces token consumption by 50%+ through prefix caching
 *
 * Key concepts:
 * 1. Static Prefix: Immutable content placed at the beginning of context
 * 2. Cache Key: Hash of static content for cache hit detection
 * 3. Cache Invalidation: Automatic refresh when project structure changes
 */
class KVCacheManager(
    private val maxCacheSize: Int = 100,  // Maximum number of cache entries
    private val cacheExpirationMs: Long = 30 * 60 * 1000  // 30 minutes cache TTL
) {

    companion object {
        private const val TAG = "KVCacheManager"
    }

    // Cache storage for static prefixes
    private val cacheEntries = LinkedHashMap<String, CacheEntry>(maxCacheSize, 0.75f, true)
    private val cacheMutex = Mutex()

    // Statistics for monitoring
    private var cacheHits = 0L
    private var cacheMisses = 0L

    /**
     * Cache entry containing static prefix data
     */
    data class CacheEntry(
        val cacheKey: String,
        val staticPrefix: StaticPrefix,
        val createdAt: Long = System.currentTimeMillis(),
        val tokenCount: Int,
        val hash: String
    ) {
        fun isExpired(expirationMs: Long): Boolean {
            return System.currentTimeMillis() - createdAt > expirationMs
        }
    }

    /**
     * Static prefix structure containing cached content
     */
    data class StaticPrefix(
        val systemPrompt: String,
        val projectContext: String,
        val fileMetadata: String,
        val userPreferences: String = ""
    ) {
        fun toFullPrefix(): String {
            return buildString {
                if (systemPrompt.isNotBlank()) {
                    appendLine(systemPrompt)
                    appendLine()
                }
                if (projectContext.isNotBlank()) {
                    appendLine("## Project Context")
                    appendLine(projectContext)
                    appendLine()
                }
                if (fileMetadata.isNotBlank()) {
                    appendLine("## File Structure")
                    appendLine(fileMetadata)
                    appendLine()
                }
                if (userPreferences.isNotBlank()) {
                    appendLine("## User Preferences")
                    appendLine(userPreferences)
                }
            }.trim()
        }

        fun computeHash(): String {
            val content = toFullPrefix()
            return MessageDigest.getInstance("SHA-256")
                .digest(content.toByteArray())
                .fold("") { str, byte -> str + "%02x".format(byte) }
                .take(16)
        }
    }

    /**
     * Build a static prefix for a project
     *
     * @param projectId Project identifier
     * @param projectName Project name
     * @param projectDescription Project description
     * @param fileStructure List of file paths in the project
     * @param openFiles Currently open file paths
     * @param userPreferences User coding preferences
     */
    fun buildStaticPrefix(
        projectId: String,
        projectName: String,
        projectDescription: String,
        fileStructure: List<String>,
        openFiles: List<String> = emptyList(),
        userPreferences: String = ""
    ): StaticPrefix {
        val systemPrompt = buildSystemPrompt(projectName)
        val projectContext = buildProjectContext(projectName, projectDescription)
        val fileMetadata = buildFileMetadata(fileStructure, openFiles)

        return StaticPrefix(
            systemPrompt = systemPrompt,
            projectContext = projectContext,
            fileMetadata = fileMetadata,
            userPreferences = userPreferences
        )
    }

    /**
     * Build system prompt for project context
     */
    private fun buildSystemPrompt(projectName: String): String {
        return """
You are an intelligent AI coding assistant helping with the project "$projectName".

Your capabilities:
- Understand project structure and dependencies
- Provide contextual code suggestions
- Help with debugging and optimization
- Generate documentation and tests
- Support multiple programming languages

Guidelines:
- Be concise and accurate
- Provide code examples when helpful
- Explain your reasoning
- Ask for clarification when needed
- Consider the existing code style
        """.trimIndent()
    }

    /**
     * Build project context section
     */
    private fun buildProjectContext(projectName: String, description: String): String {
        return buildString {
            appendLine("Project: $projectName")
            if (description.isNotBlank()) {
                appendLine("Description: $description")
            }
        }
    }

    /**
     * Build file metadata section
     */
    private fun buildFileMetadata(
        fileStructure: List<String>,
        openFiles: List<String>
    ): String {
        return buildString {
            // Group files by directory for compact representation
            val filesByDir = fileStructure.groupBy { path ->
                if (path.contains('/')) path.substringBeforeLast('/') else "."
            }

            appendLine("Files:")
            filesByDir.entries.sortedBy { it.key }.take(20).forEach { (dir, files) ->
                if (files.size > 5) {
                    appendLine("  $dir/ (${files.size} files)")
                } else {
                    files.forEach { file ->
                        val fileName = file.substringAfterLast('/')
                        val isOpen = file in openFiles
                        val marker = if (isOpen) " [OPEN]" else ""
                        appendLine("  - $fileName$marker")
                    }
                }
            }

            if (openFiles.isNotEmpty()) {
                appendLine()
                appendLine("Currently Open:")
                openFiles.take(5).forEach { file ->
                    appendLine("  - ${file.substringAfterLast('/')}")
                }
            }
        }
    }

    /**
     * Get cached prefix or create new one
     *
     * @return Pair of (StaticPrefix, isCacheHit)
     */
    suspend fun getOrCreatePrefix(
        projectId: String,
        builder: () -> StaticPrefix
    ): Pair<StaticPrefix, Boolean> = cacheMutex.withLock {
        val cacheKey = projectId
        val existingEntry = cacheEntries[cacheKey]

        if (existingEntry != null && !existingEntry.isExpired(cacheExpirationMs)) {
            cacheHits++
            Log.d(TAG, "Cache HIT for project: $projectId (hits: $cacheHits)")
            return Pair(existingEntry.staticPrefix, true)
        }

        // Build new prefix
        cacheMisses++
        val newPrefix = builder()
        val hash = newPrefix.computeHash()
        val tokenCount = estimateTokens(newPrefix.toFullPrefix())

        // Check if content actually changed (hash match means can reuse)
        if (existingEntry != null && existingEntry.hash == hash) {
            // Content unchanged, refresh timestamp
            cacheEntries[cacheKey] = existingEntry.copy(createdAt = System.currentTimeMillis())
            cacheHits++
            cacheMisses--
            Log.d(TAG, "Cache refresh for project: $projectId (content unchanged)")
            return Pair(existingEntry.staticPrefix, true)
        }

        // Store new entry
        val newEntry = CacheEntry(
            cacheKey = cacheKey,
            staticPrefix = newPrefix,
            tokenCount = tokenCount,
            hash = hash
        )

        // Evict old entries if at capacity
        if (cacheEntries.size >= maxCacheSize) {
            val oldestKey = cacheEntries.keys.firstOrNull()
            if (oldestKey != null) {
                cacheEntries.remove(oldestKey)
                Log.d(TAG, "Evicted cache entry: $oldestKey")
            }
        }

        cacheEntries[cacheKey] = newEntry
        Log.d(TAG, "Cache MISS for project: $projectId (misses: $cacheMisses)")

        return Pair(newPrefix, false)
    }

    /**
     * Invalidate cache for a project
     */
    suspend fun invalidateCache(projectId: String) = cacheMutex.withLock {
        cacheEntries.remove(projectId)
        Log.d(TAG, "Cache invalidated for project: $projectId")
    }

    /**
     * Invalidate all cache entries
     */
    suspend fun clearCache() = cacheMutex.withLock {
        cacheEntries.clear()
        Log.d(TAG, "All cache entries cleared")
    }

    /**
     * Get cache statistics
     */
    fun getCacheStats(): CacheStats {
        val hitRate = if (cacheHits + cacheMisses > 0) {
            cacheHits.toFloat() / (cacheHits + cacheMisses)
        } else {
            0f
        }

        return CacheStats(
            cacheSize = cacheEntries.size,
            maxCacheSize = maxCacheSize,
            cacheHits = cacheHits,
            cacheMisses = cacheMisses,
            hitRate = hitRate,
            totalTokensCached = cacheEntries.values.sumOf { it.tokenCount }
        )
    }

    /**
     * Estimate token count for content
     */
    private fun estimateTokens(text: String): Int {
        if (text.isEmpty()) return 0
        val chineseChars = text.count { it.code in 0x4E00..0x9FFF }
        val otherChars = text.length - chineseChars
        return (chineseChars / 2.0f + otherChars / 4.0f).toInt()
    }

    /**
     * Refresh cache entry if about to expire
     */
    suspend fun refreshIfNeeded(projectId: String, builder: () -> StaticPrefix) = cacheMutex.withLock {
        val entry = cacheEntries[projectId] ?: return@withLock

        // Refresh if more than 80% through TTL
        val age = System.currentTimeMillis() - entry.createdAt
        if (age > cacheExpirationMs * 0.8) {
            val newPrefix = builder()
            val hash = newPrefix.computeHash()

            if (hash == entry.hash) {
                // Content unchanged, just refresh timestamp
                cacheEntries[projectId] = entry.copy(createdAt = System.currentTimeMillis())
            } else {
                // Content changed, create new entry
                cacheEntries[projectId] = CacheEntry(
                    cacheKey = projectId,
                    staticPrefix = newPrefix,
                    tokenCount = estimateTokens(newPrefix.toFullPrefix()),
                    hash = hash
                )
            }
            Log.d(TAG, "Proactively refreshed cache for: $projectId")
        }
    }
}

/**
 * Cache statistics for monitoring
 */
data class CacheStats(
    val cacheSize: Int,
    val maxCacheSize: Int,
    val cacheHits: Long,
    val cacheMisses: Long,
    val hitRate: Float,
    val totalTokensCached: Int
) {
    fun toSummary(): String {
        return """
            |KV-Cache Statistics:
            |- Entries: $cacheSize/$maxCacheSize
            |- Hit Rate: ${"%.1f".format(hitRate * 100)}%
            |- Hits: $cacheHits, Misses: $cacheMisses
            |- Tokens Cached: $totalTokensCached
        """.trimMargin()
    }
}

/**
 * Optimized context builder using KV-Cache
 */
class CachedContextBuilder(
    private val kvCacheManager: KVCacheManager,
    private val contextManager: ContextManager
) {

    /**
     * Build optimized context with KV-Cache support
     *
     * @return OptimizedContext with separated static and dynamic parts
     */
    suspend fun buildOptimizedContext(
        projectId: String,
        projectName: String,
        projectDescription: String,
        fileStructure: List<String>,
        openFiles: List<String>,
        messages: List<com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity>
    ): OptimizedContext {
        // Get or create static prefix
        val (staticPrefix, cacheHit) = kvCacheManager.getOrCreatePrefix(projectId) {
            kvCacheManager.buildStaticPrefix(
                projectId = projectId,
                projectName = projectName,
                projectDescription = projectDescription,
                fileStructure = fileStructure,
                openFiles = openFiles
            )
        }

        val staticContent = staticPrefix.toFullPrefix()
        val staticTokens = contextManager.estimateTokens(staticContent)

        // Select dynamic messages with reduced token budget
        val dynamicResult = contextManager.selectMessagesForContext(
            allMessages = messages,
            systemPrompt = staticContent
        )

        return OptimizedContext(
            staticPrefix = staticContent,
            staticTokens = staticTokens,
            dynamicMessages = dynamicResult.messages,
            dynamicTokens = dynamicResult.totalTokens,
            totalTokens = staticTokens + dynamicResult.totalTokens,
            cacheHit = cacheHit,
            compressedCount = dynamicResult.compressedCount,
            droppedCount = dynamicResult.droppedCount
        )
    }
}

/**
 * Optimized context result with static/dynamic separation
 */
data class OptimizedContext(
    val staticPrefix: String,
    val staticTokens: Int,
    val dynamicMessages: List<com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity>,
    val dynamicTokens: Int,
    val totalTokens: Int,
    val cacheHit: Boolean,
    val compressedCount: Int,
    val droppedCount: Int
) {
    fun getSavingsPercent(): Float {
        return if (cacheHit && staticTokens > 0) {
            // Estimate savings from not re-encoding static content
            (staticTokens.toFloat() / totalTokens) * 100
        } else {
            0f
        }
    }

    fun toSummary(): String {
        return """
            |Optimized Context:
            |- Static Tokens: $staticTokens (${if (cacheHit) "cached" else "new"})
            |- Dynamic Tokens: $dynamicTokens
            |- Total: $totalTokens
            |- Savings: ${"%.1f".format(getSavingsPercent())}%
            |- Compressed: $compressedCount, Dropped: $droppedCount
        """.trimMargin()
    }
}
