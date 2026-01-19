package com.chainlesschain.android.core.performance

import android.os.Build
import android.os.StrictMode
import timber.log.Timber

/**
 * 性能监控工具
 *
 * 功能:
 * 1. StrictMode检测 - 开发环境检测主线程IO和内存泄露
 * 2. 启动时间追踪
 * 3. 内存监控
 * 4. 帧率监控
 */
object PerformanceMonitor {

    /**
     * 初始化性能监控
     * 仅在Debug模式启用
     */
    fun init(isDebug: Boolean) {
        if (isDebug) {
            enableStrictMode()
            Timber.d("PerformanceMonitor initialized")
        }
    }

    /**
     * 启用StrictMode检测
     * 检测主线程IO操作、内存泄露等问题
     */
    private fun enableStrictMode() {
        StrictMode.setThreadPolicy(
            StrictMode.ThreadPolicy.Builder()
                .detectAll()  // 检测所有线程违规
                .penaltyLog() // 记录到logcat
                .build()
        )

        StrictMode.setVmPolicy(
            StrictMode.VmPolicy.Builder()
                .detectAll()  // 检测所有VM违规
                .penaltyLog() // 记录到logcat
                .build()
        )
    }

    /**
     * 追踪启动时间
     */
    class StartupTimer {
        private val startTime = System.currentTimeMillis()

        fun logMilestone(milestone: String) {
            val elapsed = System.currentTimeMillis() - startTime
            Timber.d("Startup milestone: $milestone at ${elapsed}ms")
        }

        fun finish() {
            val totalTime = System.currentTimeMillis() - startTime
            Timber.i("App startup completed in ${totalTime}ms")
        }
    }

    /**
     * 内存监控
     */
    fun logMemoryUsage(tag: String = "Memory") {
        val runtime = Runtime.getRuntime()
        val usedMemory = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        val maxMemory = runtime.maxMemory() / 1024 / 1024
        val availableMemory = maxMemory - usedMemory

        Timber.d("$tag - Used: ${usedMemory}MB, Available: ${availableMemory}MB, Max: ${maxMemory}MB")
    }
}
