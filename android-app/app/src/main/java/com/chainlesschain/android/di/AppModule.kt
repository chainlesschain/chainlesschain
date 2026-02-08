package com.chainlesschain.android.di

import android.app.Application
import android.content.Context
import com.chainlesschain.android.config.AppConfigManager
import com.chainlesschain.android.core.network.config.NetworkConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 应用级依赖注入模块
 *
 * @InstallIn(SingletonComponent::class) 表示此模块中的依赖在应用生命周期内单例
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    /**
     * 提供应用Context
     */
    @Provides
    @Singleton
    fun provideContext(application: Application): Context {
        return application.applicationContext
    }

    /**
     * 提供 NetworkConfig，桥接 AppConfigManager 到 core-network 模块
     */
    @Provides
    @Singleton
    fun provideNetworkConfig(appConfigManager: AppConfigManager): NetworkConfig {
        return object : NetworkConfig {
            override val apiBaseUrl: String
                get() = appConfigManager.config.value.apiBaseUrl
            override val requestTimeoutMs: Long
                get() = appConfigManager.config.value.requestTimeout
        }
    }
}
