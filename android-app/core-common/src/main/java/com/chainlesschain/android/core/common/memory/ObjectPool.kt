package com.chainlesschain.android.core.common.memory

import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger

/**
 * Object Pool
 *
 * Generic object pool implementation for reusing expensive objects.
 * Thread-safe using concurrent data structures.
 *
 * @param T Type of objects in the pool
 * @param maxSize Maximum number of objects to keep in pool
 * @param factory Factory function to create new objects
 * @param reset Optional function to reset object state before reuse
 */
class ObjectPool<T : Any>(
    private val maxSize: Int = 20,
    private val factory: () -> T,
    private val reset: ((T) -> Unit)? = null
) {
    private val pool = ConcurrentLinkedQueue<T>()
    private val currentSize = AtomicInteger(0)

    // Statistics
    private val hitCount = AtomicInteger(0)
    private val missCount = AtomicInteger(0)
    private val returnCount = AtomicInteger(0)

    /**
     * Acquire an object from the pool or create a new one
     *
     * @return Object from pool or newly created
     */
    fun acquire(): T {
        val pooled = pool.poll()
        return if (pooled != null) {
            hitCount.incrementAndGet()
            currentSize.decrementAndGet()
            pooled
        } else {
            missCount.incrementAndGet()
            factory()
        }
    }

    /**
     * Return an object to the pool for reuse
     *
     * @param obj Object to return
     * @return True if object was pooled, false if pool is full
     */
    fun release(obj: T): Boolean {
        if (currentSize.get() >= maxSize) {
            return false
        }

        reset?.invoke(obj)
        val added = pool.offer(obj)
        if (added) {
            currentSize.incrementAndGet()
            returnCount.incrementAndGet()
        }
        return added
    }

    /**
     * Clear all pooled objects
     */
    fun clear() {
        pool.clear()
        currentSize.set(0)
    }

    /**
     * Get current pool size
     */
    val size: Int
        get() = currentSize.get()

    /**
     * Check if pool is empty
     */
    val isEmpty: Boolean
        get() = pool.isEmpty()

    /**
     * Get pool statistics
     */
    val stats: PoolStats
        get() = PoolStats(
            poolSize = size,
            maxSize = maxSize,
            hits = hitCount.get(),
            misses = missCount.get(),
            returns = returnCount.get()
        )

    /**
     * Reset statistics
     */
    fun resetStats() {
        hitCount.set(0)
        missCount.set(0)
        returnCount.set(0)
    }
}

/**
 * Pool statistics
 */
data class PoolStats(
    val poolSize: Int,
    val maxSize: Int,
    val hits: Int,
    val misses: Int,
    val returns: Int
) {
    val hitRate: Float
        get() {
            val total = hits + misses
            return if (total > 0) hits.toFloat() / total else 0f
        }

    val utilizationRate: Float
        get() = if (maxSize > 0) poolSize.toFloat() / maxSize else 0f
}
