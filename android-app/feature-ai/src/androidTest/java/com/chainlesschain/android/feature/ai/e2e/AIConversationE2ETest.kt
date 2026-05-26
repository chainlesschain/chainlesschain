package com.chainlesschain.android.feature.ai.e2e

import org.junit.Ignore
import org.junit.Test

/**
 * AI 对话 E2E 测试 — stub placeholder
 *
 * Tests originally aspired to drive the full app's AI chat flow through
 * MainActivity (createAndroidComposeRule<MainActivity>()) using a now-non-
 * existent helper package `com.chainlesschain.android.test.*`. None of the
 * helpers (clickOnText / typeTextInField / waitForText / assertSnackbar /
 * etc.) were ever shipped in the repo, and `:app`'s MainActivity is a
 * reverse-dep that can't be imported from `:feature-ai`'s androidTest
 * source set.
 *
 * Stubbed @Ignore so the test surface remains discoverable when the
 * infra is built. Hilt annotations intentionally stripped — earlier
 * @HiltAndroidTest forced :feature-ai's Hilt graph to resolve
 * RemoteSkillProvider whose @Binds lives in :app/RemoteModule (downstream),
 * breaking KSP (see commit 4c44bfc95). Stubs need no DI; reactivation
 * brings Hilt back along with the rest of the infrastructure.
 *
 * Real reactivation needs:
 *   1. Module-local TestActivity that hosts feature-ai's Compose root
 *      WITHOUT requiring :app's MainActivity (reverse-dep);
 *   2. `:core-test-helpers` (or feature-ai/src/androidTest/...) helper file
 *      defining clickOnText / typeTextInField / waitForLoadingToComplete /
 *      assertSnackbarMessage / waitForText / assertTextExists /
 *      clickBackButton as test-rule extension functions;
 *   3. Wiring NetworkSimulator from :core-network's androidTest source
 *      set into :feature-ai's androidTest classpath;
 *   4. Hilt runtime (HiltTestApplication via custom AndroidJUnitRunner),
 *      and re-add @HiltAndroidTest + HiltAndroidRule at that point.
 *
 * See memory `android_quarantined_tests_llm_hallucinated.md` for the
 * broader pattern.
 *
 * Original 10-test surface (E2E-AI-01..10):
 *   testCompleteConversationFlow / testModelSwitching /
 *   testAPIKeyConfiguration / testRAGRetrieval / testTokenStatistics /
 *   testSessionCompressionTrigger / testKVCacheOptimization /
 *   testMultiModelConcurrent / testErrorHandlingNetworkFailure /
 *   testSessionExportImport
 */
class AIConversationE2ETest {

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testCompleteConversationFlow() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testModelSwitching() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testAPIKeyConfiguration() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testRAGRetrieval() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testTokenStatistics() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testSessionCompressionTrigger() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testKVCacheOptimization() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testMultiModelConcurrent() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testErrorHandlingNetworkFailure() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testSessionExportImport() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }
}
