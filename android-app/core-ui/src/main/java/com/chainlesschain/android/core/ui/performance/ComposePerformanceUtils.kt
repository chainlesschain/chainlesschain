package com.chainlesschain.android.core.ui.performance

import androidx.compose.runtime.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import timber.log.Timber

/**
 * Compose 性能优化工具类
 *
 * 提供一些通用的性能优化工具和最佳实践
 */
object ComposePerformanceUtils {

    /**
     * 监控 Composable 的重组次数（仅 Debug 环境）
     *
     * 用法：
     * ```kotlin
     * @Composable
     * fun MyScreen() {
     *     RecompositionCounter("MyScreen")
     *     // ... 其他内容
     * }
     * ```
     */
    @Composable
    fun RecompositionCounter(tag: String) {
        if (androidx.compose.ui.platform.BuildConfig.DEBUG) {
            val recompositionCount = remember { androidx.compose.runtime.mutableStateOf(0) }

            SideEffect {
                recompositionCount.value++
                Timber.d("[$tag] Recomposition count: ${recompositionCount.value}")
            }
        }
    }

    /**
     * 测量 Composable 的组合时间（仅 Debug 环境）
     *
     * 用法：
     * ```kotlin
     * @Composable
     * fun MyScreen() {
     *     ComposePerformanceUtils.measureComposition("MyScreen") {
     *         // ... 内容
     *     }
     * }
     * ```
     */
    @Composable
    fun measureComposition(
        tag: String,
        content: @Composable () -> Unit
    ) {
        if (androidx.compose.ui.platform.BuildConfig.DEBUG) {
            val startTime = remember { System.nanoTime() }

            content()

            SideEffect {
                val duration = (System.nanoTime() - startTime) / 1_000_000.0
                Timber.d("[$tag] Composition time: %.2f ms", duration)
            }
        } else {
            content()
        }
    }
}

/**
 * 优化的 Flow 收集，自动去重并转换为 State
 *
 * 相比 collectAsState()，增加了 distinctUntilChanged() 去重
 *
 * 用法：
 * ```kotlin
 * val uiState by viewModel.uiState.collectAsStateDistinct()
 * ```
 */
@Composable
fun <T> Flow<T>.collectAsStateDistinct(
    initial: T,
    context: CoroutineScope = rememberCoroutineScope()
): State<T> {
    return this.distinctUntilChanged().collectAsState(initial = initial)
}

/**
 * 稳定的回调函数包装器
 *
 * 确保传递给子 Composable 的回调函数是稳定的，避免不必要的重组
 *
 * 用法：
 * ```kotlin
 * val onClick = rememberStableCallback { id ->
 *     viewModel.onClick(id)
 * }
 * ```
 */
@Composable
fun <T> rememberStableCallback(callback: (T) -> Unit): (T) -> Unit {
    val latestCallback by rememberUpdatedState(callback)
    return remember {
        { latestCallback(it) }
    }
}

/**
 * 无参数版本的稳定回调
 */
@Composable
fun rememberStableCallback(callback: () -> Unit): () -> Unit {
    val latestCallback by rememberUpdatedState(callback)
    return remember {
        { latestCallback() }
    }
}

/**
 * 延迟计算的派生状态
 *
 * 只有当依赖变化时才重新计算
 *
 * 用法：
 * ```kotlin
 * val filteredList by rememberDerivedState(list, query) {
 *     list.filter { it.contains(query) }
 * }
 * ```
 */
@Composable
fun <T, R> rememberDerivedState(
    vararg inputs: Any?,
    calculation: () -> R
): State<R> {
    return remember(*inputs) {
        derivedStateOf(calculation)
    }
}

/**
 * 性能优化的 LaunchedEffect
 *
 * 添加执行时间监控
 */
@Composable
fun LaunchedEffectWithTiming(
    key1: Any?,
    tag: String,
    block: suspend CoroutineScope.() -> Unit
) {
    LaunchedEffect(key1) {
        if (androidx.compose.ui.platform.BuildConfig.DEBUG) {
            val startTime = System.nanoTime()
            block()
            val duration = (System.nanoTime() - startTime) / 1_000_000.0
            Timber.d("[$tag] LaunchedEffect completed in %.2f ms", duration)
        } else {
            block()
        }
    }
}
