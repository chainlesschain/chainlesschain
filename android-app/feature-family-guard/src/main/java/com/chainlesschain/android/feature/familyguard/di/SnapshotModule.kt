package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.telemetry.SnapshotTelemetrySource
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySource
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet

/**
 * FAMILY-22 Plan C snapshot 源 DI。**独立成文件** (不并入并行改动中的
 * [FamilyGuardBindingsModule]) 降冲突面 (同 [AnomalyModule] / [LifecycleModule] 策略)。
 *
 * `@IntoSet` 把 [SnapshotTelemetrySource] 并入 dispatcher 注入的 `Set<TelemetrySource>`,
 * 与 ForegroundAppTelemetrySource 并列被 CentralTelemetryDispatcher 自动订阅; impl
 * 已 @Singleton, 故 set 元素与 :app 侧采集器 submit 时拿到的是同一实例。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class SnapshotModule {

    @Binds
    @IntoSet
    abstract fun bindSnapshotTelemetrySource(
        impl: SnapshotTelemetrySource,
    ): TelemetrySource
}
