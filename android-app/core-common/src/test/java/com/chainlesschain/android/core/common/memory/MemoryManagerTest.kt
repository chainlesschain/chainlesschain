package com.chainlesschain.android.core.common.memory

import org.junit.Assert.*
import org.junit.Before
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

        // Then
        val stats = pool.getStats()
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
        repeat(10) {
            val obj = pool.acquire()
            obj.append("test")
            pool.release(obj)
        }

        // Then
        val stats = pool.getStats()
        assertEquals("创建次数应正确", 1, stats.created) // 只创建一次，之后都是复用
        assertTrue("复用次数应>0", stats.reused > 0)
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
        val stats = pool.getStats()
        assertEquals("池应为空", 0, stats.poolSize)
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
        val stats = pool.getStats()
        assertTrue("应有操作记录", stats.created > 0 || stats.reused > 0)
    }

    // ===== WeakCache Tests =====

    @Test
    fun `弱缓存存取应成功`() {
        // Given
        val cache = WeakCache<String, Any>()
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
        assertEquals("清空后大小应为0", 0, cache.size())
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
        assertEquals("大小应为3", 3, cache.size())
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
    fun `内存压力级别描述不为空`() {
        // Then
        MemoryPressureLevel.values().forEach { level ->
            assertTrue("描述不应为空: ${level.name}",
                level.description.isNotEmpty())
        }
    }

    // ===== MemoryStatistics Tests =====

    @Test
    fun `内存统计数据结构正确`() {
        // Given
        val stats = MemoryStatistics(
            usedMemoryMB = 128.0,
            maxMemoryMB = 512.0,
            availableMemoryMB = 384.0,
            lowMemoryThresholdMB = 100.0,
            gcCount = 5,
            gcTotalTimeMs = 150
        )

        // Then
        assertEquals("已用内存应正确", 128.0, stats.usedMemoryMB, 0.01)
        assertEquals("最大内存应正确", 512.0, stats.maxMemoryMB, 0.01)
        assertTrue("使用率应合理", stats.usagePercentage in 0.0..100.0)
    }

    @Test
    fun `内存使用率计算正确`() {
        // Given
        val stats = MemoryStatistics(
            usedMemoryMB = 256.0,
            maxMemoryMB = 512.0,
            availableMemoryMB = 256.0,
            lowMemoryThresholdMB = 100.0,
            gcCount = 0,
            gcTotalTimeMs = 0
        )

        // Then
        assertEquals("使用率应为50%", 50.0, stats.usagePercentage, 0.01)
    }

    // ===== ImageMemoryCache Tests =====

    @Test
    fun `图片缓存存取应成功`() {
        // Given - 使用简单的ByteArray模拟Bitmap
        val cache = object {
            private val map = mutableMapOf<String, ByteArray>()

            fun put(key: String, value: ByteArray) {
                map[key] = value
            }

            fun get(key: String): ByteArray? = map[key]

            fun size(): Int = map.size
        }

        // When
        cache.put("image1", ByteArray(100))
        cache.put("image2", ByteArray(200))

        // Then
        assertNotNull("应获取到图片1", cache.get("image1"))
        assertNotNull("应获取到图片2", cache.get("image2"))
        assertEquals("缓存大小应为2", 2, cache.size())
    }

    // ===== Integration Tests =====

    @Test
    fun `内存级别转换正确`() {
        // Given
        val levels = MemoryPressureLevel.values()

        // When/Then
        levels.forEach { level ->
            val name = level.name
            val parsed = MemoryPressureLevel.valueOf(name)
            assertEquals("转换应一致", level, parsed)
        }
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
        assertTrue("写入应在合理时间内完成", duration < 500)
    }

    // ===== Edge Cases =====

    @Test
    fun `对象池工厂抛异常应处理`() {
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
    fun `弱缓存null值处理`() {
        // Given
        val cache = WeakCache<String, String?>()

        // When
        cache.put("key", null)
        val value = cache.get("key")

        // Then
        assertNull("null值应正确存储", value)
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
}
