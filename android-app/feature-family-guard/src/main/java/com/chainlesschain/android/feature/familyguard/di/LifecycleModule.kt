package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.audit.AuditLogDataLifecycleLogger
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecycleAuditLogger
import com.chainlesschain.android.feature.familyguard.domain.lifecycle.DataLifecyclePolicy
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-28 数据生命周期 DI 图。**独立成文件** (不并入 [FamilyGuardBindingsModule]) 以
 * 减少与并行改动的合并冲突面 (同 [AnomalyModule] 策略)。
 *
 * DataLifecycleAuditLogger 已切到 FAMILY-63 [AuditLogDataLifecycleLogger] (写不可删
 * audit_log); NoOpDataLifecycleAuditLogger 类保留作无 audit 宿主的可选 fallback。
 * DataLifecycleCleaner / Scheduler 走 @Inject constructor (DAO / Context 已有 binding),
 * 无需在此显式声明。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class LifecycleModule {

    @Binds
    @Singleton
    abstract fun bindDataLifecycleAuditLogger(
        impl: AuditLogDataLifecycleLogger,
    ): DataLifecycleAuditLogger

    companion object {

        /** v0 默认保留期 (主文档 §4.6); 家长可配 / 云端下发留后续。 */
        @Provides
        @Singleton
        fun provideDataLifecyclePolicy(): DataLifecyclePolicy = DataLifecyclePolicy()
    }
}
