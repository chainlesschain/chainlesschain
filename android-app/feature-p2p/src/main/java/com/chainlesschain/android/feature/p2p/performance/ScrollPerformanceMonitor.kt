package com.chainlesschain.android.feature.p2p.performance

import android.util.Log
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

/**
 * 滚动性能监控器 - Phase 7.3
 *
 * 实时监控滚动性能指标：
 * - 帧率
 * - 掉帧率
 * - 滚动速度
 * - 重组次数
 *
 * 使用方法：
 * ```kotlin
 * val listState = rememberLazyListState()
 * ScrollPerformanceMonitor(
 *     listState = listState,
 *     tag = "TimelineScreen",
 *     enabled = BuildConfig.DEBUG
 * )
 * ```
 */
@Composable
fun ScrollPerformanceMonitor(
    listState: LazyListState,
    tag: String = "ScrollPerf",
    enabled: Boolean = true
) {
    if (!enabled) return

    val monitor = remember { PerformanceMetrics() }

    // 监控滚动状态
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }
            .distinctUntilChanged()
            .collect { isScrolling ->
                if (isScrolling) {
                    monitor.startScroll()
                } else {
                    monitor.endScroll()
                    monitor.printReport(tag)
                }
            }
    }

    // 监控可见item变化（滚动速度）
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .filter { listState.isScrollInProgress }
            .collect { index ->
                monitor.recordVisibleIndexChange(index)
            }
    }

    // 监控布局信息变化（重组次数）
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo }
            .filter { listState.isScrollInProgress }
            .collect {
                monitor.recordRecomposition()
            }
    }
}

/**
 * 性能指标数据类
 */
private class PerformanceMetrics {
    private var scrollStartTime: Long = 0
    private var scrollEndTime: Long = 0
    private var scrollCount: Int = 0
    private var recompositionCount: Int = 0
    private var lastVisibleIndex: Int = 0
    private var indexChangeCount: Int = 0

    fun startScroll() {
        scrollStartTime = System.currentTimeMillis()
        scrollCount++
        recompositionCount = 0
        indexChangeCount = 0
        lastVisibleIndex = 0
    }

    fun endScroll() {
        scrollEndTime = System.currentTimeMillis()
    }

    fun recordRecomposition() {
        recompositionCount++
    }

    fun recordVisibleIndexChange(index: Int) {
        if (lastVisibleIndex != index) {
            indexChangeCount++
            lastVisibleIndex = index
        }
    }

    fun printReport(tag: String) {
        if (scrollStartTime == 0L) return

        val duration = scrollEndTime - scrollStartTime
        val fps = if (duration > 0) {
            (recompositionCount * 1000f) / duration
        } else {
            0f
        }

        val scrollSpeed = if (duration > 0) {
            (indexChangeCount * 1000f) / duration
        } else {
            0f
        }

        Log.d(tag, "=== Scroll Performance Report ===")
        Log.d(tag, "Duration: ${duration}ms")
        Log.d(tag, "Recompositions: $recompositionCount")
        Log.d(tag, "FPS: %.1f".format(fps))
        Log.d(tag, "Index changes: $indexChangeCount")
        Log.d(tag, "Scroll speed: %.1f items/s".format(scrollSpeed))
        Log.d(tag, "================================")

        // 性能告警
        if (fps < 55f) {
            Log.w(tag, "⚠️ Low FPS detected: %.1f (target: 60)".format(fps))
        }
        if (recompositionCount > indexChangeCount * 3) {
            Log.w(tag, "⚠️ Excessive recompositions: $recompositionCount for $indexChangeCount items")
        }
    }
}

/**
 * 重组计数器 - 用于调试组件重组频率
 *
 * 使用方法：
 * ```kotlin
 * @Composable
 * fun MyComponent() {
 *     RecompositionCounter(tag = "MyComponent")
 *     // ... component content
 * }
 * ```
 */
@Composable
fun RecompositionCounter(
    tag: String,
    enabled: Boolean = true
) {
    if (!enabled) return

    val counter = remember { mutableStateOf(0) }

    SideEffect {
        counter.value++
        Log.d("Recomposition", "$tag: ${counter.value}")
    }
}

/**
 * 性能基准测试结果
 */
data class BenchmarkResult(
    val averageFps: Float,
    val p50FrameTime: Long,
    val p90FrameTime: Long,
    val p95FrameTime: Long,
    val p99FrameTime: Long,
    val droppedFramePercent: Float,
    val totalFrames: Int,
    val droppedFrames: Int
) {
    /**
     * 是否达标
     *
     * 目标：
     * - FPS ≥ 58
     * - P95 < 20ms
     * - 掉帧率 < 2%
     */
    fun isPassingBenchmark(): Boolean {
        return averageFps >= 58f &&
                p95FrameTime < 20 &&
                droppedFramePercent < 2f
    }

    override fun toString(): String {
        return """
            Benchmark Result:
            - Average FPS: %.1f
            - P50 frame time: %dms
            - P90 frame time: %dms
            - P95 frame time: %dms
            - P99 frame time: %dms
            - Dropped frames: %d/%d (%.2f%%)
            - Status: %s
        """.trimIndent().format(
            averageFps,
            p50FrameTime,
            p90FrameTime,
            p95FrameTime,
            p99FrameTime,
            droppedFrames,
            totalFrames,
            droppedFramePercent,
            if (isPassingBenchmark()) "✅ PASSED" else "❌ FAILED"
        )
    }
}
