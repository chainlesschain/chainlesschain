package com.chainlesschain.android.feature.ai.context

import java.util.concurrent.ConcurrentHashMap

/**
 * LRU Context Cache
 *
 * Thread-safe LRU cache implementation for conversation contexts.
 * Uses LinkedHashMap-style access ordering with ConcurrentHashMap for thread safety.
 */
class LRUContextCache(
    private val maxSize: Int = ContextConfig.DEFAULT_MAX_CONTEXTS
) {
    private val cache = ConcurrentHashMap<String, ConversationContext>()
    private val accessOrder = mutableListOf<String>()
    private val lock = Any()

    /**
     * Get a context from cache, updating access order
     */
    fun get(conversationId: String): ConversationContext? {
        val context = cache[conversationId]
        if (context != null) {
            synchronized(lock) {
                accessOrder.remove(conversationId)
                accessOrder.add(conversationId)
            }
            context.touch()
        }
        return context
    }

    /**
     * Put a context into cache, evicting oldest if necessary
     */
    fun put(conversationId: String, context: ConversationContext) {
        synchronized(lock) {
            // Remove existing entry from access order if present
            if (cache.containsKey(conversationId)) {
                accessOrder.remove(conversationId)
            }

            // Evict oldest entries if cache is full
            while (cache.size >= maxSize && accessOrder.isNotEmpty()) {
                val oldestKey = accessOrder.removeAt(0)
                cache.remove(oldestKey)
            }

            // Add new entry
            cache[conversationId] = context
            accessOrder.add(conversationId)
        }
    }

    /**
     * Remove a context from cache
     */
    fun remove(conversationId: String): ConversationContext? {
        synchronized(lock) {
            accessOrder.remove(conversationId)
            return cache.remove(conversationId)
        }
    }

    /**
     * Check if cache contains a context
     */
    fun contains(conversationId: String): Boolean = cache.containsKey(conversationId)

    /**
     * Get current cache size
     */
    val size: Int
        get() = cache.size

    /**
     * Clear all cached contexts
     */
    fun clear() {
        synchronized(lock) {
            cache.clear()
            accessOrder.clear()
        }
    }

    /**
     * Get all cached context IDs in access order (oldest first)
     */
    fun getAccessOrder(): List<String> {
        synchronized(lock) {
            return accessOrder.toList()
        }
    }

    /**
     * Get all cached contexts
     */
    fun getAll(): List<ConversationContext> = cache.values.toList()

    /**
     * Evict oldest entries until cache size is at or below target
     */
    fun evictTo(targetSize: Int) {
        synchronized(lock) {
            while (cache.size > targetSize && accessOrder.isNotEmpty()) {
                val oldestKey = accessOrder.removeAt(0)
                cache.remove(oldestKey)
            }
        }
    }

    /**
     * Get cache statistics
     */
    fun getStats(): CacheStats {
        val contexts = cache.values.toList()
        return CacheStats(
            size = contexts.size,
            maxSize = maxSize,
            totalMessages = contexts.sumOf { it.messageCount },
            totalTokens = contexts.sumOf { it.estimatedTokens },
            compressedCount = contexts.count { it.isCompressed }
        )
    }
}

/**
 * Cache statistics
 */
data class CacheStats(
    val size: Int,
    val maxSize: Int,
    val totalMessages: Int,
    val totalTokens: Int,
    val compressedCount: Int
) {
    val usagePercent: Float
        get() = if (maxSize > 0) size.toFloat() / maxSize else 0f
}
