package com.chainlesschain.android.core.ui.performance

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.delay
import timber.log.Timber
import kotlin.math.roundToInt

/**
 * 内存监控工具
 *
 * 用于监控应用的内存使用情况，帮助发现内存泄漏和优化内存占用
 */
class MemoryMonitor(private val context: Context) {

    private val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    private val runtime = Runtime.getRuntime()

    /**
     * 内存信息数据类
     */
    data class MemoryInfo(
        val usedMemoryMB: Double,
        val totalMemoryMB: Double,
        val maxMemoryMB: Double,
        val availableMemoryMB: Double,
        val usedPercentage: Int,
        val nativeHeapSizeMB: Double,
        val nativeHeapAllocatedMB: Double
    )

    /**
     * 获取当前内存信息
     */
    fun getMemoryInfo(): MemoryInfo {
        val usedMemory = (runtime.totalMemory() - runtime.freeMemory()) / MB
        val totalMemory = runtime.totalMemory() / MB
        val maxMemory = runtime.maxMemory() / MB
        val availableMemory = maxMemory - usedMemory
        val usedPercentage = ((usedMemory / maxMemory) * 100).roundToInt()

        // Native 内存（用于监控 Bitmap 等原生内存使用）
        val nativeHeapSize = Debug.getNativeHeapSize() / MB
        val nativeHeapAllocated = Debug.getNativeHeapAllocatedSize() / MB

        return MemoryInfo(
            usedMemoryMB = usedMemory,
            totalMemoryMB = totalMemory,
            maxMemoryMB = maxMemory,
            availableMemoryMB = availableMemory,
            usedPercentage = usedPercentage,
            nativeHeapSizeMB = nativeHeapSize,
            nativeHeapAllocatedMB = nativeHeapAllocated
        )
    }

    /**
     * 获取系统可用内存
     */
    fun getSystemAvailableMemory(): Long {
        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memoryInfo)
        return memoryInfo.availMem / MB.toLong()
    }

    /**
     * 检查是否处于低内存状态
     */
    fun isLowMemory(): Boolean {
        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memoryInfo)
        return memoryInfo.lowMemory
    }

    /**
     * 获取内存阈值（系统认为低内存的阈值）
     */
    fun getMemoryThreshold(): Long {
        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memoryInfo)
        return memoryInfo.threshold / MB.toLong()
    }

    /**
     * 监控内存使用（定期采样）
     *
     * @param intervalMs 采样间隔（毫秒）
     * @return Flow 流，持续输出内存信息
     */
    fun monitorMemory(intervalMs: Long = 1000): Flow<MemoryInfo> = flow {
        while (true) {
            val memoryInfo = getMemoryInfo()
            emit(memoryInfo)

            // 如果内存使用超过 80%，输出警告
            if (memoryInfo.usedPercentage >= 80) {
                Timber.w(
                    "High memory usage: ${memoryInfo.usedPercentage}% " +
                    "(${memoryInfo.usedMemoryMB.format(2)} MB / ${memoryInfo.maxMemoryMB.format(2)} MB)"
                )
            }

            delay(intervalMs)
        }
    }

    /**
     * 触发垃圾回收（仅用于测试，生产环境不建议手动调用）
     */
    fun triggerGC() {
        Timber.d("Triggering garbage collection...")
        System.gc()
        System.runFinalization()
        Timber.d("Garbage collection completed")
    }

    /**
     * 打印内存快照
     */
    fun logMemorySnapshot() {
        val memoryInfo = getMemoryInfo()
        val systemAvailable = getSystemAvailableMemory()
        val isLowMemory = isLowMemory()

        Timber.d(
            """
            Memory Snapshot:
            - Used: ${memoryInfo.usedMemoryMB.format(2)} MB (${memoryInfo.usedPercentage}%)
            - Total: ${memoryInfo.totalMemoryMB.format(2)} MB
            - Max: ${memoryInfo.maxMemoryMB.format(2)} MB
            - Available: ${memoryInfo.availableMemoryMB.format(2)} MB
            - Native Heap: ${memoryInfo.nativeHeapAllocatedMB.format(2)} MB / ${memoryInfo.nativeHeapSizeMB.format(2)} MB
            - System Available: $systemAvailable MB
            - Low Memory: $isLowMemory
            """.trimIndent()
        )
    }

    /**
     * 内存警告级别
     */
    enum class MemoryLevel {
        NORMAL,   // < 60%
        WARNING,  // 60% - 80%
        CRITICAL  // > 80%
    }

    /**
     * 获取内存警告级别
     */
    fun getMemoryLevel(): MemoryLevel {
        val memoryInfo = getMemoryInfo()
        return when {
            memoryInfo.usedPercentage >= 80 -> MemoryLevel.CRITICAL
            memoryInfo.usedPercentage >= 60 -> MemoryLevel.WARNING
            else -> MemoryLevel.NORMAL
        }
    }

    companion object {
        private const val MB = 1024.0 * 1024.0

        /**
         * 格式化 Double 为指定小数位
         */
        private fun Double.format(decimals: Int): String {
            return "%.${decimals}f".format(this)
        }
    }
}

/**
 * Compose 内存监控 Hook
 *
 * 用法：
 * ```kotlin
 * @Composable
 * fun MyScreen() {
 *     val memoryInfo by rememberMemoryMonitor()
 *     Text("Memory: ${memoryInfo.usedPercentage}%")
 * }
 * ```
 */
@androidx.compose.runtime.Composable
fun rememberMemoryMonitor(
    intervalMs: Long = 2000
): androidx.compose.runtime.State<MemoryMonitor.MemoryInfo> {
    val context = androidx.compose.ui.platform.LocalContext.current
    val monitor = androidx.compose.runtime.remember { MemoryMonitor(context) }

    return androidx.compose.runtime.produceState(
        initialValue = monitor.getMemoryInfo(),
        key1 = intervalMs
    ) {
        monitor.monitorMemory(intervalMs).collect { memoryInfo ->
            value = memoryInfo
        }
    }
}
