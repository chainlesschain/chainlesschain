package com.chainlesschain.android.core.common.util

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * 安全扩展函数
 *
 * 提供各种安全操作的扩展函数，防止常见的崩溃和内存泄漏
 */

/**
 * 安全地收集 Flow，自动处理异常
 *
 * @param onError 错误处理回调
 * @param action 收集到数据时的操作
 */
fun <T> Flow<T>.catchSafely(
    onError: ((Throwable) -> Unit)? = null,
    action: suspend (T) -> Unit
): Flow<T> = catch { e ->
    Timber.e(e, "Flow collection error caught")
    onError?.invoke(e)
}

/**
 * 在指定的生命周期状态下安全地收集 Flow
 *
 * 这个扩展函数确保：
 * 1. Flow 只在生命周期处于指定状态时收集
 * 2. 生命周期销毁时自动取消收集
 * 3. 异常被自动捕获和记录
 *
 * 使用示例：
 * ```kotlin
 * viewModel.uiState
 *     .collectSafelyWithLifecycle(
 *         lifecycleOwner = viewLifecycleOwner,
 *         minActiveState = Lifecycle.State.STARTED
 *     ) { state ->
 *         updateUI(state)
 *     }
 * ```
 */
fun <T> Flow<T>.collectSafelyWithLifecycle(
    lifecycleOwner: LifecycleOwner,
    minActiveState: Lifecycle.State = Lifecycle.State.STARTED,
    onError: ((Throwable) -> Unit)? = null,
    action: suspend (T) -> Unit
) {
    lifecycleOwner.lifecycleScope.launch {
        lifecycleOwner.repeatOnLifecycle(minActiveState) {
            try {
                this@collectSafelyWithLifecycle
                    .catch { e ->
                        Timber.e(e, "Flow collection error in lifecycle-aware collection")
                        onError?.invoke(e)
                    }
                    .collect { value ->
                        try {
                            action(value)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            Timber.e(e, "Error in flow collection action")
                            onError?.invoke(e)
                        }
                    }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.e(e, "Error setting up flow collection")
                onError?.invoke(e)
            }
        }
    }
}

/**
 * 安全地执行代码块，捕获所有异常
 *
 * @param onError 错误处理回调
 * @param block 要执行的代码块
 * @return 执行结果，失败时返回 null
 */
inline fun <T> trySafely(
    noinline onError: ((Throwable) -> Unit)? = null,
    block: () -> T
): T? {
    return try {
        block()
    } catch (e: Exception) {
        Timber.e(e, "Safe execution failed")
        onError?.invoke(e)
        null
    }
}

/**
 * 安全地执行挂起代码块
 */
suspend inline fun <T> tryCoSafely(
    noinline onError: ((Throwable) -> Unit)? = null,
    block: suspend () -> T
): T? {
    return try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Timber.e(e, "Safe coroutine execution failed")
        onError?.invoke(e)
        null
    }
}

/**
 * 在协程作用域中安全地启动协程
 *
 * 自动捕获并记录异常，防止未处理的异常导致应用崩溃
 */
fun CoroutineScope.launchSafely(
    onError: ((Throwable) -> Unit)? = null,
    block: suspend CoroutineScope.() -> Unit
) = launch {
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Timber.e(e, "Safe coroutine launch failed")
        onError?.invoke(e)
    }
}

/**
 * 安全地访问可空对象的属性
 *
 * 使用示例：
 * ```kotlin
 * val name = user.safeAccess { it.profile?.name }
 * ```
 */
inline fun <T, R> T?.safeAccess(accessor: (T) -> R?): R? {
    return try {
        this?.let(accessor)
    } catch (e: Exception) {
        Timber.w(e, "Safe access failed")
        null
    }
}

/**
 * 安全地转换对象
 *
 * 如果转换失败，返回 null 而不是抛出异常
 */
inline fun <reified T> Any?.safeCast(): T? {
    return try {
        this as? T
    } catch (e: Exception) {
        Timber.w(e, "Safe cast failed to ${T::class.simpleName}")
        null
    }
}

/**
 * 确保字符串非空且非空白
 */
fun String?.requireNotBlank(lazyMessage: () -> String): String {
    if (this.isNullOrBlank()) {
        throw IllegalArgumentException(lazyMessage())
    }
    return this
}

/**
 * 确保对象非空
 */
fun <T : Any> T?.requireNotNull(lazyMessage: () -> String): T {
    if (this == null) {
        throw IllegalArgumentException(lazyMessage())
    }
    return this
}

/**
 * 安全地获取列表元素
 */
fun <T> List<T>.getOrNull(index: Int): T? {
    return try {
        if (index in indices) this[index] else null
    } catch (e: Exception) {
        Timber.w(e, "Safe list access failed at index $index")
        null
    }
}

/**
 * 安全地关闭可关闭资源
 */
inline fun <T : AutoCloseable?, R> T.useSafely(block: (T) -> R): R? {
    return try {
        use(block)
    } catch (e: Exception) {
        Timber.e(e, "Safe resource usage failed")
        null
    }
}
