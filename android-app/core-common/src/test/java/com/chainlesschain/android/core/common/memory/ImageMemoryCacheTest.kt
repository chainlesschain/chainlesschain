package com.chainlesschain.android.core.common.memory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [ImageMemoryCache.maxSizeForHeap] 单测：堆上限的 1/8 换算必须全程 Long 运算并钳到
 * 合法 Int 区间。原实现 `maxMemory().toInt()` 在堆 > 2GB 时截断成负数（→ /8 负 →
 * `LruCache(负)` 抛 IllegalArgumentException 崩溃），无上限 JVM 返回 Long.MAX_VALUE
 * 时截断成 -1 → /8 = 0 → `LruCache(0)` 崩溃。此前 calculateDefaultMaxSize 零覆盖。
 */
class ImageMemoryCacheTest {

    @Test
    fun `typical heap yields one eighth`() {
        assertEquals(64 * 1024 * 1024, ImageMemoryCache.maxSizeForHeap(512L * 1024 * 1024))
        assertEquals(32 * 1024 * 1024, ImageMemoryCache.maxSizeForHeap(256L * 1024 * 1024))
    }

    @Test
    fun `heap above 2GB does not truncate to zero or negative`() {
        // 旧实现 maxMemory().toInt() 在 3-4GB 堆下变负 → /8 负 → LruCache 崩溃。
        val result = ImageMemoryCache.maxSizeForHeap(4L * 1024 * 1024 * 1024)
        assertEquals(512 * 1024 * 1024, result)
        assertTrue(result > 0)
    }

    @Test
    fun `unbounded heap clamps to Int MAX_VALUE`() {
        // 无堆上限时 Runtime.maxMemory() 返回 Long.MAX_VALUE。
        assertEquals(Int.MAX_VALUE, ImageMemoryCache.maxSizeForHeap(Long.MAX_VALUE))
    }

    @Test
    fun `tiny heap clamps to at least one`() {
        // LruCache 要求 maxSize > 0；下限钳到 1。
        assertEquals(1, ImageMemoryCache.maxSizeForHeap(0L))
        assertEquals(1, ImageMemoryCache.maxSizeForHeap(4L))
    }
}
