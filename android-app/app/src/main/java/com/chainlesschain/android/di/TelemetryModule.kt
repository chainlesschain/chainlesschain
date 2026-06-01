package com.chainlesschain.android.di

import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryOutbox
import com.chainlesschain.android.telemetry.SyncManagerTelemetryOutbox
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-26: 在 :app 层把 telemetry 上行 outbox 绑到真实 [SyncManagerTelemetryOutbox]
 * (走 :core-p2p SyncManager)。
 *
 * feature-family-guard 不依赖 :core-p2p, 只定义 [TelemetryOutbox] 端口且不再提供默认
 * 绑定 (NoOpTelemetryOutbox 仍在, 供无 sync 的宿主可选)。:app 同时依赖
 * feature-family-guard + core-p2p, 是接通真实上行的唯一合适层。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class TelemetryModule {

    @Binds
    @Singleton
    abstract fun bindTelemetryOutbox(
        impl: SyncManagerTelemetryOutbox,
    ): TelemetryOutbox
}
