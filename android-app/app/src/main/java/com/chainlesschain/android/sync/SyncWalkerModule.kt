package com.chainlesschain.android.sync

import com.chainlesschain.android.core.p2p.sync.SyncRepositoryWalker
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * App-level binding for SyncRepositoryWalker → CompositeSyncRepositoryWalker
 * (#21 P2)。
 *
 * Replaces the single-feature binding that used to live in
 * feature-p2p/P2PModule (now commented out). `:app` is the only module that
 * can see both feature-p2p and feature-project, so the composite binding has
 * to land here.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class SyncWalkerModule {

    @Binds
    @Singleton
    abstract fun bindSyncRepositoryWalker(
        impl: CompositeSyncRepositoryWalker,
    ): SyncRepositoryWalker

    /** FAMILY-67: VM 经接口拿 connector（纯单测可注入 fake），实装即 FamilyGuardSyncConnector。 */
    @Binds
    @Singleton
    abstract fun bindFamilyPairingConnector(
        impl: FamilyGuardSyncConnector,
    ): FamilyPairingConnector
}
