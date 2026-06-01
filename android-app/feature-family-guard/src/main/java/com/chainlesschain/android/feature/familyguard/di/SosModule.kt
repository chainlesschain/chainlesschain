package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.repository.SosEventRepositoryImpl
import com.chainlesschain.android.feature.familyguard.domain.repository.SosEventRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-40 SOS DI 图。**独立成文件** (不并入并行改动中的 [FamilyGuardBindingsModule])
 * 降冲突面 (同 [AnomalyModule] / [LifecycleModule] / [SnapshotModule] / [TimeModule] /
 * [AuditModule] 策略)。
 *
 * SosEventDao 已由 FamilyGuardModule.provideSosEventDao 提供; SecureRandom (ULID) +
 * TimeAuthority 也已有 binding, SosEventRepositoryImpl 直接 @Inject。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class SosModule {

    @Binds
    @Singleton
    abstract fun bindSosEventRepository(impl: SosEventRepositoryImpl): SosEventRepository
}
