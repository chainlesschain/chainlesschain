package com.chainlesschain.android.feature.knowledge.di

import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.feature.knowledge.data.repository.KnowledgeRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 知识库模块依赖注入
 */
@Module
@InstallIn(SingletonComponent::class)
object KnowledgeModule {

    @Provides
    @Singleton
    fun provideKnowledgeRepository(
        knowledgeItemDao: KnowledgeItemDao
    ): KnowledgeRepository {
        return KnowledgeRepository(knowledgeItemDao)
    }
}
