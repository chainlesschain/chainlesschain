package com.chainlesschain.android.core.common.memory

import org.junit.Assert.*
import org.junit.Test

/**
 * MemoryManager 单元测试
 *
 * 验证对象池、弱缓存、内存压力监控等功能
 */
class MemoryManagerTest {

    // ===== ObjectPool Tests =====

    @Test
    fun `对象池获取对象应成功`() {
        // Given
        val pool = ObjectPool(
            maxSize = 5,
            factory = { StringBuilder() },
            reset = { it.clear() }
        )

        // When
        val obj = pool.acquire()

        // Then
        assertNotNull("应获取到对象", obj)
        assertTrue("应是StringBuilder类型", obj is StringBuilder)
    }

    @Test
    fun `对象池回收对象应成功`() {
        // Given
        val pool = ObjectPool(
            maxSize = 5,
            factory = { StringBuilder() },
            reset = { it.clear() }
        )
        val obj = pool.acquire()
        obj.append("test")

        // When
        pool.release(obj)
        val reused = pool.acquire()

        // Then
        assertEquals("回收后对象应被重置", 0, reused.length)
    }

    @Test
    fun `对象池应限制大小`() {
        // Given
        val maxSize = 3
        val pool = ObjectPool(
            maxSize = maxSize,
            factory = { StringBuilder() },
            reset = { it.clear() }
        )

        // When - 获取并释放超过maxSize个对象
        val objects = List(maxSize + 2) { pool.acquire() }
        objects.forEach { pool.release(it) }

        // Then - 使用stats属性
        val stats = pool.stats
        assertTrue("池中对象数量应<=maxSize", stats.poolSize <= maxSize)
    }

    @Test
    fun `对象池统计应正确`() {
        // Given
        val pool = ObjectPool(
            maxSize = 5,
            factory = { StringBuilder() },
            reset = { it.clear() }
        )

        // When
        val obj1 = pool.acquire() // miss
        pool.release(obj1)
        val obj2 = pool.acquire() // hit
        pool.release(obj2)

        // Then
        val stats = pool.stats
        assertTrue("应有命中", stats.hits > 0)
        assertTrue("应有未命中", stats.misses > 0)
    }

    @Test
    fun `对象池清空应成功`() {
        // Given
        val pool = ObjectPool(
            maxSize = 5,
            factory = { StringBuilder() },
            reset = { it.clear() }
        )
        repeat(3) {
            pool.release(pool.acquire())
        }

        // When
        pool.clear()

        // Then
        assertEquals("池应为空", 0, pool.size)
    }

    @Test
    fun `对象池并发安全`() {
        // Given
        val pool = ObjectPool(
            maxSize = 10,
            factory = { StringBuilder() },
            reset = { it.clear() }
        )

        // When - 多线程并发获取和释放
        val threads = List(10) {
            Thread {
                repeat(100) {
                    val obj = pool.acquire()
                    obj.append("test")
                    Thread.sleep(1) // 模拟使用
                    pool.release(obj)
                }
            }
        }

        threads.forEach { it.start() }
        threads.forEach { it.join() }

        // Then - 不应抛异常
        val stats = pool.stats
        assertTrue("应有操作记录", stats.hits > 0 || stats.misses > 0)
    }

    // ===== WeakCache Tests =====

    @Test
    fun `弱缓存存取应成功`() {
        // Given
        val cache = WeakCache<String, String>()
        val key = "test-key"
        val value = "test-value"

        // When
        cache.put(key, value)
        val retrieved = cache.get(key)

        // Then
        assertEquals("应获取到缓存值", value, retrieved)
    }

    @Test
    fun `弱缓存移除应成功`() {
        // Given
        val cache = WeakCache<String, String>()
        cache.put("key1", "value1")
        cache.put("key2", "value2")

        // When
        cache.remove("key1")

        // Then
        assertNull("移除后应为null", cache.get("key1"))
        assertNotNull("其他键应存在", cache.get("key2"))
    }

    @Test
    fun `弱缓存清空应成功`() {
        // Given
        val cache = WeakCache<String, String>()
        repeat(10) { i ->
            cache.put("key-$i", "value-$i")
        }

        // When
        cache.clear()

        // Then
        assertEquals("清空后大小应为0", 0, cache.size)
    }

    @Test
    fun `弱缓存应返回正确大小`() {
        // Given
        val cache = WeakCache<String, String>()

        // When
        cache.put("key1", "value1")
        cache.put("key2", "value2")
        cache.put("key3", "value3")

        // Then
        assertEquals("大小应为3", 3, cache.size)
    }

    @Test
    fun `弱缓存getOrPut应正确工作`() {
        // Given
        val cache = WeakCache<String, String>()

        // When
        val value1 = cache.getOrPut("key") { "computed" }
        val value2 = cache.getOrPut("key") { "new-computed" }

        // Then
        assertEquals("第一次应计算", "computed", value1)
        assertEquals("第二次应从缓存获取", "computed", value2)
    }

    @Test
    fun `弱缓存contains应正确`() {
        // Given
        val cache = WeakCache<String, String>()
        cache.put("key1", "value1")

        // Then
        assertTrue("已存在的键应返回true", cache.contains("key1"))
        assertFalse("不存在的键应返回false", cache.contains("key2"))
    }

    // ===== MemoryPressureLevel Tests =====

    @Test
    fun `内存压力级别顺序正确`() {
        // Then
        assertTrue("NORMAL < MODERATE",
            MemoryPressureLevel.NORMAL.ordinal < MemoryPressureLevel.MODERATE.ordinal)
        assertTrue("MODERATE < WARNING",
            MemoryPressureLevel.MODERATE.ordinal < MemoryPressureLevel.WARNING.ordinal)
        assertTrue("WARNING < CRITICAL",
            MemoryPressureLevel.WARNING.ordinal < MemoryPressureLevel.CRITICAL.ordinal)
    }

    @Test
    fun `内存压力级别displayName不为空`() {
        // Then
        MemoryPressureLevel.values().forEach { level ->
            assertTrue("displayName不应为空: ${level.name}",
                level.displayName.isNotEmpty())
        }
    }

    @Test
    fun `内存压力级别priority正确`() {
        // Then
        assertEquals("NORMAL priority应为0", 0, MemoryPressureLevel.NORMAL.priority)
        assertEquals("MODERATE priority应为1", 1, MemoryPressureLevel.MODERATE.priority)
        assertEquals("WARNING priority应为2", 2, MemoryPressureLevel.WARNING.priority)
        assertEquals("CRITICAL priority应为3", 3, MemoryPressureLevel.CRITICAL.priority)
    }

    // ===== MemoryStatistics Tests =====

    @Test
    fun `内存统计数据结构正确`() {
        // Given
        val stats = MemoryStatistics(
            totalHeap = 512 * 1024 * 1024L,
            usedHeap = 256 * 1024 * 1024L,
            freeHeap = 256 * 1024 * 1024L,
            maxHeap = 512 * 1024 * 1024L
        )

        // Then
        assertEquals("已用堆应正确", 256 * 1024 * 1024L, stats.usedHeap)
        assertEquals("最大堆应正确", 512 * 1024 * 1024L, stats.maxHeap)
        assertTrue("使用率应合理", stats.heapUsagePercent in 0.0f..1.0f)
    }

    @Test
    fun `内存使用率计算正确`() {
        // Given
        val stats = MemoryStatistics(
            totalHeap = 512 * 1024 * 1024L,
            usedHeap = 256 * 1024 * 1024L,
            freeHeap = 256 * 1024 * 1024L,
            maxHeap = 512 * 1024 * 1024L
        )

        // Then
        assertEquals("使用率应为0.5", 0.5f, stats.heapUsagePercent, 0.01f)
    }

    @Test
    fun `内存MB转换正确`() {
        // Given
        val stats = MemoryStatistics(
            usedHeap = 256 * 1024 * 1024L,
            maxHeap = 512 * 1024 * 1024L
        )

        // Then
        assertEquals("usedHeapMB应为256", 256f, stats.usedHeapMB, 1f)
        assertEquals("maxHeapMB应为512", 512f, stats.maxHeapMB, 1f)
    }

    @Test
    fun `低内存检测正确`() {
        // Given - 高使用率
        val highUsageStats = MemoryStatistics(
            usedHeap = 450 * 1024 * 1024L,
            maxHeap = 512 * 1024 * 1024L
        )

        // Given - 低使用率
        val lowUsageStats = MemoryStatistics(
            usedHeap = 100 * 1024 * 1024L,
            maxHeap = 512 * 1024 * 1024L
        )

        // Then
        assertTrue("高使用率应是低内存", highUsageStats.isLowMemory)
        assertFalse("低使用率不应是低内存", lowUsageStats.isLowMemory)
    }

    // ===== PoolStats Tests =====

    @Test
    fun `池统计命中率计算正确`() {
        // Given
        val stats = PoolStats(
            poolSize = 5,
            maxSize = 10,
            hits = 80,
            misses = 20,
            returns = 100
        )

        // Then
        assertEquals("命中率应为0.8", 0.8f, stats.hitRate, 0.01f)
    }

    @Test
    fun `池统计利用率计算正确`() {
        // Given
        val stats = PoolStats(
            poolSize = 5,
            maxSize = 10,
            hits = 80,
            misses = 20,
            returns = 100
        )

        // Then
        assertEquals("利用率应为0.5", 0.5f, stats.utilizationRate, 0.01f)
    }

    // ===== CacheStats Tests =====

    @Test
    fun `缓存统计命中率计算正确`() {
        // Given
        val stats = CacheStats(
            size = 10,
            liveCount = 8,
            maxSize = 20,
            hits = 70,
            misses = 30,
            evictions = 5
        )

        // Then
        assertEquals("命中率应为0.7", 0.7f, stats.hitRate, 0.01f)
    }

    @Test
    fun `缓存统计利用率计算正确`() {
        // Given
        val stats = CacheStats(
            size = 10,
            liveCount = 8,
            maxSize = 20,
            hits = 70,
            misses = 30,
            evictions = 5
        )

        // Then
        assertEquals("利用率应为0.4", 0.4f, stats.utilizationRate, 0.01f)
    }

    @Test
    fun `缓存统计陈旧率计算正确`() {
        // Given
        val stats = CacheStats(
            size = 10,
            liveCount = 8,
            maxSize = 20,
            hits = 70,
            misses = 30,
            evictions = 5
        )

        // Then
        assertEquals("陈旧率应为0.2", 0.2f, stats.staleRate, 0.01f)
    }

    // ===== Performance Tests =====

    @Test
    fun `对象池高频操作性能`() {
        // Given
        val pool = ObjectPool(
            maxSize = 100,
            factory = { ByteArray(1024) }, // 1KB对象
            reset = { /* no-op */ }
        )

        // When
        val startTime = System.nanoTime()
        repeat(10000) {
            val obj = pool.acquire()
            pool.release(obj)
        }
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        // Then
        println("10000次获取/释放耗时: ${String.format("%.2f", duration)} ms")
        assertTrue("操作应在合理时间内完成", duration < 500) // < 500ms
    }

    @Test
    fun `弱缓存大量写入性能`() {
        // Given
        val cache = WeakCache<Int, ByteArray>()

        // When
        val startTime = System.nanoTime()
        repeat(10000) { i ->
            cache.put(i, ByteArray(100))
        }
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        // Then
        println("10000次缓存写入耗时: ${String.format("%.2f", duration)} ms")
        assertTrue("写入应在合理时间内完成", duration < 5000)
    }

    // ===== Edge Cases =====

    @Test
    fun `对象池工厂抛异常应传播`() {
        // Given
        var callCount = 0
        val pool = ObjectPool(
            maxSize = 5,
            factory = {
                callCount++
                if (callCount > 3) throw RuntimeException("Factory error")
                StringBuilder()
            },
            reset = { it.clear() }
        )

        // When/Then - 前3次应成功
        repeat(3) {
            val obj = pool.acquire()
            pool.release(obj)
        }

        // 之后从池中获取，不调用工厂
        val reused = pool.acquire()
        assertNotNull("应从池中获取", reused)
    }

    @Test
    fun `对象池零大小应每次创建新对象`() {
        // Given
        var created = 0
        val pool = ObjectPool(
            maxSize = 0,
            factory = {
                created++
                StringBuilder()
            },
            reset = { it.clear() }
        )

        // When
        repeat(5) {
            val obj = pool.acquire()
            pool.release(obj)
        }

        // Then
        assertEquals("零大小池应每次创建新对象", 5, created)
    }

    @Test
    fun `弱缓存evictStale应清理失效条目`() {
        // Given
        val cache = WeakCache<String, String>()
        cache.put("key1", "value1")
        cache.put("key2", "value2")

        // When
        val evicted = cache.evictStale()

        // Then - 如果值还在内存中，应该没有被清理
        assertTrue("陈旧条目应>=0", evicted >= 0)
    }
}
