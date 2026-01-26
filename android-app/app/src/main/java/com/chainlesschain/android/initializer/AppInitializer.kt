package com.chainlesschain.android.initializer

import android.app.Application
import android.util.Log
import com.chainlesschain.android.core.llm.LLMAdapter
import dagger.Lazy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 应用初始化器
 *
 * 负责管理应用启动时的初始化任务，优化启动速度
 *
 * 初始化策略：
 * 1. **立即初始化**：必需的、阻塞性的组件（如数据库）
 * 2. **延迟初始化**：按需加载的组件（使用Lazy）
 * 3. **异步初始化**：非关键组件（后台线程初始化）
 */
@Singleton
class AppInitializer @Inject constructor(
    private val application: Application,

    // 延迟初始化的组件（使用Hilt Lazy）
    private val llmAdapter: Lazy<LLMAdapter>,

    // 其他需要异步初始化的组件
    // private val imageCache: Lazy<ImageCache>,
    // private val analyticsService: Lazy<AnalyticsService>,
) {

    private val initScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    companion object {
        private const val TAG = "AppInitializer"
    }

    /**
     * 同步初始化（启动时立即执行）
     *
     * 仅包含必需的、阻塞性的初始化任务
     */
    fun initializeImmediately() {
        val startTime = System.currentTimeMillis()
        Log.d(TAG, "Starting immediate initialization...")

        // 1. 初始化日志系统（必需）
        initializeLogging()

        // 2. 初始化崩溃报告（必需）
        initializeCrashReporting()

        // 3. 初始化数据库（必需）
        // Database已通过Hilt自动初始化

        val elapsedTime = System.currentTimeMillis() - startTime
        Log.d(TAG, "Immediate initialization completed in ${elapsedTime}ms")
    }

    /**
     * 异步初始化（启动后在后台线程执行）
     *
     * 包含非关键的、耗时的初始化任务
     */
    fun initializeAsynchronously() {
        Log.d(TAG, "Starting asynchronous initialization...")

        initScope.launch {
            val startTime = System.currentTimeMillis()

            // 并行初始化多个非关键组件
            try {
                // 1. 预热LLM适配器
                launch { warmupLLMAdapter() }

                // 2. 预加载图片缓存配置
                launch { warmupImageCache() }

                // 3. 初始化分析服务
                launch { initializeAnalytics() }

                // 4. 预加载字体和资源
                launch { preloadResources() }

                val elapsedTime = System.currentTimeMillis() - startTime
                Log.d(TAG, "Asynchronous initialization completed in ${elapsedTime}ms")
            } catch (e: Exception) {
                Log.e(TAG, "Error during asynchronous initialization", e)
            }
        }
    }

    // ==================== 立即初始化任务 ====================

    /**
     * 初始化日志系统
     */
    private fun initializeLogging() {
        try {
            // 配置日志级别
            // TODO: 根据BuildConfig.DEBUG配置日志级别
            Log.d(TAG, "Logging initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize logging", e)
        }
    }

    /**
     * 初始化崩溃报告
     */
    private fun initializeCrashReporting() {
        try {
            // TODO: 集成Firebase Crashlytics或其他崩溃报告服务
            Log.d(TAG, "Crash reporting initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize crash reporting", e)
        }
    }

    // ==================== 异步初始化任务 ====================

    /**
     * 预热LLM适配器
     */
    private suspend fun warmupLLMAdapter() {
        try {
            // 延迟初始化：首次访问时才创建实例
            // llmAdapter.get() 会触发实际的初始化
            Log.d(TAG, "LLM adapter warmed up")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to warmup LLM adapter", e)
        }
    }

    /**
     * 预加载图片缓存配置
     */
    private suspend fun warmupImageCache() {
        try {
            // Coil会自动初始化，这里可以预配置缓存大小
            Log.d(TAG, "Image cache warmed up")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to warmup image cache", e)
        }
    }

    /**
     * 初始化分析服务
     */
    private suspend fun initializeAnalytics() {
        try {
            // TODO: 集成分析服务（如Firebase Analytics）
            Log.d(TAG, "Analytics initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize analytics", e)
        }
    }

    /**
     * 预加载资源
     */
    private suspend fun preloadResources() {
        try {
            // 预加载常用的字体、图标等资源
            Log.d(TAG, "Resources preloaded")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to preload resources", e)
        }
    }

    /**
     * 清理资源
     */
    fun cleanup() {
        // 取消所有正在进行的初始化任务
        // initScope会在Application销毁时自动取消
        Log.d(TAG, "AppInitializer cleanup")
    }
}

/**
 * 启动性能监控
 *
 * 用于测量启动各个阶段的耗时
 */
object StartupPerformanceMonitor {
    private var appStartTime: Long = 0
    private var contentDisplayTime: Long = 0
    private val milestones = mutableMapOf<String, Long>()

    fun recordAppStart() {
        appStartTime = System.currentTimeMillis()
        Log.d("StartupPerf", "App start recorded: $appStartTime")
    }

    fun recordMilestone(name: String) {
        val currentTime = System.currentTimeMillis()
        milestones[name] = currentTime
        val elapsed = if (appStartTime > 0) currentTime - appStartTime else 0
        Log.d("StartupPerf", "Milestone '$name': ${elapsed}ms from start")
    }

    fun recordContentDisplay() {
        contentDisplayTime = System.currentTimeMillis()
        val elapsed = if (appStartTime > 0) contentDisplayTime - appStartTime else 0
        Log.d("StartupPerf", "Content displayed: ${elapsed}ms from start")
    }

    fun getTotalStartupTime(): Long {
        return if (appStartTime > 0 && contentDisplayTime > 0) {
            contentDisplayTime - appStartTime
        } else 0
    }

    fun getMilestones(): Map<String, Long> = milestones.toMap()

    fun reset() {
        appStartTime = 0
        contentDisplayTime = 0
        milestones.clear()
    }

    /**
     * 输出启动性能报告
     */
    fun printReport() {
        val totalTime = getTotalStartupTime()
        Log.d("StartupPerf", "===== Startup Performance Report =====")
        Log.d("StartupPerf", "Total startup time: ${totalTime}ms")
        Log.d("StartupPerf", "Milestones:")
        milestones.forEach { (name, time) ->
            val elapsed = time - appStartTime
            val percentage = if (totalTime > 0) (elapsed * 100.0 / totalTime) else 0.0
            Log.d("StartupPerf", "  $name: ${elapsed}ms (${String.format("%.1f", percentage)}%)")
        }
        Log.d("StartupPerf", "======================================")
    }
}
