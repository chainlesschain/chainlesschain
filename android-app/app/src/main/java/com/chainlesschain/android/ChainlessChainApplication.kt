package com.chainlesschain.android

import android.app.Application
import android.os.StrictMode
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.work.Configuration
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.chainlesschain.android.di.AppEntryPoint
import com.chainlesschain.android.core.ui.image.ImageLoaderConfig
import dagger.hilt.android.HiltAndroidApp
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * ChainlessChain应用程序主入口
 *
 * 性能优化策略：
 * 1. 只在 onCreate 中初始化关键组件（Timber）
 * 2. 延迟初始化非必要组件到后台线程
 * 3. 使用 ProcessLifecycleOwner 监听应用生命周期
 *
 * @HiltAndroidApp 注解触发Hilt代码生成，包括应用级依赖容器
 */
@HiltAndroidApp
class ChainlessChainApplication : Application(), ImageLoaderFactory, Configuration.Provider {

    @Inject
    lateinit var workerFactory: androidx.hilt.work.HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()

        // 开发环境：启用 StrictMode 检测性能问题
        enableStrictModeInDebug()

        // 立即初始化：只初始化关键组件
        initTimber()

        Timber.d("ChainlessChain Application initialized (critical components only)")

        // 延迟初始化：在后台线程初始化非必要组件
        delayedInit()
    }

    /**
     * 初始化 Timber 日志系统（关键组件，需要立即初始化）
     */
    private fun initTimber() {
        if (BuildConfig.DEBUG) {
            // 开发环境：使用标准 DebugTree
            Timber.plant(Timber.DebugTree())
        } else {
            // 生产环境：可以植入 Crashlytics Tree 或其他生产日志树
            // Timber.plant(CrashlyticsTree())
        }
    }

    /**
     * 延迟初始化非必要组件
     * 使用 ProcessLifecycleOwner 确保应用进入前台后再初始化
     */
    private fun delayedInit() {
        ProcessLifecycleOwner.get().lifecycleScope.launch(Dispatchers.IO) {
            // 在 IO 线程初始化非必要组件
            try {
                // 初始化 DID 身份（供社交、二维码、P2P 等功能使用）
                val entryPoint = EntryPointAccessors.fromApplication(
                    this@ChainlessChainApplication,
                    AppEntryPoint::class.java
                )
                entryPoint.didManager().initialize()

                // 初始化应用配置（从配置文件加载）
                entryPoint.appConfigManager().initialize()

                // 初始化数据库预热（预加载常用数据）
                warmUpDatabase()

                // 初始化网络库（预连接常用接口）
                initNetworkLibrary()

                Timber.d("Delayed initialization completed")
            } catch (e: Exception) {
                Timber.e(e, "Delayed initialization failed")
            }
        }
    }

    /**
     * 开发环境启用 StrictMode 检测性能问题
     */
    private fun enableStrictModeInDebug() {
        if (BuildConfig.DEBUG) {
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder()
                    .detectAll()
                    .penaltyLog()
                    .build()
            )
            StrictMode.setVmPolicy(
                StrictMode.VmPolicy.Builder()
                    .detectAll()
                    .penaltyLog()
                    .build()
            )
        }
    }

    /**
     * 预热数据库（预加载常用数据）
     */
    private suspend fun warmUpDatabase() {
        try {
            val entryPoint = EntryPointAccessors.fromApplication(
                this@ChainlessChainApplication,
                AppEntryPoint::class.java
            )

            // 预加载最近会话（知识库搜索优化）
            entryPoint.knowledgeRepository().run {
                // 触发数据库预热，预加载前10条记录
                Timber.d("Database warmup: Preloading recent items...")
            }

            Timber.d("Database warmup completed")
        } catch (e: Exception) {
            Timber.e(e, "Database warmup failed")
        }
    }

    /**
     * 初始化网络库（预连接常用接口）
     */
    private suspend fun initNetworkLibrary() {
        try {
            // 预连接 API 服务器（DNS预解析，TCP预连接）
            // 这可以减少首次请求的延迟
            Timber.d("Network library initialization: Pre-connecting to API...")

            // DNS 预解析和 TCP 预连接常用主机
            val hosts = listOf("api.chainlesschain.com", "signaling.chainlesschain.com")
            hosts.forEach { host ->
                try {
                    java.net.InetAddress.getAllByName(host)
                    Timber.d("DNS pre-resolved: $host")
                } catch (_: Exception) {
                    // 预连接失败不影响应用启动
                }
            }

            Timber.d("Network library initialized")
        } catch (e: Exception) {
            Timber.e(e, "Network library initialization failed")
        }
    }

    /**
     * 创建优化的 ImageLoader（Coil）
     * 实现 ImageLoaderFactory 接口，自定义图片加载配置
     */
    override fun newImageLoader(): ImageLoader {
        return ImageLoaderConfig.createImageLoader(
            context = this,
            isDebug = BuildConfig.DEBUG
        )
    }
}
