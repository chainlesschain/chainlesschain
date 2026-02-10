package com.chainlesschain.android.feature.performance.di

import android.content.Context
import com.chainlesschain.android.feature.performance.data.cache.CacheManager
import com.chainlesschain.android.feature.performance.data.monitor.PerformanceMonitor
import com.chainlesschain.android.feature.performance.data.repository.PerformanceRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for Performance feature
 */
@Module
@InstallIn(SingletonComponent::class)
object PerformanceModule {

    @Provides
    @Singleton
    fun providePerformanceRepository(): PerformanceRepository {
        return PerformanceRepository()
    }

    @Provides
    @Singleton
    fun providePerformanceMonitor(
        @ApplicationContext context: Context,
        repository: PerformanceRepository
    ): PerformanceMonitor {
        return PerformanceMonitor(context, repository)
    }

    @Provides
    @Singleton
    fun provideCacheManager(
        repository: PerformanceRepository
    ): CacheManager {
        return CacheManager(repository)
    }
}
