package com.chainlesschain.android.feature.knowledge.e2e

import org.junit.Ignore
import org.junit.Test

/**
 * 知识库 E2E 测试 — stub placeholder
 *
 * Same pattern as feature-ai's AIConversationE2ETest:
 * the original test drove MainActivity's Compose UI through Chinese button
 * labels using a never-existed helper package `com.chainlesschain.android.
 * test.*`, plus `DatabaseFixture` from :core-database's androidTest source
 * set which isn't on this module's androidTest classpath.
 *
 * Stubbed @Ignore so the test surface remains discoverable when the
 * infra is built. Hilt annotations intentionally stripped — earlier
 * @HiltAndroidTest caused KSP to fail on :feature-knowledge's androidTest
 * Hilt graph (see commit 4c44bfc95). Stubs need no DI; reactivation
 * brings Hilt back along with the rest of the infrastructure.
 *
 * Real reactivation needs (same as AIConversationE2ETest):
 *   1. Module-local TestActivity that hosts feature-knowledge's Compose
 *      root WITHOUT requiring :app's MainActivity (reverse-dep);
 *   2. Helper module defining clickOnText / typeTextInField /
 *      waitForLoadingToComplete / etc. as test-rule extensions;
 *   3. Wiring DatabaseFixture from :core-database's androidTest source
 *      set into :feature-knowledge's androidTest classpath;
 *   4. Hilt runtime (HiltTestApplication via custom AndroidJUnitRunner),
 *      and re-add @HiltAndroidTest + HiltAndroidRule at that point.
 *
 * See memory `android_quarantined_tests_llm_hallucinated.md` for the
 * broader pattern.
 *
 * Original 8-test surface:
 *   testCompleteKnowledgeWorkflow / testMarkdownEditorFunctionality /
 *   testOfflineCreationAndSync / testFullTextSearch /
 *   testPaginationLoading / testFavoritesFunctionality /
 *   testTagFiltering / testMultiDeviceSync
 */
class KnowledgeE2ETest {

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testCompleteKnowledgeWorkflow() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testMarkdownEditorFunctionality() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testOfflineCreationAndSync() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testFullTextSearch() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testPaginationLoading() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testFavoritesFunctionality() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testTagFiltering() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }

    @Ignore("MainActivity reverse-dep + non-existent test.* helpers. See file KDoc.")
    @Test
    fun testMultiDeviceSync() {
        TODO("Needs module-local TestActivity + helper package — see file KDoc")
    }
}
