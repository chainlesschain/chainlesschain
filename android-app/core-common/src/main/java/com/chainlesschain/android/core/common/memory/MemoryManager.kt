package com.chainlesschain.android.core.common.memory

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.os.Debug
import timber.log.Timber
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Memory Manager
 *
 * Centralized memory management system for the application.
 * Provides object pools, caches, and memory pressure monitoring.
 *
 * Features:
 * - Generic ObjectPool for expensive object reuse
 * - WeakCache for GC-friendly caching
 * - ComponentCallbacks2 memory pressure monitoring
 * - Three-level cleanup (normal/warning/critical)
 * - Memory statistics and reporting
 *
 * Aligns with iOS implementation patterns.
 */
@Singleton
class MemoryManager @Inject constructor(
    private val application: Application
) : ComponentCallbacks2 {

    companion object {

    }

    // Memory pressure state
    private val _pressureLevel = MutableStateFlow(MemoryPressureLevel.NORMAL)
    val pressureLevel: StateFlow<MemoryPressureLevel> = _pressureLevel.asStateFlow()

    // Statistics
    private val _statistics = MutableStateFlow(MemoryStatistics())
    val statistics: StateFlow<MemoryStatistics> = _statistics.asStateFlow()

    // Registered cleanup handlers
    private val cleanupHandlers = mutableListOf<MemoryCleanupHandler>()

    // Built-in caches
    private val genericWeakCache = WeakCache<String, Any>(maxSize = 200)
    private val imageCache = ImageMemoryCache()

    // Object pools
    private val objectPools = mutableMapOf<Class<*>, ObjectPool<*>>()

    init {
        // Register for memory callbacks
        application.registerComponentCallbacks(this)
        Timber.d("MemoryManager initialized")
    }

    // ===== Object Pool Management =====

    /**
     * Get or create an object pool for a specific type
     *
     * @param clazz Class type
     * @param maxSize Maximum pool size
     * @param factory Factory function
     * @param reset Reset function
     * @return Object pool
     */
    @Suppress("UNCHECKED_CAST")
    fun <T : Any> getPool(
        clazz: Class<T>,
        maxSize: Int = 20,
        factory: () -> T,
        reset: ((T) -> Unit)? = null
    ): ObjectPool<T> {
        return objectPools.getOrPut(clazz) {
            ObjectPool(maxSize, factory, reset)
        } as ObjectPool<T>
    }

    /**
     * Acquire object from pool
     */
    fun <T : Any> acquire(clazz: Class<T>, factory: () -> T): T {
        @Suppress("UNCHECKED_CAST")
        val pool = objectPools[clazz] as? ObjectPool<T>
        return pool?.acquire() ?: factory()
    }

    /**
     * Release object to pool
     */
    fun <T : Any> release(clazz: Class<T>, obj: T): Boolean {
        @Suppress("UNCHECKED_CAST")
        val pool = objectPools[clazz] as? ObjectPool<T>
        return pool?.release(obj) ?: false
    }

    // ===== Weak Cache Management =====

    /**
     * Get from weak cache
     */
    fun <V : Any> getCached(key: String): V? {
        @Suppress("UNCHECKED_CAST")
        return genericWeakCache.get(key) as? V
    }

    /**
     * Put into weak cache
     */
    fun putCached(key: String, value: Any) {
        genericWeakCache.put(key, value)
    }

    /**
     * Get or compute cached value
     */
    fun <V : Any> getOrPutCached(key: String, compute: () -> V): V {
        @Suppress("UNCHECKED_CAST")
        return genericWeakCache.getOrPut(key, compute) as V
    }

    /**
     * Remove from cache
     */
    fun removeCached(key: String) {
        genericWeakCache.remove(key)
    }

    // ===== Image Cache =====

    /**
     * Get image cache instance
     */
    fun getImageCache(): ImageMemoryCache = imageCache

    // ===== Cleanup Handler Registration =====

    /**
     * Register a cleanup handler
     */
    fun registerCleanupHandler(handler: MemoryCleanupHandler) {
        synchronized(cleanupHandlers) {
            cleanupHandlers.add(handler)
        }
    }

    /**
     * Unregister a cleanup handler
     */
    fun unregisterCleanupHandler(handler: MemoryCleanupHandler) {
        synchronized(cleanupHandlers) {
            cleanupHandlers.remove(handler)
        }
    }

    // ===== Memory Pressure Handling =====

    override fun onTrimMemory(level: Int) {
        val pressureLevel = MemoryPressureLevel.fromTrimLevel(level)
        _pressureLevel.value = pressureLevel

        Timber.d("onTrimMemory: level=$level, pressure=$pressureLevel")

        when (pressureLevel) {
            MemoryPressureLevel.NORMAL -> {
                // No action needed
            }
            MemoryPressureLevel.MODERATE -> {
                performModerateCleanup()
            }
            MemoryPressureLevel.WARNING -> {
                performWarningCleanup()
            }
            MemoryPressureLevel.CRITICAL -> {
                performCriticalCleanup()
            }
        }

        updateStatistics()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        // No action needed
    }

    override fun onLowMemory() {
        Timber.w("onLowMemory called")
        _pressureLevel.value = MemoryPressureLevel.CRITICAL
        performCriticalCleanup()
        updateStatistics()
    }

    // ===== Cleanup Operations =====

    private fun performModerateCleanup() {
        Timber.d("Performing moderate cleanup")

        // Evict stale cache entries
        genericWeakCache.evictStale()

        // Notify handlers
        notifyCleanupHandlers(MemoryPressureLevel.MODERATE)
    }

    private fun performWarningCleanup() {
        Timber.d("Performing warning cleanup")

        // Evict stale and clear half the cache
        genericWeakCache.evictStale()
        genericWeakCache.clear()

        // Trim image cache to half
        imageCache.trimToSize(imageCache.maxSize / 2)

        // Clear half of object pools
        objectPools.values.forEach { pool ->
            // Drain half the pool
            repeat(pool.size / 2) {
                pool.acquire()
            }
        }

        // Notify handlers
        notifyCleanupHandlers(MemoryPressureLevel.WARNING)

        // Request GC
        System.gc()
    }

    private fun performCriticalCleanup() {
        Timber.w("Performing critical cleanup")

        // Clear all caches
        genericWeakCache.clear()
        imageCache.clear()

        // Clear all pools
        objectPools.values.forEach { it.clear() }

        // Notify handlers
        notifyCleanupHandlers(MemoryPressureLevel.CRITICAL)

        // Force GC
        System.gc()
        System.runFinalization()
        System.gc()
    }

    private fun notifyCleanupHandlers(level: MemoryPressureLevel) {
        synchronized(cleanupHandlers) {
            cleanupHandlers.forEach { handler ->
                try {
                    handler.onMemoryCleanup(level)
                } catch (e: Exception) {
                    Timber.e(e, "Cleanup handler error")
                }
            }
        }
    }

    // ===== Statistics =====

    /**
     * Get current memory statistics
     */
    fun getStats(): MemoryStatistics {
        updateStatistics()
        return _statistics.value
    }

    private fun updateStatistics() {
        val runtime = Runtime.getRuntime()
        val totalHeap = runtime.totalMemory()
        val freeHeap = runtime.freeMemory()
        val maxHeap = runtime.maxMemory()
        val usedHeap = totalHeap - freeHeap
        val nativeHeap = Debug.getNativeHeapAllocatedSize()

        val weakCacheStats = genericWeakCache.stats

        _statistics.value = MemoryStatistics(
            totalHeap = totalHeap,
            usedHeap = usedHeap,
            freeHeap = freeHeap,
            maxHeap = maxHeap,
            nativeHeap = nativeHeap,
            poolHits = objectPools.values.sumOf { it.stats.hits },
            poolMisses = objectPools.values.sumOf { it.stats.misses },
            cacheHits = weakCacheStats.hits,
            cacheMisses = weakCacheStats.misses,
            pressureLevel = _pressureLevel.value
        )
    }

    /**
     * Force manual cleanup at specified level
     */
    fun forceCleanup(level: MemoryPressureLevel) {
        when (level) {
            MemoryPressureLevel.NORMAL -> { /* no-op */ }
            MemoryPressureLevel.MODERATE -> performModerateCleanup()
            MemoryPressureLevel.WARNING -> performWarningCleanup()
            MemoryPressureLevel.CRITICAL -> performCriticalCleanup()
        }
        updateStatistics()
    }

    /**
     * Check if memory is low
     */
    fun isMemoryLow(): Boolean {
        return _pressureLevel.value >= MemoryPressureLevel.WARNING ||
            getStats().isLowMemory
    }

    /**
     * Cleanup and unregister
     */
    fun cleanup() {
        application.unregisterComponentCallbacks(this)
        performCriticalCleanup()
        cleanupHandlers.clear()
        objectPools.clear()
        Timber.d("MemoryManager cleaned up")
    }
}

/**
 * Interface for components that need cleanup on memory pressure
 */
interface MemoryCleanupHandler {
    /**
     * Called when memory cleanup is needed
     *
     * @param level The pressure level triggering cleanup
     */
    fun onMemoryCleanup(level: MemoryPressureLevel)
}
