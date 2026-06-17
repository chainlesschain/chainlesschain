package com.chainlesschain.android.core.common.memory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [WeakCache] / [CacheStats] 单测：缓存的确定性逻辑（put/get/getOrPut/remove/contains/clear/stats）。
 *
 * 测试全程对 value 持强引用，避免 WeakReference 被 GC——**GC 触发的弱引用回收本身不可确定性测试
 * （System.gc 只是提示），故不在此断言**，只覆盖与 GC 无关的逻辑路径。
 */
class WeakCacheTest {

    @Test
    fun `put then get returns value and counts a hit`() {
        val cache = WeakCache<String, StringBuilder>()
        val v = StringBuilder("a")
        cache.put("k", v)

        assertSame(v, cache.get("k"))
        assertEquals(1, cache.stats.hits)
        assertEquals(0, cache.stats.misses)
    }

    @Test
    fun `get on absent key returns null and counts a miss`() {
        val cache = WeakCache<String, StringBuilder>()
        assertNull(cache.get("missing"))
        assertEquals(1, cache.stats.misses)
        assertEquals(0, cache.stats.hits)
    }

    @Test
    fun `getOrPut computes and caches on miss then returns cached without recomputing`() {
        val cache = WeakCache<String, StringBuilder>()
        val v = StringBuilder("a")
        var computeCount = 0

        val first = cache.getOrPut("k") { computeCount++; v }
        assertSame(v, first)
        assertEquals(1, computeCount)

        val second = cache.getOrPut("k") { computeCount++; StringBuilder("other") }
        assertSame(v, second)            // 命中缓存
        assertEquals(1, computeCount)    // 不应再计算
    }

    @Test
    fun `remove returns value and clears entry`() {
        val cache = WeakCache<String, StringBuilder>()
        val v = StringBuilder("a")
        cache.put("k", v)

        assertSame(v, cache.remove("k"))
        assertFalse(cache.contains("k"))
        assertNull(cache.remove("k")) // 再次移除无值
    }

    @Test
    fun `contains reflects live presence`() {
        val cache = WeakCache<String, StringBuilder>()
        val v = StringBuilder("a")
        assertFalse(cache.contains("k"))
        cache.put("k", v)
        assertTrue(cache.contains("k"))
    }

    @Test
    fun `clear empties cache and counts evictions`() {
        val cache = WeakCache<String, StringBuilder>()
        val a = StringBuilder("a")
        val b = StringBuilder("b")
        cache.put("a", a)
        cache.put("b", b)
        assertEquals(2, cache.size)

        cache.clear()

        assertEquals(0, cache.size)
        assertEquals(2, cache.stats.evictions)
    }

    @Test
    fun `evictStale evicts nothing when all values are live and size equals liveCount`() {
        val cache = WeakCache<String, StringBuilder>()
        val a = StringBuilder("a")
        val b = StringBuilder("b")
        cache.put("a", a)
        cache.put("b", b)

        assertEquals(0, cache.evictStale()) // 全部存活 → 无可回收
        assertEquals(2, cache.size)
        assertEquals(2, cache.liveCount)
    }

    @Test
    fun `CacheStats rates including zero-division edges`() {
        val empty = CacheStats(size = 0, liveCount = 0, maxSize = 0, hits = 0, misses = 0, evictions = 0)
        assertEquals(0f, empty.hitRate, 0f)         // total=0 → 0，非 NaN
        assertEquals(0f, empty.utilizationRate, 0f) // maxSize=0 → 0
        assertEquals(0f, empty.staleRate, 0f)       // size=0 → 0

        val s = CacheStats(size = 4, liveCount = 3, maxSize = 10, hits = 3, misses = 1, evictions = 0)
        assertEquals(0.75f, s.hitRate, 1e-6f)       // 3/(3+1)
        assertEquals(0.3f, s.utilizationRate, 1e-6f) // liveCount 3 / maxSize 10
        assertEquals(0.25f, s.staleRate, 1e-6f)      // (size 4 - live 3)/4
    }
}
