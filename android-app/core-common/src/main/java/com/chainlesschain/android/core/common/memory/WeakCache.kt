package com.chainlesschain.android.core.common.memory

import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Weak Cache
 *
 * Thread-safe cache implementation using weak references.
 * Objects can be garbage collected when memory is needed.
 *
 * @param K Key type
 * @param V Value type
 */
class WeakCache<K : Any, V : Any>(
    private val maxSize: Int = 100
) {
    private val cache = ConcurrentHashMap<K, WeakReference<V>>()

    // Statistics
    private val hitCount = AtomicInteger(0)
    private val missCount = AtomicInteger(0)
    private val evictionCount = AtomicInteger(0)

    /**
     * Get value from cache
     *
     * @param key Cache key
     * @return Value if present and not GC'd, null otherwise
     */
    fun get(key: K): V? {
        val ref = cache[key]
        val value = ref?.get()

        if (value != null) {
            hitCount.incrementAndGet()
        } else {
            missCount.incrementAndGet()
            // Clean up dead reference
            if (ref != null) {
                cache.remove(key)
            }
        }

        return value
    }

    /**
     * Put value into cache
     *
     * @param key Cache key
     * @param value Value to cache
     */
    fun put(key: K, value: V) {
        // Evict if at capacity
        if (cache.size >= maxSize) {
            evictStale()
        }

        cache[key] = WeakReference(value)
    }

    /**
     * Get or compute value if not present
     *
     * @param key Cache key
     * @param compute Function to compute value if not cached
     * @return Cached or computed value
     */
    fun getOrPut(key: K, compute: () -> V): V {
        val cached = get(key)
        if (cached != null) return cached

        val computed = compute()
        put(key, computed)
        return computed
    }

    /**
     * Remove value from cache
     *
     * @param key Cache key
     * @return Removed value if present
     */
    fun remove(key: K): V? {
        val ref = cache.remove(key)
        return ref?.get()
    }

    /**
     * Check if key exists in cache (and value not GC'd)
     */
    fun contains(key: K): Boolean {
        val ref = cache[key]
        return ref?.get() != null
    }

    /**
     * Evict stale (GC'd) entries
     *
     * @return Number of entries evicted
     */
    fun evictStale(): Int {
        var count = 0
        val iterator = cache.entries.iterator()

        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (entry.value.get() == null) {
                iterator.remove()
                count++
            }
        }

        evictionCount.addAndGet(count)
        return count
    }

    /**
     * Clear all cached entries
     */
    fun clear() {
        val count = cache.size
        cache.clear()
        evictionCount.addAndGet(count)
    }

    /**
     * Get current cache size (including potentially stale entries)
     */
    val size: Int
        get() = cache.size

    /**
     * Get count of live entries
     */
    val liveCount: Int
        get() = cache.values.count { it.get() != null }

    /**
     * Get cache statistics
     */
    val stats: CacheStats
        get() = CacheStats(
            size = size,
            liveCount = liveCount,
            maxSize = maxSize,
            hits = hitCount.get(),
            misses = missCount.get(),
            evictions = evictionCount.get()
        )

    /**
     * Reset statistics
     */
    fun resetStats() {
        hitCount.set(0)
        missCount.set(0)
        evictionCount.set(0)
    }
}

/**
 * Cache statistics
 */
data class CacheStats(
    val size: Int,
    val liveCount: Int,
    val maxSize: Int,
    val hits: Int,
    val misses: Int,
    val evictions: Int
) {
    val hitRate: Float
        get() {
            val total = hits + misses
            return if (total > 0) hits.toFloat() / total else 0f
        }

    val utilizationRate: Float
        get() = if (maxSize > 0) liveCount.toFloat() / maxSize else 0f

    val staleRate: Float
        get() = if (size > 0) (size - liveCount).toFloat() / size else 0f
}
