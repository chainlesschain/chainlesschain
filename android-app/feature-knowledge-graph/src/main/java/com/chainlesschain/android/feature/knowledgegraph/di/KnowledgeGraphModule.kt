package com.chainlesschain.android.feature.knowledgegraph.di

import com.chainlesschain.android.feature.knowledgegraph.data.GraphAnalytics
import com.chainlesschain.android.feature.knowledgegraph.data.manager.GraphManager
import com.chainlesschain.android.feature.knowledgegraph.data.repository.GraphRepository
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

    @Provides
    @Singleton
    fun provideGraphRepository(): GraphRepository {
        return GraphRepository()
    }

    @Provides
    @Singleton
    fun provideGraphManager(
        graphRepository: GraphRepository,
        graphAnalytics: GraphAnalytics
    ): GraphManager {
        return GraphManager(graphRepository, graphAnalytics)
    }
}
