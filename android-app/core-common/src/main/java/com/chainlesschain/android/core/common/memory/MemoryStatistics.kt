package com.chainlesschain.android.core.common.memory

/**
 * Memory Statistics
 *
 * Contains memory usage statistics and metrics.
 */
data class MemoryStatistics(
    /**
     * Total heap memory in bytes
     */
    val totalHeap: Long = 0,

    /**
     * Used heap memory in bytes
     */
    val usedHeap: Long = 0,

    /**
     * Free heap memory in bytes
     */
    val freeHeap: Long = 0,

    /**
     * Max heap memory in bytes
     */
    val maxHeap: Long = 0,

    /**
     * Native heap size in bytes
     */
    val nativeHeap: Long = 0,

    /**
     * Number of object pool hits
     */
    val poolHits: Int = 0,

    /**
     * Number of object pool misses
     */
    val poolMisses: Int = 0,

    /**
     * Number of cache hits
     */
    val cacheHits: Int = 0,

    /**
     * Number of cache misses
     */
    val cacheMisses: Int = 0,

    /**
     * Current pressure level
     */
    val pressureLevel: MemoryPressureLevel = MemoryPressureLevel.NORMAL,

    /**
     * Timestamp of this measurement
     */
    val timestamp: Long = System.currentTimeMillis()
) {
    /**
     * Heap usage percentage (0.0 to 1.0)
     */
    val heapUsagePercent: Float
        get() = if (maxHeap > 0) usedHeap.toFloat() / maxHeap else 0f

    /**
     * Pool hit rate (0.0 to 1.0)
     */
    val poolHitRate: Float
        get() {
            val total = poolHits + poolMisses
            return if (total > 0) poolHits.toFloat() / total else 0f
        }

    /**
     * Cache hit rate (0.0 to 1.0)
     */
    val cacheHitRate: Float
        get() {
            val total = cacheHits + cacheMisses
            return if (total > 0) cacheHits.toFloat() / total else 0f
        }

    /**
     * Used heap in MB
     */
    val usedHeapMB: Float
        get() = usedHeap / (1024f * 1024f)

    /**
     * Max heap in MB
     */
    val maxHeapMB: Float
        get() = maxHeap / (1024f * 1024f)

    /**
     * Check if memory is low
     */
    val isLowMemory: Boolean
        get() = heapUsagePercent > 0.8f || pressureLevel >= MemoryPressureLevel.WARNING
}
