package com.chainlesschain.android.feature.hooks.di

import com.chainlesschain.android.feature.hooks.data.engine.HookExecutor
import com.chainlesschain.android.feature.hooks.data.engine.HookRegistry
import com.chainlesschain.android.feature.hooks.data.repository.HookRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for Hooks feature
 */
@Module
@InstallIn(SingletonComponent::class)
object HooksModule {

    @Provides
    @Singleton
    fun provideHookRepository(): HookRepository {
        return HookRepository()
    }

    @Provides
    @Singleton
    fun provideHookExecutor(
        repository: HookRepository
    ): HookExecutor {
        return HookExecutor(repository)
    }

    @Provides
    @Singleton
    fun provideHookRegistry(
        repository: HookRepository,
        executor: HookExecutor
    ): HookRegistry {
        return HookRegistry(repository, executor)
    }
}
