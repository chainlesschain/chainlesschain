package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.anomaly.NoOpGuardianAnomalyNotifier
import com.chainlesschain.android.feature.familyguard.data.dao.AnomalyDao
import com.chainlesschain.android.feature.familyguard.data.repository.AnomalyRepositoryImpl
import com.chainlesschain.android.feature.familyguard.domain.anomaly.AnomalyConfig
import com.chainlesschain.android.feature.familyguard.domain.anomaly.GuardianAnomalyNotifier
import com.chainlesschain.android.feature.familyguard.domain.repository.AnomalyRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-27 AnomalyDetector DI 图。
 *
 * **独立成文件** (不并入 [FamilyGuardBindingsModule]) 是为了减少与并行 telemetry-outbox
 * 改动的合并冲突面; Hilt 允许多 @Module, @Binds (抽象) + @Provides (companion object)
 * 同居一类。新增异常相关 binding 都加到这里。
 *
 * GuardianAnomalyNotifier 默认 [NoOpGuardianAnomalyNotifier]; :app 层 FAMILY-61 提供
 * 接 PushVendor + 上行高优的真实适配器覆盖。AnomalyDetector 自身走 @Inject constructor
 * (ZoneId 注入), 无需在此显式 @Binds/@Provides。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class AnomalyModule {

    @Binds
    @Singleton
    abstract fun bindAnomalyRepository(impl: AnomalyRepositoryImpl): AnomalyRepository

    @Binds
    @Singleton
    abstract fun bindGuardianAnomalyNotifier(
        impl: NoOpGuardianAnomalyNotifier,
    ): GuardianAnomalyNotifier

    companion object {

        @Provides
        @Singleton
        fun provideAnomalyDao(db: FamilyGuardDatabase): AnomalyDao = db.anomalyDao()

        /** v0 默认阈值/名单; 家长端按家庭规则覆盖留 FAMILY-12/17 后续接通。 */
        @Provides
        @Singleton
        fun provideAnomalyConfig(): AnomalyConfig = AnomalyConfig()
    }
}
