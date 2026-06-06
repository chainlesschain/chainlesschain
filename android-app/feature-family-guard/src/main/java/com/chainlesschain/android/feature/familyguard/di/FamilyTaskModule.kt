package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyTaskDao
import com.chainlesschain.android.feature.familyguard.data.repository.FamilyTaskRepositoryImpl
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * M5 family_task DI 图 (主文档 §3.5)。
 *
 * 独立成文件 (不并入 [FamilyGuardBindingsModule]) 以减少并行 ticket 的合并冲突面。
 * Clock 复用 [FamilyGuardModule.provideClock]。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class FamilyTaskModule {

    @Binds
    @Singleton
    abstract fun bindFamilyTaskRepository(impl: FamilyTaskRepositoryImpl): FamilyTaskRepository

    companion object {

        @Provides
        @Singleton
        fun provideFamilyTaskDao(db: FamilyGuardDatabase): FamilyTaskDao = db.familyTaskDao()
    }
}
