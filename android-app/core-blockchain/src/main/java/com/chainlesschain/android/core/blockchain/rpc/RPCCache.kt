package com.chainlesschain.android.core.blockchain.rpc

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap

/**
 * RPC response cache with TTL support
 */
class RPCCache(
    private val defaultTtlMs: Long = 60_000L,
    private val maxSize: Int = 1000
) {
    private val cache = ConcurrentHashMap<String, CacheEntry>()
    private val mutex = Mutex()

    /**
     * Cache entry with expiration
     */
    private data class CacheEntry(
        val value: Any,
        val expiresAt: Long
    ) {
        val isExpired: Boolean
            get() = System.currentTimeMillis() > expiresAt
    }

    /**
     * Get cached value
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun <T> get(key: String): T? {
        val entry = cache[key] ?: return null
        if (entry.isExpired) {
            cache.remove(key)
            return null
        }
        return entry.value as? T
    }

    /**
     * Put value in cache
     */
    suspend fun <T : Any> put(key: String, value: T, ttlMs: Long = defaultTtlMs) {
        mutex.withLock {
            // Evict oldest entries if cache is full
            if (cache.size >= maxSize) {
                evictOldest()
            }

            cache[key] = CacheEntry(
                value = value,
                expiresAt = System.currentTimeMillis() + ttlMs
            )
        }
    }

    /**
     * Get or compute value
     */
    suspend fun <T : Any> getOrPut(
        key: String,
        ttlMs: Long = defaultTtlMs,
        compute: suspend () -> T
    ): T {
        val cached = get<T>(key)
        if (cached != null) return cached

        val value = compute()
        put(key, value, ttlMs)
        return value
    }

    /**
     * Invalidate specific key
     */
    fun invalidate(key: String) {
        cache.remove(key)
    }

    /**
     * Invalidate keys matching prefix
     */
    fun invalidatePrefix(prefix: String) {
        cache.keys.filter { it.startsWith(prefix) }.forEach {
            cache.remove(it)
        }
    }

    /**
     * Clear all cache
     */
    fun clear() {
        cache.clear()
    }

    /**
     * Get cache size
     */
    fun size(): Int = cache.size

    /**
     * Evict expired entries
     */
    suspend fun evictExpired() {
        mutex.withLock {
            val now = System.currentTimeMillis()
            cache.entries.removeIf { it.value.expiresAt < now }
        }
    }

    /**
     * Evict oldest entries (25% of cache)
     */
    private fun evictOldest() {
        val sortedEntries = cache.entries.sortedBy { it.value.expiresAt }
        val toRemove = sortedEntries.take(maxSize / 4)
        toRemove.forEach { cache.remove(it.key) }
    }

    /**
     * Generate cache key for RPC request
     */
    companion object {
        fun generateKey(
            chainId: Int,
            method: String,
            params: List<Any>
        ): String {
            return "$chainId:$method:${params.hashCode()}"
        }

        /**
         * TTL configurations for different methods
         */
        object TTL {
            const val BLOCK_NUMBER = 12_000L        // 12 seconds (block time)
            const val GAS_PRICE = 10_000L           // 10 seconds
            const val BALANCE = 30_000L             // 30 seconds
            const val TRANSACTION_RECEIPT = 0L      // No cache (confirmation changes)
            const val CHAIN_ID = 3600_000L          // 1 hour (never changes)
            const val CODE = 3600_000L              // 1 hour (rarely changes)
            const val LOGS = 60_000L                // 1 minute
        }

        /**
         * Methods that should not be cached
         */
        val NON_CACHEABLE_METHODS = setOf(
            RPCRequest.Companion.Methods.ETH_SEND_RAW_TRANSACTION,
            RPCRequest.Companion.Methods.ETH_GET_TRANSACTION_RECEIPT,
            RPCRequest.Companion.Methods.ETH_SUBSCRIBE,
            RPCRequest.Companion.Methods.ETH_UNSUBSCRIBE
        )
    }
}
