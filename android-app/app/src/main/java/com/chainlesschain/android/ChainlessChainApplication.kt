package com.chainlesschain.android

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import timber.log.Timber

/**
 * ChainlessChain应用程序主入口
 *
 * @HiltAndroidApp 注解触发Hilt代码生成，包括应用级依赖容器
 */
@HiltAndroidApp
class ChainlessChainApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // 初始化Timber日志系统
        initTimber()

        // 初始化应用配置（从配置文件加载）
        // TODO: initAppConfig()

        Timber.d("ChainlessChain Application initialized")
    }

    private fun initTimber() {
        if (BuildConfig.DEBUG) {
            // 开发环境：使用标准 DebugTree
            Timber.plant(Timber.DebugTree())
        }
        // 生产环境：不植入任何日志树（静默）
    }
}
