package com.chainlesschain.android.di

import com.chainlesschain.android.core.p2p.sync.FamilyTaskSyncApplier
import com.chainlesschain.android.core.p2p.sync.PointsLedgerSyncApplier
import com.chainlesschain.android.familyguard.sync.FamilyTaskSyncApplierImpl
import com.chainlesschain.android.familyguard.sync.SyncManagerFamilyTaskOutbox
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyTaskOutbox
import com.chainlesschain.android.presentation.aistudy.PointsLedgerSyncApplierImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-67: 在 :app 层把 AI 陪学 任务/积分 下行 applier 绑到真实实装，供 feature-p2p 的
 * `DefaultSyncDataApplier` 路由 [com.chainlesschain.android.core.p2p.sync.ResourceType.FAMILY_TASK]
 * / `POINTS_EVENT` 收件落库。
 *
 * 同 [TelemetryModule] 模式：接口在 core-p2p，实装在 :app (:app 同时依赖 core-p2p +
 * feature-family-guard，是接通收件落库的唯一合适层)。上行 outbox 绑定待 Phase 1c 接入。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class FamilyTaskPointsSyncModule {

    @Binds
    @Singleton
    abstract fun bindFamilyTaskSyncApplier(
        impl: FamilyTaskSyncApplierImpl,
    ): FamilyTaskSyncApplier

    @Binds
    @Singleton
    abstract fun bindPointsLedgerSyncApplier(
        impl: PointsLedgerSyncApplierImpl,
    ): PointsLedgerSyncApplier

    // 上行 outbox：覆盖 feature-family-guard 的 NoOpFamilyTaskOutbox 默认 (feature 不依赖 core-p2p)。
    @Binds
    @Singleton
    abstract fun bindFamilyTaskOutbox(
        impl: SyncManagerFamilyTaskOutbox,
    ): FamilyTaskOutbox
}
