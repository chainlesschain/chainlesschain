package com.chainlesschain.android.feature.knowledge

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
 * Phase 4 smoke test — proves the Hilt test-graph in `:feature-knowledge`
 * androidTest source set resolves cleanly with [FakeAppBindingsModule]
 * supplying the bindings that production `:app/RemoteModule` would.
 *
 * The mere act of adding `@HiltAndroidTest` to a test class forces the Hilt
 * processor to build the full `SingletonComponent` graph at compile time
 * (see commit `4c44bfc95` for the prior KSP fail when this graph was
 * incomplete). Combined with `@Inject` on the 3 fake bindings, this test:
 *   (a) Verifies KSP graph validation passes — no "missing binding" errors;
 *   (b) Asserts at runtime that DI actually wires the fakes correctly;
 *   (c) Provides an early signal if some future change re-introduces a
 *       cross-module binding gap.
 *
 * Required infra:
 *   - [TestActivity] (Hilt-aware ComponentActivity), registered in
 *     `src/androidTest/AndroidManifest.xml`;
 *   - [HiltTestRunner] custom AndroidJUnitRunner swapping
 *     `HiltTestApplication` (wired in `build.gradle.kts` defaultConfig);
 *   - [FakeAppBindingsModule] in the same source set.
 *
 * If this test fails at instrumented-run time, the FakeAppBindingsModule
 * bindings have drifted. If it fails at compile time (KSP),
 * `:app/RemoteModule` introduced a new `@Binds` that downstream code
 * (typically via `:core-p2p`) now requires.
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

        // Sanity-check the fake is actually the no-op impl, not a real prod
        // class that somehow leaked through.
        assertFalse(
            "Fake RemoteSkillProvider should report not-connected",
            remoteSkillProvider.isRemoteConnected
        )
    }
}
