package com.chainlesschain.android.feature.ai

import com.chainlesschain.android.core.p2p.RemoteSkillProvider
import com.chainlesschain.android.core.p2p.sync.SyncOutbound
import com.chainlesschain.android.core.p2p.sync.SyncRepositoryWalker
import dagger.Lazy
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import javax.inject.Inject

/**
 * Phase 4 smoke test for `:feature-ai` androidTest source set. Mirror of
 * `:feature-knowledge/.../HiltGraphSmokeTest.kt` — see its KDoc for the
 * broader rationale.
 *
 * `:feature-ai` is more sensitive than `:feature-knowledge` because
 * `SkillModule.provideP2PSkillBridge(remoteProvider: RemoteSkillProvider)`
 * directly consumes `RemoteSkillProvider`. If the fake binding is missing,
 * KSP fails immediately with "missing binding for RemoteSkillProvider".
 */
@HiltAndroidTest
class HiltGraphSmokeTest {

    @get:Rule
    val hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var syncOutbound: Lazy<SyncOutbound>

    @Inject
    lateinit var syncRepositoryWalker: Lazy<SyncRepositoryWalker>

    @Inject
    lateinit var remoteSkillProvider: RemoteSkillProvider

    @Test
    fun hiltGraphResolves_andFakesAreInjected() {
        hiltRule.inject()

        assertNotNull("Lazy<SyncOutbound> should inject", syncOutbound)
        assertNotNull("Lazy<SyncRepositoryWalker> should inject", syncRepositoryWalker)
        assertNotNull("RemoteSkillProvider should inject", remoteSkillProvider)

        assertFalse(
            "Fake RemoteSkillProvider should report not-connected",
            remoteSkillProvider.isRemoteConnected
        )
    }
}
