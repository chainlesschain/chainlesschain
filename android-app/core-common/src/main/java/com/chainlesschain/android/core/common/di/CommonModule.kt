package com.chainlesschain.android.core.common.di

import android.app.Application
import com.chainlesschain.android.core.common.memory.MemoryManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Core Common Module - Dependency Injection
 *
 * Provides core common utilities including memory management.
 */
@Module
@InstallIn(SingletonComponent::class)
object CommonModule {

    /**
     * Provide Memory Manager
     */
    @Provides
    @Singleton
    fun provideMemoryManager(
        application: Application
    ): MemoryManager {
        return MemoryManager(application)
    }
}
