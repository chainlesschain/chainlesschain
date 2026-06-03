package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.dao.AuditLogDao
import com.chainlesschain.android.feature.familyguard.data.repository.AuditLogRepositoryImpl
import com.chainlesschain.android.feature.familyguard.domain.repository.AuditLogRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-63 审计日志 DI 图。**独立成文件** (不并入并行改动中的 [FamilyGuardBindingsModule])
 * 降冲突面 (同 [AnomalyModule] / [LifecycleModule] / [SnapshotModule] / [TimeModule] 策略)。
 *
 * DataLifecycleAuditLogger 的真实绑定 (NoOp → AuditLogDataLifecycleLogger) 在 [LifecycleModule]
 * 切换 (避免同一接口双绑定冲突)。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class AuditModule {

    @Binds
    @Singleton
    abstract fun bindAuditLogRepository(impl: AuditLogRepositoryImpl): AuditLogRepository

    companion object {

        @Provides
        @Singleton
        fun provideAuditLogDao(db: FamilyGuardDatabase): AuditLogDao = db.auditLogDao()
    }
}
