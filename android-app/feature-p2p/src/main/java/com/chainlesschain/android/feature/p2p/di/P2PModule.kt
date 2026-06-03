package com.chainlesschain.android.feature.p2p.di

import com.chainlesschain.android.core.p2p.sync.SyncDataApplier
import com.chainlesschain.android.core.p2p.sync.SyncRepositoryWalker
import com.chainlesschain.android.feature.p2p.sync.DefaultSyncDataApplier
import com.chainlesschain.android.feature.p2p.sync.SocialSyncWalker
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * P2P功能模块的依赖注入配置
 *
 * Most dependencies use @Singleton + @Inject constructor for auto-binding.
 * This module provides explicit bindings for interfaces.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class P2PModule {

    /**
     * 绑定 SyncDataApplier 接口到 DefaultSyncDataApplier 实现
     */
    @Binds
    @Singleton
    abstract fun bindSyncDataApplier(impl: DefaultSyncDataApplier): SyncDataApplier

    /**
     * Phase 3d v1.1: SyncRepositoryWalker 原绑定 → SocialSyncWalker。
     *
     * Phase 3d v1.2 #21 P2 (2026-05-13): 改在 :app/sync 绑定到
     * CompositeSyncRepositoryWalker (含 Social + Project)。本 binding 注释
     * 留作历史，避免 Hilt 双 binding 冲突。
     *
     * SocialSyncWalker 仍走 @Inject constructor 自动绑定，可直接被 Composite
     * 注入。
     */
    // @Binds
    // @Singleton
    // abstract fun bindSyncRepositoryWalker(impl: SocialSyncWalker): SyncRepositoryWalker
}
