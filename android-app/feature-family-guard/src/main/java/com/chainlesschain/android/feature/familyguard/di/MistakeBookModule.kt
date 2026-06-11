package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.dao.GuardrailEventDao
import com.chainlesschain.android.feature.familyguard.data.dao.MistakeBookDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * M6 mistake_book + guardrail_event DI 图 (主文档 §3.6)。
 *
 * 独立成文件 (同 [FamilyTaskModule]/[PointsLedgerModule] 取向) 以减少并行
 * ticket 的合并冲突面。接口与实现在 :app/presentation/aistudy。
 */
@Module
@InstallIn(SingletonComponent::class)
object MistakeBookModule {

    @Provides
    @Singleton
    fun provideMistakeBookDao(db: FamilyGuardDatabase): MistakeBookDao = db.mistakeBookDao()

    @Provides
    @Singleton
    fun provideGuardrailEventDao(db: FamilyGuardDatabase): GuardrailEventDao = db.guardrailEventDao()
}
