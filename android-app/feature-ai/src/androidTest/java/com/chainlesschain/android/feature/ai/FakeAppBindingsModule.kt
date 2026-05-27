package com.chainlesschain.android.feature.ai

import com.chainlesschain.android.core.p2p.RemoteSkillProvider
import com.chainlesschain.android.core.p2p.sync.PullCursor
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncOutbound
import com.chainlesschain.android.core.p2p.sync.SyncPullResponse
import com.chainlesschain.android.core.p2p.sync.SyncPushResponse
import com.chainlesschain.android.core.p2p.sync.SyncRepositoryWalker
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Fake bindings for `:feature-ai` androidTest source set — supplies the
 * interfaces normally bound by `:app/RemoteModule`, which is NOT visible
 * to this module's androidTest classpath (`:app` is a reverse dependency).
 *
 * Direct consumer: `feature-ai/.../cowork/skills/di/SkillModule.kt`'s
 * `provideP2PSkillBridge(remoteProvider: RemoteSkillProvider)` — i.e.,
 * RemoteSkillProvider is concretely required (not just classpath-resident).
 *
 * SyncOutbound + SyncRepositoryWalker are bound for the same reason as
 * `:feature-knowledge`: `:core-p2p/SyncManager` is `@Inject constructor(
 * ... Lazy<SyncOutbound>, Lazy<SyncRepositoryWalker>)`, and Hilt KSP enforces
 * strict graph validation across the entire classpath even when nothing
 * directly consumes those classes.
 *
 * Mirror of `:feature-knowledge/.../FakeAppBindingsModule.kt`. If a real
 * `RemoteSkillProvider` behavior becomes necessary for a test, prefer
 * `@TestInstallIn(replaces = [FakeAppBindingsModule::class])` on a
 * per-test-class fake rather than mutating this default fake.
 */
@Module
@InstallIn(SingletonComponent::class)
object FakeAppBindingsModule {

    @Provides
    @Singleton
    fun provideFakeSyncOutbound(): SyncOutbound = object : SyncOutbound {
        override suspend fun pushItem(
            deviceId: String,
            item: SyncItem
        ): SyncPushResponse = SyncPushResponse(
            status = "failed",
            error = "Fake SyncOutbound in androidTest — not implemented"
        )

        override suspend fun pullFromDevice(
            deviceId: String,
            cursor: PullCursor,
            resourceTypes: List<ResourceType>?,
            limit: Int
        ): SyncPullResponse = SyncPullResponse(
            items = emptyList(),
            nextCursor = cursor,
            hasMore = false
        )
    }

    @Provides
    @Singleton
    fun provideFakeSyncRepositoryWalker(): SyncRepositoryWalker = object : SyncRepositoryWalker {
        override suspend fun enumerate(
            cursor: PullCursor,
            resourceTypes: List<ResourceType>?,
            limit: Int
        ): List<SyncItem> = emptyList()
    }

    @Provides
    @Singleton
    fun provideFakeRemoteSkillProvider(): RemoteSkillProvider = object : RemoteSkillProvider {
        override val isRemoteConnected: Boolean = false

        override suspend fun <T> sendRemoteCommand(
            method: String,
            params: Map<String, Any>,
            timeout: Long
        ): Result<T> = Result.failure(
            IllegalStateException("Fake RemoteSkillProvider in androidTest — not implemented")
        )
    }
}
