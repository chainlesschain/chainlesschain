package com.chainlesschain.android.di

import android.app.Application
import android.content.Context
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
}
