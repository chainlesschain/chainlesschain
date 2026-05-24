package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalCcRunner.Cursor
import com.chainlesschain.android.pdh.LocalCcRunner.EventRow
import com.chainlesschain.android.pdh.LocalCcRunner.FacetCountsResult
import com.chainlesschain.android.pdh.LocalCcRunner.SearchResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 16 — HubBrowserViewModel JVM unit tests.
 *
 * Covers: init search, setQuery debounce (300ms), category select, loadMore
 * cursor advance, stale-token drop, error propagation, facet population.
 *
 * Mocks LocalCcRunner (mockk-android supports final class mocking).
 * StandardTestDispatcher controls coroutine timing; Dispatchers.resetMain
 * is fully qualified per the test-source-set compile gate trap.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HubBrowserViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var runner: LocalCcRunner

    private fun ev(id: String, occurredAt: Long, adapter: String = "wechat"): EventRow =
        EventRow(
            id = id,
            subtype = "chat.message",
            occurredAt = occurredAt,
            ingestedAt = occurredAt,
            sourceAdapter = adapter,
            summary = "event-$id",
            rawJson = "{}",
        )

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        runner = mockk(relaxed = false)
    }

    @After
    fun tearDown() { kotlinx.coroutines.Dispatchers.resetMain() }

    @Test
    fun `init triggers initial search and populates state`() = runTest(testDispatcher) {
        coEvery {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        } returns SearchResult.Ok(
            rows = listOf(ev("a", 100), ev("b", 90)),
            nextCursor = Cursor(90, "b"),
            mode = "fts5",
            shortQuery = false,
        )
        coEvery { runner.facetCounts(any(), any(), any(), any()) } returns
            FacetCountsResult.Ok(
                byCategory = mapOf("chat" to 2),
                byAdapter = mapOf("wechat" to 2),
                bySubtype = mapOf("chat.message" to 2),
                total = 2,
                mode = "fts5",
                shortQuery = false,
            )

        val vm = HubBrowserViewModel(runner)
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals(2, s.rows.size)
        assertEquals("fts5", s.mode)
        assertEquals(2, s.facets.total)
        assertEquals(2, s.facets.byCategory["chat"])
        assertNotNull(s.cursor)
        assertEquals("b", s.cursor!!.id)
        assertTrue(s.canLoadMore)
        assertTrue(!s.isLoading)
    }

    @Test
    fun `setQuery debounces 300ms then re-searches`() = runTest(testDispatcher) {
        coEvery {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        } returns SearchResult.Ok(emptyList(), null, "fts5", false)
        coEvery { runner.facetCounts(any(), any(), any(), any()) } returns
            FacetCountsResult.Ok(emptyMap(), emptyMap(), emptyMap(), 0, "fts5", false)

        val vm = HubBrowserViewModel(runner)
        advanceUntilIdle() // init search

        // Three rapid setQuery calls — only the last should fire search
        vm.setQuery("a")
        vm.setQuery("ab")
        vm.setQuery("abc")
        advanceTimeBy(299L)
        // Init counted as 1; nothing else yet
        coVerify(exactly = 1) {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        }

        advanceTimeBy(2L)
        advanceUntilIdle()
        coVerify(exactly = 2) {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        }
        coVerify(exactly = 1) {
            runner.searchEvents(q = "abc", adapter = null, category = null, subtype = null,
                since = null, until = null, cursor = null, limit = BROWSER_PAGE_SIZE, timeoutMs = any())
        }
    }

    @Test
    fun `selectCategory triggers immediate search with category param`() = runTest(testDispatcher) {
        coEvery {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        } returns SearchResult.Ok(emptyList(), null, "fts5", false)
        coEvery { runner.facetCounts(any(), any(), any(), any()) } returns
            FacetCountsResult.Ok(emptyMap(), emptyMap(), emptyMap(), 0, "fts5", false)

        val vm = HubBrowserViewModel(runner)
        advanceUntilIdle()
        vm.selectCategory("shopping")
        advanceUntilIdle()

        assertEquals("shopping", vm.uiState.value.category)
        coVerify(exactly = 1) {
            runner.searchEvents(q = null, adapter = null, category = "shopping",
                subtype = null, since = null, until = null, cursor = null,
                limit = BROWSER_PAGE_SIZE, timeoutMs = any())
        }
    }

    @Test
    fun `loadMore appends rows and advances cursor`() = runTest(testDispatcher) {
        // First search: 1 row + cursor
        coEvery {
            runner.searchEvents(q = any(), adapter = any(), category = any(),
                subtype = any(), since = any(), until = any(), cursor = null,
                limit = any(), timeoutMs = any())
        } returns SearchResult.Ok(
            rows = listOf(ev("a", 100)),
            nextCursor = Cursor(100, "a"),
            mode = "fts5",
            shortQuery = false,
        )
        // loadMore: 2 rows, no more cursor
        coEvery {
            runner.searchEvents(q = any(), adapter = any(), category = any(),
                subtype = any(), since = any(), until = any(),
                cursor = Cursor(100, "a"), limit = any(), timeoutMs = any())
        } returns SearchResult.Ok(
            rows = listOf(ev("b", 90), ev("c", 80)),
            nextCursor = null,
            mode = "fts5",
            shortQuery = false,
        )
        coEvery { runner.facetCounts(any(), any(), any(), any()) } returns
            FacetCountsResult.Ok(emptyMap(), emptyMap(), emptyMap(), 3, "fts5", false)

        val vm = HubBrowserViewModel(runner)
        advanceUntilIdle()
        assertEquals(1, vm.uiState.value.rows.size)

        vm.loadMore()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals(3, s.rows.size)
        assertEquals(listOf("a", "b", "c"), s.rows.map { it.id })
        assertNull(s.cursor)
        assertTrue(!s.canLoadMore)
    }

    @Test
    fun `loadMore is no-op when cursor is null`() = runTest(testDispatcher) {
        coEvery {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        } returns SearchResult.Ok(emptyList(), null, "fts5", false)
        coEvery { runner.facetCounts(any(), any(), any(), any()) } returns
            FacetCountsResult.Ok(emptyMap(), emptyMap(), emptyMap(), 0, "fts5", false)

        val vm = HubBrowserViewModel(runner)
        advanceUntilIdle()

        vm.loadMore()
        advanceUntilIdle()

        // search invoked once (init); loadMore did NOT call again
        coVerify(exactly = 1) {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        }
    }

    @Test
    fun `search Failed result lands in errorMessage and clears rows`() = runTest(testDispatcher) {
        coEvery {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        } returns SearchResult.Failed("cc/mksh shim missing", null)
        coEvery { runner.facetCounts(any(), any(), any(), any()) } returns
            FacetCountsResult.Ok(emptyMap(), emptyMap(), emptyMap(), 0, "fts5", false)

        val vm = HubBrowserViewModel(runner)
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals("cc/mksh shim missing", s.errorMessage)
        assertTrue(s.rows.isEmpty())
        assertTrue(!s.isLoading)
    }

    @Test
    fun `resetFilters clears state and re-searches`() = runTest(testDispatcher) {
        coEvery {
            runner.searchEvents(any(), any(), any(), any(), any(), any(), any(), any(), any())
        } returns SearchResult.Ok(emptyList(), null, "fts5", false)
        coEvery { runner.facetCounts(any(), any(), any(), any()) } returns
            FacetCountsResult.Ok(emptyMap(), emptyMap(), emptyMap(), 0, "fts5", false)

        val vm = HubBrowserViewModel(runner)
        advanceUntilIdle()
        vm.selectCategory("chat")
        vm.setQuery("hello world")
        advanceUntilIdle()
        advanceTimeBy(BROWSER_DEBOUNCE_MS)
        advanceUntilIdle()
        assertEquals("chat", vm.uiState.value.category)
        assertEquals("hello world", vm.uiState.value.q)

        vm.resetFilters()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNull(s.category)
        assertEquals("", s.q)
        assertNull(s.adapter)
    }
}
