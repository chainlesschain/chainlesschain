package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.time.CristianTimeAuthority
import com.chainlesschain.android.feature.familyguard.data.time.NoOpParentTimeSource
import com.chainlesschain.android.feature.familyguard.data.time.SystemMonotonicClock
import com.chainlesschain.android.feature.familyguard.domain.time.MonotonicClock
import com.chainlesschain.android.feature.familyguard.domain.time.ParentTimeSource
import com.chainlesschain.android.feature.familyguard.domain.time.TimeAuthority
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-60 TimeAuthority DI 图。**独立成文件** (不并入并行改动中的
 * [FamilyGuardBindingsModule]) 降冲突面 (同 [AnomalyModule] / [LifecycleModule] /
 * [SnapshotModule] 策略)。
 *
 * ParentTimeSource 默认 [NoOpParentTimeSource] (家长端不可达 → NEVER_SYNCED); :app 层
 * 提供接 P2P family.time.* 的真实拉取覆盖。java.time.Clock (墙钟) 已由 FamilyGuardModule
 * 提供, CristianTimeAuthority 直接注入。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class TimeModule {

    @Binds
    @Singleton
    abstract fun bindTimeAuthority(impl: CristianTimeAuthority): TimeAuthority

    @Binds
    @Singleton
    abstract fun bindMonotonicClock(impl: SystemMonotonicClock): MonotonicClock

    @Binds
    @Singleton
    abstract fun bindParentTimeSource(impl: NoOpParentTimeSource): ParentTimeSource
}
