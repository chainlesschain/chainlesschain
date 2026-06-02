package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.time.CristianTimeAuthority
import com.chainlesschain.android.feature.familyguard.data.time.SystemMonotonicClock
import com.chainlesschain.android.feature.familyguard.domain.time.MonotonicClock
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
 * [com.chainlesschain.android.feature.familyguard.domain.time.ParentTimeSource]
 * **不在此绑定** —— feature-family-guard 不依赖 :core-p2p / SignalClient 传输。真实 P2P
 * 拉取适配器 (P2PParentTimeSource) 在 :app ParentTimeModule 绑定 (NoOpParentTimeSource 类
 * 保留, 供无 P2P 的宿主可选 fallback); 同 TelemetryOutbox 的 seam 模式。java.time.Clock
 * (墙钟) 已由 FamilyGuardModule 提供, CristianTimeAuthority 直接注入。
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
}
