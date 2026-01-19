package com.chainlesschain.android.core.performance

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import timber.log.Timber

/**
 * Compose性能监控工具
 *
 * 使用:
 * @Composable
 * fun MyScreen() {
 *     TraceComposition("MyScreen")
 *     // 组件内容...
 * }
 */

/**
 * 追踪Composable的组合次数
 * 用于检测不必要的重组
 */
@Composable
fun TraceComposition(tag: String) {
    val counter = remember { mutableListOf(0) }

    counter[0]++

    if (counter[0] > 1) {
        Timber.d("Composition: $tag - recomposed ${counter[0]} times")
    }

    DisposableEffect(Unit) {
        Timber.d("Composition: $tag - created")
        onDispose {
            Timber.d("Composition: $tag - disposed")
        }
    }
}

/**
 * 测量Composable的渲染时间
 */
@Composable
fun MeasureCompositionTime(tag: String, content: @Composable () -> Unit) {
    val startTime = remember { System.nanoTime() }

    content()

    DisposableEffect(Unit) {
        val elapsedMs = (System.nanoTime() - startTime) / 1_000_000
        Timber.d("Composition time: $tag took ${elapsedMs}ms")
        onDispose { }
    }
}
