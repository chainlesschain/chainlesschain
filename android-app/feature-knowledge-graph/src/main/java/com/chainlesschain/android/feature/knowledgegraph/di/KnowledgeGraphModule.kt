package com.chainlesschain.android.feature.knowledgegraph.di

import com.chainlesschain.android.feature.knowledgegraph.data.GraphAnalytics
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for knowledge graph feature
 */
@Module
@InstallIn(SingletonComponent::class)
object KnowledgeGraphModule {

    @Provides
    @Singleton
    fun provideGraphAnalytics(): GraphAnalytics {
        return GraphAnalytics()
    }
}
