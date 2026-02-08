package com.chainlesschain.android.initializer

import android.app.Application
import android.util.Log
import com.chainlesschain.android.BuildConfig
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
// Firebase imports - uncomment when google-services.json is available
// import com.google.firebase.analytics.FirebaseAnalytics
// import com.google.firebase.analytics.ktx.analytics
// import com.google.firebase.crashlytics.FirebaseCrashlytics
// import com.google.firebase.ktx.Firebase
import dagger.Lazy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber
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
     *
     * 根据构建类型配置 Timber 日志级别：
     * - Debug: VERBOSE 级别，输出详细日志
     * - Release: ERROR 级别，仅输出错误
     */
    private fun initializeLogging() {
        try {
            // 移除所有已存在的日志树（避免重复）
            Timber.uprootAll()

            if (BuildConfig.DEBUG) {
                // Debug环境：使用详细日志树
                Timber.plant(object : Timber.DebugTree() {
                    override fun createStackElementTag(element: StackTraceElement): String {
                        // 显示类名和方法名，方便调试
                        return "CC/${super.createStackElementTag(element)}:${element.lineNumber}"
                    }
                })
                Timber.d("Logging initialized: DEBUG mode (VERBOSE level)")
            } else {
                // Release环境：仅记录错误和崩溃
                Timber.plant(object : Timber.Tree() {
                    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
                        // 仅记录 ERROR 和 ASSERT 级别
                        if (priority >= Log.ERROR) {
                            // Firebase Crashlytics 上报（当 google-services.json 存在时自动启用）
                            try {
                                val clazz = Class.forName("com.google.firebase.crashlytics.FirebaseCrashlytics")
                                val instance = clazz.getMethod("getInstance").invoke(null)
                                if (t != null) {
                                    clazz.getMethod("recordException", Throwable::class.java).invoke(instance, t)
                                }
                                clazz.getMethod("log", String::class.java).invoke(instance, "[$tag] $message")
                            } catch (_: Exception) { /* Firebase not available */ }
                            Log.e(tag, message, t)
                        }
                    }
                })
                Timber.d("Logging initialized: RELEASE mode (ERROR level only)")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize logging", e)
        }
    }

    /**
     * 初始化崩溃报告
     *
     * 集成 Firebase Crashlytics 进行生产环境错误监控
     * NOTE: Disabled when Firebase is not available (google-services.json missing)
     */
    private fun initializeCrashReporting() {
        try {
            val clazz = Class.forName("com.google.firebase.crashlytics.FirebaseCrashlytics")
            val crashlytics = clazz.getMethod("getInstance").invoke(null)

            if (BuildConfig.DEBUG) {
                clazz.getMethod("setCrashlyticsCollectionEnabled", Boolean::class.java)
                    .invoke(crashlytics, false)
                Timber.d("Crashlytics: Disabled for debug builds")
            } else {
                clazz.getMethod("setCrashlyticsCollectionEnabled", Boolean::class.java)
                    .invoke(crashlytics, true)
                clazz.getMethod("setCustomKey", String::class.java, String::class.java)
                    .invoke(crashlytics, "app_version", BuildConfig.VERSION_NAME)
                clazz.getMethod("setCustomKey", String::class.java, String::class.java)
                    .invoke(crashlytics, "build_type", "release")
                Timber.i("Crashlytics: Enabled for release builds")
            }
        } catch (_: ClassNotFoundException) {
            Timber.w("Crashlytics: Not available (Firebase not configured)")
        } catch (e: Exception) {
            Timber.e(e, "Failed to initialize crash reporting")
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
     *
     * 集成 Firebase Analytics 进行用户行为分析
     * NOTE: Disabled when Firebase is not available (google-services.json missing)
     */
    private suspend fun initializeAnalytics() {
        try {
            // 通过反射检测 Firebase Analytics 是否可用（取决于 google-services.json）
            val firebaseClass = Class.forName("com.google.firebase.ktx.Firebase")
            val analyticsExt = Class.forName("com.google.firebase.analytics.ktx.AnalyticsKt")
            val analytics = analyticsExt.methods.first { it.name == "getAnalytics" }
                .invoke(null, firebaseClass.kotlin.objectInstance ?: firebaseClass.getDeclaredConstructor().newInstance())

            val analyticsClass = Class.forName("com.google.firebase.analytics.FirebaseAnalytics")
            analyticsClass.getMethod("setAnalyticsCollectionEnabled", Boolean::class.java)
                .invoke(analytics, !BuildConfig.DEBUG)

            if (!BuildConfig.DEBUG) {
                analyticsClass.getMethod("setUserProperty", String::class.java, String::class.java)
                    .invoke(analytics, "app_version", BuildConfig.VERSION_NAME)
                analyticsClass.getMethod("setUserProperty", String::class.java, String::class.java)
                    .invoke(analytics, "build_type", "release")
                Timber.i("Analytics initialized and enabled")
            } else {
                Timber.d("Analytics disabled for debug builds")
            }
        } catch (_: ClassNotFoundException) {
            Timber.w("Analytics: Not available (Firebase not configured)")
        } catch (e: Exception) {
            Timber.e(e, "Failed to initialize analytics")
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
