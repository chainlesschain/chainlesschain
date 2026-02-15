package com.chainlesschain.android.feature.performance.data.cache

import com.chainlesschain.android.feature.performance.data.repository.PerformanceRepository
import com.chainlesschain.android.feature.performance.domain.model.CacheStatistics
import kotlinx.coroutines.flow.Flow
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manager for application caches
 */
@Singleton
class CacheManager @Inject constructor(
    private val repository: PerformanceRepository
) {
    private val caches = ConcurrentHashMap<String, LRUCache<Any>>()

    /**
     * Create or get a cache by name
     */
    @Suppress("UNCHECKED_CAST")
    fun <T : Any> getOrCreateCache(name: String, maxSize: Int = 100): Cache<T> {
        return caches.getOrPut(name) {
            LRUCache(name, maxSize, ::onCacheEvent)
        } as Cache<T>
    }

    /**
     * Get statistics for all caches
     */
    fun getAllCacheStats(): Flow<List<CacheStatistics>> = repository.getAllCaches()

    /**
     * Get statistics for a specific cache
     */
    fun getCacheStats(name: String): CacheStatistics? = repository.getCacheStats(name)

    /**
     * Clear a specific cache
     */
    fun clearCache(name: String) {
        caches[name]?.clear()
    }

    /**
     * Clear all caches
     */
    fun clearAllCaches() {
        caches.values.forEach { it.clear() }
    }

    private suspend fun onCacheEvent(stats: CacheStatistics) {
        repository.updateCache(stats)
    }

    /**
     * Cache interface
     */
    interface Cache<T> {
        fun get(key: String): T?
        fun put(key: String, value: T)
        fun remove(key: String): T?
        fun clear()
        fun size(): Int
        fun stats(): CacheStatistics
    }

    /**
     * LRU Cache implementation
     */
    class LRUCache<V>(
        private val name: String,
        private val maxSize: Int,
        private val onEvent: (suspend (CacheStatistics) -> Unit)? = null
    ) : Cache<V> {

        private val cache = LinkedHashMap<String, V>(maxSize, 0.75f, true)
        private var hitCount = 0L
        private var missCount = 0L
        private var evictionCount = 0L

        @Synchronized
        override fun get(key: String): V? {
            val value = cache[key]
            if (value != null) {
                hitCount++
            } else {
                missCount++
            }
            return value
        }

        @Synchronized
        override fun put(key: String, value: V) {
            cache[key] = value

            while (cache.size > maxSize) {
                val eldest = cache.entries.iterator().next()
                cache.remove(eldest.key)
                evictionCount++
            }
        }

        @Synchronized
        override fun remove(key: String): V? {
            return cache.remove(key)
        }

        @Synchronized
        override fun clear() {
            cache.clear()
            hitCount = 0
            missCount = 0
            evictionCount = 0
        }

        @Synchronized
        override fun size(): Int = cache.size

        @Synchronized
        override fun stats(): CacheStatistics = CacheStatistics(
            name = name,
            size = cache.size,
            maxSize = maxSize,
            hitCount = hitCount,
            missCount = missCount,
            evictionCount = evictionCount
        )
    }
}
