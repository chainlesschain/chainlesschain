package com.chainlesschain.android.di

import com.chainlesschain.android.push.vendor.ManufacturerProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * v1.1 issue #19 P1：[ManufacturerProvider] DI binding。
 *
 * Kotlin 默认参数 (`= ManufacturerProvider.System`) 在 @Inject constructor 上 Hilt
 * 不识别，必须显式 @Provides。Tests 用 fake provider 直接 new ctor，不走 Hilt。
 */
@Module
@InstallIn(SingletonComponent::class)
object PushVendorModule {

    @Provides
    @Singleton
    fun provideManufacturerProvider(): ManufacturerProvider = ManufacturerProvider.System
}
