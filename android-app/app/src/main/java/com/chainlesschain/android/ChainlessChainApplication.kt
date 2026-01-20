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
            // 开发环境：打印详细日志
            Timber.plant(ChainlessDebugTree())
        } else {
            // 生产环境：只记录ERROR级别日志
            Timber.plant(ReleaseTree())
        }
    }
}

/**
 * 自定义Debug日志树
 */
private class ChainlessDebugTree : Timber.DebugTree() {
    override fun createStackElementTag(element: StackTraceElement): String {
        // 自定义Tag格式：类名:方法名:行号
        return String.format(
            "[%s:%s:%s]",
            super.createStackElementTag(element),
            element.methodName,
            element.lineNumber
        )
    }
}

/**
 * 生产环境日志树
 */
private class ReleaseTree : Timber.Tree() {
    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        if (priority >= android.util.Log.ERROR) {
            // TODO: 发送到崩溃报告服务（如Firebase Crashlytics）
            // crashlytics.log(message)
            // if (t != null) crashlytics.recordException(t)
        }
    }
}
