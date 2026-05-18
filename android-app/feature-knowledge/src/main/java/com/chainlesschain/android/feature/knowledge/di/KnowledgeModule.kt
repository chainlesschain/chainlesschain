package com.chainlesschain.android.feature.knowledge.di

import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.p2p.sync.KnowledgeSyncApplier
import com.chainlesschain.android.feature.knowledge.data.repository.KnowledgeRepository
import com.chainlesschain.android.feature.knowledge.data.sync.KnowledgeSyncApplierImpl
import dagger.Binds
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

/**
 * v1.1 W1：把 KnowledgeSyncApplierImpl 绑到 core-p2p 定义的接口上。
 * 单独 abstract class 因为同一文件 object module 不能用 @Binds。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class KnowledgeSyncModule {
    @Binds
    @Singleton
    abstract fun bindKnowledgeSyncApplier(
        impl: KnowledgeSyncApplierImpl,
    ): KnowledgeSyncApplier
}
