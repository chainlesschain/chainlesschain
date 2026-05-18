package com.chainlesschain.android.wear

import android.app.Application
import timber.log.Timber

/**
 * v1.2 #20 P0.2 Wear Phase 0 — Application 入口。
 *
 * Timber Debug tree only — Wear OS 设备屏幕极小，调试 log 走 adb logcat
 * (`adb -s <wear-serial> logcat`)，没必要本机文件 log。
 *
 * Phase 1+ 加 Hilt @HiltAndroidApp 注解（评估必要时）；Phase 0 不引入 DI
 * 框架。
 */
class WearApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
    }
}
