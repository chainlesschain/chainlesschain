package com.chainlesschain.android.di

import com.chainlesschain.android.capture.location.AndroidFusedLocationProvider
import com.chainlesschain.android.capture.location.LocationProvider
import com.chainlesschain.android.capture.location.LocationTagger
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Singleton

/**
 * M3 D2 LocationTagger Hilt 接线。
 *
 * - [LocationProvider] 绑到 [AndroidFusedLocationProvider]（@Inject @Singleton concrete）。
 * - [LocationTagger] 用 @Provides 注入因为它是 non-@Inject class（be6cb4974 落地的 JVM-纯
 *   构造，构造参数含外部传入 scope）。这里建一个 SupervisorJob() + Dispatchers.Default
 *   的 application-scoped scope 给它。
 */
@Module
@InstallIn(SingletonComponent::class)
object LocationModule {

    @Provides
    @Singleton
    fun provideLocationProvider(impl: AndroidFusedLocationProvider): LocationProvider = impl

    @Provides
    @Singleton
    fun provideLocationTagger(provider: LocationProvider): LocationTagger {
        // Application-scoped supervisor scope —— LocationForegroundService 生命周期内不取消，
        // 进程结束自然清理。Job 隔离子 collect 失败不波及其它 Hilt singleton。
        val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        return LocationTagger(provider, scope)
    }
}
