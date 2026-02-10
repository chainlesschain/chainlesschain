package com.chainlesschain.android.core.common.memory

import android.graphics.Bitmap
import android.util.LruCache

/**
 * Image Memory Cache
 *
 * LRU cache for bitmap images optimized for memory usage.
 * Calculates memory cost based on bitmap byte count.
 */
class ImageMemoryCache(
    maxSizeBytes: Int = calculateDefaultMaxSize()
) {
    private val cache: LruCache<String, Bitmap>

    // Statistics
    private var hitCount = 0
    private var missCount = 0
    private var evictionCount = 0

    init {
        cache = object : LruCache<String, Bitmap>(maxSizeBytes) {
            override fun sizeOf(key: String, bitmap: Bitmap): Int {
                return bitmap.allocationByteCount
            }

            override fun entryRemoved(
                evicted: Boolean,
                key: String,
                oldValue: Bitmap,
                newValue: Bitmap?
            ) {
                if (evicted) {
                    evictionCount++
                }
            }
        }
    }

    /**
     * Get bitmap from cache
     *
     * @param key Cache key
     * @return Cached bitmap or null
     */
    fun get(key: String): Bitmap? {
        val bitmap = cache.get(key)
        if (bitmap != null) {
            hitCount++
        } else {
            missCount++
        }
        return bitmap
    }

    /**
     * Put bitmap into cache
     *
     * @param key Cache key
     * @param bitmap Bitmap to cache
     */
    fun put(key: String, bitmap: Bitmap) {
        cache.put(key, bitmap)
    }

    /**
     * Remove bitmap from cache
     *
     * @param key Cache key
     * @return Removed bitmap or null
     */
    fun remove(key: String): Bitmap? {
        return cache.remove(key)
    }

    /**
     * Clear all cached bitmaps
     */
    fun clear() {
        evictionCount += cache.size()
        cache.evictAll()
    }

    /**
     * Trim cache to a specific size
     *
     * @param maxSize Target max size in bytes
     */
    fun trimToSize(maxSize: Int) {
        cache.trimToSize(maxSize)
    }

    /**
     * Check if key exists in cache
     */
    fun contains(key: String): Boolean {
        return cache.get(key) != null
    }

    /**
     * Get current cache size in bytes
     */
    val size: Int
        get() = cache.size()

    /**
     * Get max cache size in bytes
     */
    val maxSize: Int
        get() = cache.maxSize()

    /**
     * Get entry count
     */
    val entryCount: Int
        get() = cache.snapshot().size

    /**
     * Get cache statistics
     */
    val stats: ImageCacheStats
        get() = ImageCacheStats(
            sizeBytes = size,
            maxSizeBytes = maxSize,
            entryCount = entryCount,
            hits = hitCount,
            misses = missCount,
            evictions = evictionCount
        )

    /**
     * Reset statistics
     */
    fun resetStats() {
        hitCount = 0
        missCount = 0
        evictionCount = 0
    }

    companion object {
        /**
         * Calculate default max cache size based on available memory
         * Uses 1/8 of available heap memory
         */
        fun calculateDefaultMaxSize(): Int {
            val runtime = Runtime.getRuntime()
            val maxMemory = runtime.maxMemory().toInt()
            return maxMemory / 8
        }
    }
}

/**
 * Image cache statistics
 */
data class ImageCacheStats(
    val sizeBytes: Int,
    val maxSizeBytes: Int,
    val entryCount: Int,
    val hits: Int,
    val misses: Int,
    val evictions: Int
) {
    val sizeMB: Float
        get() = sizeBytes / (1024f * 1024f)

    val maxSizeMB: Float
        get() = maxSizeBytes / (1024f * 1024f)

    val hitRate: Float
        get() {
            val total = hits + misses
            return if (total > 0) hits.toFloat() / total else 0f
        }

    val utilizationRate: Float
        get() = if (maxSizeBytes > 0) sizeBytes.toFloat() / maxSizeBytes else 0f
}
