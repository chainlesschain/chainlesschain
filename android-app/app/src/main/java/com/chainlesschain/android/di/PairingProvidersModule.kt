package com.chainlesschain.android.di

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.chainlesschain.android.feature.p2p.viewmodel.PairingClock
import com.chainlesschain.android.feature.p2p.viewmodel.PairingCodeGenerator
import com.chainlesschain.android.feature.p2p.viewmodel.PairingDeviceInfoProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * v1.1 issue #19 W6：feature-p2p [DesktopPairingViewModel] 依赖的 3 个 interface
 * 的 Hilt @Provides。
 *
 * **设计取舍**：3 个 interface 在 feature-p2p 模块定义，但 Android 真实 impl 需要
 * `Settings.Secure.ANDROID_ID` + `Build.MODEL` 等 framework API，不能在 feature-p2p
 * 里实现（feature-p2p 不依赖 :app）。本 module 在 :app 提供 production impl，
 * 同时保留 interface 让 feature-p2p 单测可注入 fake。
 *
 * 与 issue #19 W3.1+W3.2 (4dffc43bd parallel session) 配套 —— 把 ViewModel
 * Hilt-injectable 的最后一公里。
 */
@Module
@InstallIn(SingletonComponent::class)
object PairingProvidersModule {

    @Provides
    @Singleton
    fun providePairingDeviceInfoProvider(
        @ApplicationContext context: Context,
    ): PairingDeviceInfoProvider = AndroidPairingDeviceInfoProvider(context)

    @Provides
    @Singleton
    fun providePairingClock(): PairingClock = PairingClock.System

    @Provides
    @Singleton
    fun providePairingCodeGenerator(): PairingCodeGenerator = PairingCodeGenerator.Random
}

/**
 * Production 设备信息 — `Settings.Secure.ANDROID_ID` + `Build.MODEL` + 平台名 "android"。
 * ANDROID_ID 自 Android 8.0+ 是 per-app per-user 稳定值，适合作为 device 标识；不是 IMEI/MAC
 * 等隐私敏感字段。
 */
private class AndroidPairingDeviceInfoProvider(
    private val context: Context,
) : PairingDeviceInfoProvider {

    override fun deviceId(): String =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            ?: "unknown-android-id"

    override fun name(): String = Build.MODEL ?: "unknown-model"

    override fun platform(): String = "android"
}
