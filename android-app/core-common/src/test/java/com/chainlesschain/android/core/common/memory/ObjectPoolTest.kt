package com.chainlesschain.android.core.common.memory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [ObjectPool] / [PoolStats] 单测：对象复用池的 acquire/release/统计语义，此前零覆盖。
 */
class ObjectPoolTest {

    @Test
    fun `acquire on empty pool creates via factory and counts a miss`() {
        var created = 0
        val pool = ObjectPool(maxSize = 4, factory = { created++; StringBuilder() })

        assertNotNull(pool.acquire())
        assertEquals(1, created)
        assertEquals(1, pool.stats.misses)
        assertEquals(0, pool.stats.hits)
    }

    @Test
    fun `release then acquire reuses the same instance and counts a hit`() {
        val pool = ObjectPool(maxSize = 4, factory = { StringBuilder() })
        val first = pool.acquire()

        assertTrue(pool.release(first))
        assertEquals(1, pool.size)

        val second = pool.acquire()
        assertSame(first, second)        // 同一实例被复用
        assertEquals(1, pool.stats.hits)
        assertEquals(0, pool.size)        // 取出后池空
    }

    @Test
    fun `reset is invoked on release`() {
        val resetCalls = mutableListOf<StringBuilder>()
        val pool = ObjectPool(
            maxSize = 4,
            factory = { StringBuilder("dirty") },
            reset = { it.clear(); resetCalls.add(it) },
        )
        val obj = pool.acquire()

        pool.release(obj)

        assertEquals(listOf(obj), resetCalls)
        assertEquals(0, obj.length) // reset 已清空
    }

    @Test
    fun `release returns false when pool is full and does not pool`() {
        val pool = ObjectPool(maxSize = 2, factory = { Any() })

        assertTrue(pool.release(Any()))
        assertTrue(pool.release(Any()))
        assertEquals(2, pool.size)

        assertFalse(pool.release(Any())) // 满 → 拒绝
        assertEquals(2, pool.size)
    }

    @Test
    fun `clear empties the pool`() {
        val pool = ObjectPool(maxSize = 4, factory = { Any() })
        pool.release(Any())
        pool.release(Any())
        assertEquals(2, pool.size)
        assertFalse(pool.isEmpty)

        pool.clear()

        assertEquals(0, pool.size)
        assertTrue(pool.isEmpty)
    }

    @Test
    fun `stats track hits misses returns and hitRate, resetStats zeroes counters`() {
        val pool = ObjectPool(maxSize = 4, factory = { Any() })
        pool.acquire()          // miss
        val o = pool.acquire()  // miss
        pool.release(o)         // return
        pool.acquire()          // hit (reuses o)

        val s = pool.stats
        assertEquals(1, s.hits)
        assertEquals(2, s.misses)
        assertEquals(1, s.returns)
        assertEquals(1f / 3f, s.hitRate, 1e-6f)

        pool.resetStats()
        assertEquals(0, pool.stats.hits)
        assertEquals(0, pool.stats.misses)
        assertEquals(0, pool.stats.returns)
    }

    @Test
    fun `PoolStats rates handle zero division`() {
        val empty = PoolStats(poolSize = 0, maxSize = 0, hits = 0, misses = 0, returns = 0)
        assertEquals(0f, empty.hitRate, 0f)         // total=0 → 0，不应 NaN
        assertEquals(0f, empty.utilizationRate, 0f) // maxSize=0 → 0

        val half = PoolStats(poolSize = 5, maxSize = 10, hits = 3, misses = 1, returns = 0)
        assertEquals(0.5f, half.utilizationRate, 1e-6f)
        assertEquals(0.75f, half.hitRate, 1e-6f)
    }
}
