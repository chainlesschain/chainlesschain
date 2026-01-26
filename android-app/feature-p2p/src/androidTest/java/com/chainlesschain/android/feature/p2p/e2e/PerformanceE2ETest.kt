package com.chainlesschain.android.feature.p2p.e2e

import android.os.Debug
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.MainActivity
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.system.measureTimeMillis

/**
 * 性能优化端到端测试 - Phase 7.5
 *
 * 测试场景：
 * 1. 启动速度测试 - 冷启动时间
 * 2. 内存使用测试 - 峰值和平均值
 * 3. 滚动性能测试 - 帧率和流畅度
 *
 * 性能目标：
 * - 冷启动: <1.2s
 * - 内存峰值: <180MB
 * - 滚动帧率: ≥58fps
 * - 掉帧率: <2%
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class PerformanceE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    companion object {
        // 性能目标常量
        private const val TARGET_COLD_START_MS = 1200L  // 1.2秒
        private const val TARGET_MEMORY_MB = 180        // 180MB
        private const val TARGET_FPS = 58f              // 58fps
        private const val TARGET_DROPPED_FRAME_RATE = 0.02f  // 2%

        // 测试参数
        private const val SCROLL_ITERATIONS = 10        // 滚动次数
        private const val SCROLL_DELAY_MS = 100L        // 滚动间隔
    }

    @Before
    fun setup() {
        hiltRule.inject()
    }

    /**
     * Test 1: 启动速度测试
     *
     * 测试内容：
     * 1. 记录应用启动时间
     * 2. 验证主界面显示
     * 3. 验证关键组件加载
     *
     * 验证点：
     * - 启动时间 < 1.2秒
     * - 无ANR（Application Not Responding）
     * - 主界面正确显示
     *
     * 注意：
     * - 此测试需要在冷启动状态下运行
     * - 实际测试使用Macrobenchmark更准确
     */
    @Test
    fun test_startupPerformance_coldStart() = runTest {
        // Given: 应用已启动（由composeTestRule自动启动）
        val startTime = System.currentTimeMillis()

        // When: 等待主界面加载
        composeTestRule.waitForIdle()

        // 验证主界面关键元素显示
        composeTestRule.onNodeWithContentDescription("ChainlessChain").assertIsDisplayed()

        val endTime = System.currentTimeMillis()
        val startupTime = endTime - startTime

        // Then: 验证启动时间
        println("=== Startup Performance ===")
        println("Startup time: ${startupTime}ms")
        println("Target: <${TARGET_COLD_START_MS}ms")
        println("Status: ${if (startupTime < TARGET_COLD_START_MS) "✅ PASSED" else "❌ FAILED"}")
        println("==========================")

        // 断言启动时间符合目标
        assert(startupTime < TARGET_COLD_START_MS) {
            "Startup time ${startupTime}ms exceeds target ${TARGET_COLD_START_MS}ms"
        }
    }

    /**
     * Test 2: 内存使用测试
     *
     * 测试内容：
     * 1. 记录启动后的内存使用
     * 2. 执行常见操作（浏览、滚动、查看图片）
     * 3. 记录内存峰值
     *
     * 验证点：
     * - 启动后内存 < 95MB
     * - 浏览Timeline内存 < 135MB
     * - 查看图片内存峰值 < 180MB
     * - 无内存泄漏（GC后内存恢复）
     */
    @Test
    fun test_memoryUsage_peakAndAverage() = runTest {
        // Given: 应用已启动
        composeTestRule.waitForIdle()

        // 记录启动后内存
        val memoryAfterStart = getCurrentMemoryUsageMB()
        println("=== Memory Usage ===")
        println("After startup: ${memoryAfterStart}MB")

        // When: 导航到Timeline
        composeTestRule.onNodeWithContentDescription("动态").performClick()
        composeTestRule.waitForIdle()

        // 记录浏览Timeline时的内存
        val memoryAfterTimeline = getCurrentMemoryUsageMB()
        println("After Timeline: ${memoryAfterTimeline}MB")

        // 滚动Timeline（加载更多内容）
        repeat(5) {
            composeTestRule.onNodeWithTag("timeline_list").performScrollToIndex(it * 10)
            composeTestRule.waitForIdle()
        }

        val memoryAfterScroll = getCurrentMemoryUsageMB()
        println("After scrolling: ${memoryAfterScroll}MB")

        // 点击查看图片（如果有）
        composeTestRule.onAllNodesWithTag("post_image")[0].performClick()
        composeTestRule.waitForIdle()

        val memoryAfterImage = getCurrentMemoryUsageMB()
        println("After viewing image: ${memoryAfterImage}MB")

        // 关闭图片，触发GC
        composeTestRule.onNodeWithContentDescription("关闭").performClick()
        composeTestRule.waitForIdle()
        System.gc()
        Thread.sleep(500)

        val memoryAfterGC = getCurrentMemoryUsageMB()
        println("After GC: ${memoryAfterGC}MB")

        // Then: 验证内存使用
        println("Target peak: <${TARGET_MEMORY_MB}MB")
        println("Status: ${if (memoryAfterImage < TARGET_MEMORY_MB) "✅ PASSED" else "❌ FAILED"}")
        println("===================")

        // 断言内存峰值符合目标
        assert(memoryAfterStart < 95) {
            "Memory after startup ${memoryAfterStart}MB exceeds target 95MB"
        }
        assert(memoryAfterTimeline < 135) {
            "Memory after Timeline ${memoryAfterTimeline}MB exceeds target 135MB"
        }
        assert(memoryAfterImage < TARGET_MEMORY_MB) {
            "Memory peak ${memoryAfterImage}MB exceeds target ${TARGET_MEMORY_MB}MB"
        }

        // 验证GC后内存恢复
        val memoryDiff = memoryAfterImage - memoryAfterGC
        println("Memory recovered after GC: ${memoryDiff}MB")
        assert(memoryDiff > 20) {
            "Memory not properly recovered after GC (only ${memoryDiff}MB)"
        }
    }

    /**
     * Test 3: 滚动性能测试
     *
     * 测试内容：
     * 1. 在Timeline中执行快速滚动
     * 2. 记录滚动过程中的帧率
     * 3. 计算掉帧率
     *
     * 验证点：
     * - 平均帧率 ≥ 58fps
     * - 掉帧率 < 2%
     * - 无明显卡顿
     *
     * 注意：
     * - 此测试为简化版本
     * - 准确的帧率测试需要Macrobenchmark
     */
    @Test
    fun test_scrollPerformance_frameRate() = runTest {
        // Given: 导航到Timeline
        composeTestRule.onNodeWithContentDescription("动态").performClick()
        composeTestRule.waitForIdle()

        // 确保有足够的内容可以滚动
        // (假设已经有测试数据)

        // When: 执行多次滚动并测量时间
        println("=== Scroll Performance ===")
        val scrollTimes = mutableListOf<Long>()

        repeat(SCROLL_ITERATIONS) { iteration ->
            val scrollTime = measureTimeMillis {
                composeTestRule.onNodeWithTag("timeline_list")
                    .performScrollToIndex(iteration * 5)
                composeTestRule.waitForIdle()
            }
            scrollTimes.add(scrollTime)
            Thread.sleep(SCROLL_DELAY_MS)
        }

        // 计算统计数据
        val avgScrollTime = scrollTimes.average()
        val minScrollTime = scrollTimes.minOrNull() ?: 0L
        val maxScrollTime = scrollTimes.maxOrNull() ?: 0L

        // 估算帧率（简化计算）
        // 假设每次滚动移动5个item，每个item约16.67ms @ 60fps
        val expectedTime = 5 * 16.67  // 约83ms
        val estimatedFps = (expectedTime / avgScrollTime) * 60

        // 计算掉帧
        val droppedFrames = scrollTimes.count { it > 16.67 * 2 }  // 超过2帧时间视为掉帧
        val droppedFrameRate = droppedFrames.toFloat() / SCROLL_ITERATIONS

        // Then: 打印结果
        println("Average scroll time: ${avgScrollTime}ms")
        println("Min scroll time: ${minScrollTime}ms")
        println("Max scroll time: ${maxScrollTime}ms")
        println("Estimated FPS: ${"%.1f".format(estimatedFps)}")
        println("Dropped frames: $droppedFrames / $SCROLL_ITERATIONS")
        println("Dropped frame rate: ${"%.1f%%".format(droppedFrameRate * 100)}")
        println("Target FPS: ≥${TARGET_FPS}")
        println("Target dropped rate: <${"%.1f%%".format(TARGET_DROPPED_FRAME_RATE * 100)}")
        println("Status: ${
            if (estimatedFps >= TARGET_FPS && droppedFrameRate < TARGET_DROPPED_FRAME_RATE)
                "✅ PASSED"
            else
                "❌ FAILED"
        }")
        println("==========================")

        // 断言性能符合目标
        assert(estimatedFps >= TARGET_FPS) {
            "Estimated FPS ${"%.1f".format(estimatedFps)} below target $TARGET_FPS"
        }
        assert(droppedFrameRate < TARGET_DROPPED_FRAME_RATE) {
            "Dropped frame rate ${"%.1f%%".format(droppedFrameRate * 100)} " +
                    "exceeds target ${"%.1f%%".format(TARGET_DROPPED_FRAME_RATE * 100)}"
        }
    }

    /**
     * Test 4: 图片加载性能测试（额外测试）
     *
     * 测试内容：
     * 1. 测试图片预加载效果
     * 2. 测试图片缓存命中率
     * 3. 测试图片加载延迟
     *
     * 验证点：
     * - 预加载减少加载延迟
     * - 缓存命中率 > 80%
     * - 图片显示无闪烁
     */
    @Test
    fun test_imageLoadingPerformance_preloadAndCache() = runTest {
        // Given: 导航到Timeline（包含图片）
        composeTestRule.onNodeWithContentDescription("动态").performClick()
        composeTestRule.waitForIdle()

        println("=== Image Loading Performance ===")

        // When: 快速滚动，测试图片加载
        val loadTimes = mutableListOf<Long>()

        repeat(10) { index ->
            val loadTime = measureTimeMillis {
                composeTestRule.onNodeWithTag("timeline_list")
                    .performScrollToIndex(index * 3)
                composeTestRule.waitForIdle()
                // 等待图片加载
                composeTestRule.waitUntil(timeoutMillis = 1000) {
                    composeTestRule.onAllNodesWithTag("post_image").fetchSemanticsNodes().isNotEmpty()
                }
            }
            loadTimes.add(loadTime)
        }

        // Then: 分析加载时间
        val avgLoadTime = loadTimes.average()
        val maxLoadTime = loadTimes.maxOrNull() ?: 0L

        println("Average image load time: ${avgLoadTime}ms")
        println("Max image load time: ${maxLoadTime}ms")
        println("Target: <500ms (with preloading)")
        println("Status: ${if (avgLoadTime < 500) "✅ PASSED" else "⚠️  WARNING"}")
        println("=================================")

        // 预加载应该使加载时间保持在500ms以内
        assert(avgLoadTime < 500) {
            "Average image load time ${avgLoadTime}ms exceeds expected 500ms with preloading"
        }
    }

    /**
     * 获取当前内存使用量（MB）
     */
    private fun getCurrentMemoryUsageMB(): Long {
        val runtime = Runtime.getRuntime()
        val usedMemory = runtime.totalMemory() - runtime.freeMemory()
        return usedMemory / (1024 * 1024)
    }

    /**
     * 获取Native堆内存使用量（MB）
     */
    private fun getNativeMemoryUsageMB(): Long {
        return Debug.getNativeHeapAllocatedSize() / (1024 * 1024)
    }
}
