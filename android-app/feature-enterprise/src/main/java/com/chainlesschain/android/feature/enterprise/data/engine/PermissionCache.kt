package com.chainlesschain.android.feature.enterprise.data.engine

import com.chainlesschain.android.feature.enterprise.domain.model.Permission
import com.chainlesschain.android.feature.enterprise.domain.model.PermissionCheckResult
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Permission cache with 1-minute TTL
 * Based on iOS PermissionCache implementation
 */
@Singleton
class PermissionCache @Inject constructor() {

    companion object {
        private const val DEFAULT_TTL_MS = 60_000L // 1 minute
        private const val MAX_CACHE_SIZE = 10_000
    }

    private val cache = ConcurrentHashMap<String, CacheEntry>()
    private val mutex = Mutex()

    /**
     * Cache entry with expiration
     */
    private data class CacheEntry(
        val result: PermissionCheckResult,
        val expiresAt: Long
    ) {
        val isExpired: Boolean
            get() = System.currentTimeMillis() > expiresAt
    }

    /**
     * Get cached permission result
     */
    suspend fun get(key: String): PermissionCheckResult? {
        val entry = cache[key] ?: return null

        if (entry.isExpired) {
            cache.remove(key)
            return null
        }

        return entry.result
    }

    /**
     * Put permission result in cache
     */
    suspend fun put(
        key: String,
        result: PermissionCheckResult,
        ttlMs: Long = DEFAULT_TTL_MS
    ) {
        mutex.withLock {
            // Evict if cache is full
            if (cache.size >= MAX_CACHE_SIZE) {
                evictExpired()
                if (cache.size >= MAX_CACHE_SIZE) {
                    evictOldest()
                }
            }

            cache[key] = CacheEntry(
                result = result,
                expiresAt = System.currentTimeMillis() + ttlMs
            )
        }
    }

    /**
     * Generate cache key
     */
    fun generateKey(
        userId: String,
        permission: Permission,
        resourceType: String?,
        resourceId: String?
    ): String {
        return "$userId:${permission.name}:${resourceType ?: ""}:${resourceId ?: ""}"
    }

    /**
     * Invalidate all cache entries for a user
     */
    suspend fun invalidateUser(userId: String) {
        mutex.withLock {
            cache.keys.filter { it.startsWith("$userId:") }.forEach {
                cache.remove(it)
            }
        }
    }

    /**
     * Invalidate cache entries for a specific permission
     */
    suspend fun invalidatePermission(permission: Permission) {
        mutex.withLock {
            cache.keys.filter { it.contains(":${permission.name}:") }.forEach {
                cache.remove(it)
            }
        }
    }

    /**
     * Invalidate cache entries for a specific resource
     */
    suspend fun invalidateResource(resourceType: String, resourceId: String) {
        mutex.withLock {
            cache.keys.filter { it.endsWith(":$resourceType:$resourceId") }.forEach {
                cache.remove(it)
            }
        }
    }

    /**
     * Clear all cache
     */
    suspend fun clear() {
        mutex.withLock {
            cache.clear()
        }
    }

    /**
     * Get cache statistics
     */
    fun stats(): CacheStats {
        val now = System.currentTimeMillis()
        val entries = cache.values.toList()

        return CacheStats(
            totalEntries = entries.size,
            expiredEntries = entries.count { it.isExpired },
            hitRate = 0.0, // Would need hit tracking
            avgTtlRemainingMs = entries
                .filter { !it.isExpired }
                .map { it.expiresAt - now }
                .average()
                .takeIf { !it.isNaN() } ?: 0.0
        )
    }

    // ==================== Private Helpers ====================

    private fun evictExpired() {
        val expiredKeys = cache.entries
            .filter { it.value.isExpired }
            .map { it.key }

        expiredKeys.forEach { cache.remove(it) }
    }

    private fun evictOldest() {
        // Remove 25% of oldest entries
        val toRemove = cache.entries
            .sortedBy { it.value.expiresAt }
            .take(MAX_CACHE_SIZE / 4)
            .map { it.key }

        toRemove.forEach { cache.remove(it) }
    }
}

/**
 * Cache statistics
 */
data class CacheStats(
    val totalEntries: Int,
    val expiredEntries: Int,
    val hitRate: Double,
    val avgTtlRemainingMs: Double
)
