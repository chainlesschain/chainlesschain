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
     * Phase 3d v1.1: 绑定 SyncRepositoryWalker → SocialSyncWalker。
     * SyncManager 注入 dagger.Lazy<SyncRepositoryWalker>，handlePullRpc
     * 用 walker enumerate Repository 历史数据（vs v1 只看 pendingChanges）。
     */
    @Binds
    @Singleton
    abstract fun bindSyncRepositoryWalker(impl: SocialSyncWalker): SyncRepositoryWalker
}
