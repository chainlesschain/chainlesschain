package com.chainlesschain.android.di

import com.chainlesschain.android.familyguard.time.P2PParentTimeSource
import com.chainlesschain.android.feature.familyguard.domain.time.ParentTimeSource
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-60: 在 :app 层把 [ParentTimeSource] 绑到真实 P2P 拉取 [P2PParentTimeSource]
 * （经 :app FamilyTimeRpcClient + :core-p2p PairedPeersStore）。
 *
 * feature-family-guard 不依赖 :core-p2p / SignalClient，故只定义 [ParentTimeSource] 端口
 * 且**不提供默认绑定**（NoOpParentTimeSource 类保留，供无 P2P 的宿主可选 fallback）；
 * :app 同时依赖 feature-family-guard + core-p2p，是接通真实拉取的唯一合适层。同
 * [TelemetryModule] 的 TelemetryOutbox 模式。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class ParentTimeModule {

    @Binds
    @Singleton
    abstract fun bindParentTimeSource(impl: P2PParentTimeSource): ParentTimeSource
}
