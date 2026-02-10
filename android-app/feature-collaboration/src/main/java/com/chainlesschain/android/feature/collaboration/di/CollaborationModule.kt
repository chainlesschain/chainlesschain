package com.chainlesschain.android.feature.collaboration.di

import com.chainlesschain.android.feature.collaboration.data.manager.CollaborationManager
import com.chainlesschain.android.feature.collaboration.data.repository.CollaborationRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for Collaboration feature
 */
@Module
@InstallIn(SingletonComponent::class)
object CollaborationModule {

    @Provides
    @Singleton
    fun provideCollaborationRepository(): CollaborationRepository {
        return CollaborationRepository()
    }

    @Provides
    @Singleton
    fun provideCollaborationManager(
        repository: CollaborationRepository
    ): CollaborationManager {
        return CollaborationManager(repository)
    }
}
