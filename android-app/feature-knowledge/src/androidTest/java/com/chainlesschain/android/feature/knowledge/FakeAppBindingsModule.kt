package com.chainlesschain.android.feature.knowledge

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
 * Fake bindings for `:feature-knowledge` androidTest source set — supplies
 * the interfaces normally bound by `:app/RemoteModule`, which is NOT visible
 * to this module's androidTest classpath (`:app` is a reverse dependency).
 *
 * Background: `:feature-knowledge implementation(:core-p2p)`, and
 * `:core-p2p/SyncManager` is `@Inject constructor(... Lazy<SyncOutbound>,
 * Lazy<SyncRepositoryWalker>)`. Hilt KSP enforces strict graph validation —
 * even unconsumed @Inject classes in the classpath must have all their
 * constructor parameters resolvable, or
 * `:feature-knowledge:kspDebugAndroidTestKotlin` fails with "missing binding".
 *
 * `RemoteSkillProvider` is included for completeness: `:feature-knowledge`
 * doesn't directly use it, but Hilt builds the full SingletonComponent
 * graph at compile time and would fail if any other classpath-resident
 * `@Inject` consumer ever appears.
 *
 * All fake impls are no-ops or failure returns — tests that need real
 * behavior should mock at a higher layer (Repository / ViewModel) rather
 * than expanding fakes here.
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
        ): SyncPushResponse {
            return SyncPushResponse(
                status = "failed",
                error = "Fake SyncOutbound in androidTest — not implemented"
            )
        }

        override suspend fun pullFromDevice(
            deviceId: String,
            cursor: PullCursor,
            resourceTypes: List<ResourceType>?,
            limit: Int
        ): SyncPullResponse {
            return SyncPullResponse(
                items = emptyList(),
                nextCursor = cursor,
                hasMore = false
            )
        }
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
