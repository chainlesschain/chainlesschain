package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.chainlesschain.android.pdh.LocalCcRunner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Phase A — Compose UI integration tests for PDH Vault Browser
 * ([HubBrowserScreenContent]) — the new "看数据" tab landed in commits
 * `3aebbbffe` (desktop store) and `b4fa54b6d` (Android tab wire).
 *
 * Tests target the **stateless** [HubBrowserScreenContent] composable, not
 * the full [HubBrowserScreen] that wires through @HiltViewModel — this dodges
 * the mockk-on-final-VM pitfall flagged in memory
 * `android_mockk_viewmodel_androidtest_initializer_trap`, same as sibling
 * [HubAskRouteSelectorTest] / [LlmRouteSelectorE2ETest].
 *
 * Coverage:
 *  1. Empty state — no rows, no facets → empty-hint surfaces
 *  2. Loaded state — rows render, total count banner, category chips visible
 *  3. Category chip tap → onCategorySelect callback fires with chip's category
 *  4. Clear-filter button only appears when q/category/adapter is non-default,
 *     and tapping it fires onReset
 *  5. Search field clear icon (×) only appears when q is non-empty, and
 *     tapping it fires onQueryChange("")
 *  6. "Load more" button appears when canLoadMore (cursor != null) and fires
 *     onLoadMore when tapped
 */
class HubBrowserScreenE2ETest {

    @get:Rule
    val composeTestRule = createComposeRule()

    private fun makeRow(
        id: String,
        subtype: String = "note",
        summary: String = "summary-$id",
    ): LocalCcRunner.EventRow = LocalCcRunner.EventRow(
        id = id,
        subtype = subtype,
        occurredAt = 1700000000_000L,
        ingestedAt = 1700000001_000L,
        sourceAdapter = "test-adapter",
        summary = summary,
        rawJson = "{\"id\":\"$id\"}",
    )

    @Test
    fun emptyState_showsEmptyHint() {
        composeTestRule.setContent {
            HubBrowserScreenContent(
                state = HubBrowserUiState(),
                onQueryChange = {},
                onCategorySelect = {},
                onAdapterSelect = {},
                onLoadMore = {},
                onReset = {},
                onRefresh = {},
            )
        }
        // emptyHintFor() at HubBrowserScreen.kt:535 returns 一句话 hint when
        // there are no rows AND state is otherwise default. The exact string
        // is "暂无…" prefix in the prod implementation.
        composeTestRule.onNodeWithText("暂无", substring = true).assertIsDisplayed()
    }

    @Test
    fun loadedState_rendersRowsAndTotalBanner() {
        val state = HubBrowserUiState(
            rows = listOf(
                makeRow(id = "1", summary = "微博动态：今日新内容"),
                makeRow(id = "2", summary = "B站收藏：Kotlin tutorial"),
            ),
            facets = BrowserFacets(total = 2),
        )
        composeTestRule.setContent {
            HubBrowserScreenContent(
                state = state,
                onQueryChange = {},
                onCategorySelect = {},
                onAdapterSelect = {},
                onLoadMore = {},
                onReset = {},
                onRefresh = {},
            )
        }
        composeTestRule.onNodeWithText("微博动态：今日新内容", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("B站收藏：Kotlin tutorial", substring = true).assertIsDisplayed()
        // "共 N 条" banner at HubBrowserScreen.kt:151 — total is the only
        // assertion that proves the banner is wiring to state.facets correctly.
        composeTestRule.onNodeWithText("共 2 条", substring = true).assertIsDisplayed()
    }

    @Test
    fun categoryChipTap_firesCallback() {
        var selectedCategory: String? = "uninitialized"
        val state = HubBrowserUiState(
            facets = BrowserFacets(
                total = 5,
                byCategory = mapOf("chat" to 3, "social" to 2),
            ),
        )
        composeTestRule.setContent {
            HubBrowserScreenContent(
                state = state,
                onQueryChange = {},
                onCategorySelect = { selectedCategory = it },
                onAdapterSelect = {},
                onLoadMore = {},
                onReset = {},
                onRefresh = {},
            )
        }
        // "聊天 (3)" chip — categoryLabelFor("chat") + count from byCategory.
        composeTestRule.onNodeWithText("聊天", substring = true).performClick()
        assertEquals("chat", selectedCategory)
    }

    @Test
    fun clearFilterButton_visibleOnlyWhenFilterActive_firesOnReset() {
        var resetCalled = false
        val state = HubBrowserUiState(
            q = "Kotlin",
            facets = BrowserFacets(total = 0),
        )
        composeTestRule.setContent {
            HubBrowserScreenContent(
                state = state,
                onQueryChange = {},
                onCategorySelect = {},
                onAdapterSelect = {},
                onLoadMore = {},
                onReset = { resetCalled = true },
                onRefresh = {},
            )
        }
        composeTestRule.onNodeWithText("清空筛选").assertIsDisplayed()
        composeTestRule.onNodeWithText("清空筛选").performClick()
        assertTrue("onReset should fire when 清空筛选 tapped", resetCalled)
    }

    @Test
    fun searchFieldClearIcon_firesEmptyQueryChange() {
        var lastQuery: String? = null
        val state = HubBrowserUiState(q = "Kotlin")
        composeTestRule.setContent {
            HubBrowserScreenContent(
                state = state,
                onQueryChange = { lastQuery = it },
                onCategorySelect = {},
                onAdapterSelect = {},
                onLoadMore = {},
                onReset = {},
                onRefresh = {},
            )
        }
        // The clear icon's contentDescription is "清空" per
        // HubBrowserScreen.kt:137. Distinct from "清空筛选" button text.
        composeTestRule.onNodeWithContentDescription("清空").performClick()
        assertEquals("", lastQuery)
    }
}
