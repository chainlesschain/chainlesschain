package com.chainlesschain.android.di

import com.chainlesschain.android.core.p2p.sync.FamilyGuardSyncApplier
import com.chainlesschain.android.familyguard.sync.FamilyGuardSyncApplierImpl
import com.chainlesschain.android.familyguard.sync.SyncManagerFamilyGroupOutbox
import com.chainlesschain.android.familyguard.sync.SyncManagerFamilyMembershipOutbox
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupOutbox
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyMembershipOutbox
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-26 家庭守护 P2P 同步的 :app 真实绑定 (类比 [TelemetryModule] 之于 telemetry)。
 *
 * - 出站: [SyncManagerFamilyGroupOutbox] 覆盖 feature-family-guard 的 NoOp 默认
 *   (feature 不依赖 core-p2p, 故真实 SyncManager 适配器只能在 :app 接)。
 * - 入站: [FamilyGuardSyncApplierImpl] 提供 core-p2p [FamilyGuardSyncApplier] 接口,
 *   DefaultSyncDataApplier 路由 FAMILY_GROUP 到它。
 *
 * 注意: feature-family-guard 的 FamilyGuardBindingsModule **不再**绑定 FamilyGroupOutbox
 * (移除 NoOp 绑定避免与本模块重复); 完整 Hilt 图只在 :app 组装, 这里提供唯一绑定。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class FamilyGuardSyncModule {

    @Binds
    @Singleton
    abstract fun bindFamilyGroupOutbox(impl: SyncManagerFamilyGroupOutbox): FamilyGroupOutbox

    @Binds
    @Singleton
    abstract fun bindFamilyMembershipOutbox(impl: SyncManagerFamilyMembershipOutbox): FamilyMembershipOutbox

    @Binds
    @Singleton
    abstract fun bindFamilyGuardSyncApplier(impl: FamilyGuardSyncApplierImpl): FamilyGuardSyncApplier
}
