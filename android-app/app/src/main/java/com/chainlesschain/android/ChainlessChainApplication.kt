package com.chainlesschain.android

import android.app.Application
import android.os.StrictMode
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.chainlesschain.android.core.ui.image.ImageLoaderConfig
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import timber.log.Timber

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
class ChainlessChainApplication : Application(), ImageLoaderFactory {

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
                // TODO: 初始化应用配置（从配置文件加载）
                // initAppConfig()

                // TODO: 初始化数据库预热
                // warmUpDatabase()

                // TODO: 初始化网络库
                // initNetworkLibrary()

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
