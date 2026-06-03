package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalCcRunner.Cursor
import com.chainlesschain.android.pdh.LocalCcRunner.EventRow
import com.chainlesschain.android.pdh.LocalCcRunner.FacetCountsResult
import com.chainlesschain.android.pdh.LocalCcRunner.SearchResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Phase 16 Vault Browser — Android tab "我的数据".
 *
 * Reads paginated vault events via [LocalCcRunner.searchEvents] (cc hub
 * search subcommand). Facet counts for the category chip row come from
 * [LocalCcRunner.facetCounts]. Both honor q + date filters.
 *
 * State is mirrored from the Pinia store on the desktop side
 * (packages/web-panel/src/stores/pdhBrowser.js) so behavior matches:
 *   - debounced search (300ms after last setQuery call)
 *   - cursor pagination on (occurredAt DESC, id DESC)
 *   - race-resolution token: stale slow responses are dropped
 *   - facet calls strip adapter/category/subtype (else bucket counts
 *     always read 100% of the selected category)
 */
@Immutable
data class HubBrowserUiState(
    val q: String = "",
    val category: String? = null,    // null = all categories
    val adapter: String? = null,
    val subtype: String? = null,
    val since: Long? = null,
    val until: Long? = null,
    val rows: List<EventRow> = emptyList(),
    val cursor: Cursor? = null,
    val facets: BrowserFacets = BrowserFacets(),
    val isLoading: Boolean = false,
    val isAppending: Boolean = false,
    val errorMessage: String? = null,
    val mode: String? = null,          // "fts5" | "like" | null
    val shortQuery: Boolean = false,
) {
    val hasResults: Boolean get() = rows.isNotEmpty()
    val canLoadMore: Boolean get() = cursor != null
}

@Immutable
data class BrowserFacets(
    val byCategory: Map<String, Int> = emptyMap(),
    val byAdapter: Map<String, Int> = emptyMap(),
    val total: Int = 0,
)

internal const val BROWSER_PAGE_SIZE = 50
internal const val BROWSER_DEBOUNCE_MS = 300L

@HiltViewModel
class HubBrowserViewModel @Inject constructor(
    private val runner: LocalCcRunner,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HubBrowserUiState())
    val uiState: StateFlow<HubBrowserUiState> = _uiState.asStateFlow()

    private var _searchToken = 0L
    private var _debounceJob: Job? = null

    init { search() }

    /** Update keyword + schedule debounced search. */
    fun setQuery(q: String) {
        _uiState.update { it.copy(q = q) }
        _debounceJob?.cancel()
        _debounceJob = viewModelScope.launch {
            delay(BROWSER_DEBOUNCE_MS)
            search()
        }
    }

    /** Select category (null = all). Immediate search, no debounce. */
    fun selectCategory(category: String?) {
        _uiState.update { it.copy(category = category, adapter = null) }
        _debounceJob?.cancel()
        search()
    }

    /** Pick a specific adapter chip. */
    fun selectAdapter(adapter: String?) {
        _uiState.update { it.copy(adapter = adapter) }
        _debounceJob?.cancel()
        search()
    }

    /** Set date range; pass nulls to clear. */
    fun setDateRange(since: Long?, until: Long?) {
        _uiState.update { it.copy(since = since, until = until) }
        _debounceJob?.cancel()
        search()
    }

    /** Clear all filters + re-search (default = unfiltered list). */
    fun resetFilters() {
        _uiState.update {
            HubBrowserUiState() // keep nothing
        }
        _debounceJob?.cancel()
        search()
    }

    fun search() {
        val token = ++_searchToken
        val s = _uiState.value
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            // facet call strips adapter/category/subtype intentionally
            val facetDeferred = async {
                runner.facetCounts(q = s.q.takeIf { it.isNotBlank() }, since = s.since, until = s.until)
            }
            val searchRes = runner.searchEvents(
                q = s.q.takeIf { it.isNotBlank() },
                adapter = s.adapter,
                category = s.category,
                subtype = s.subtype,
                since = s.since,
                until = s.until,
                limit = BROWSER_PAGE_SIZE,
            )
            val facetRes = facetDeferred.await()
            if (token != _searchToken) return@launch // stale — drop
            when (searchRes) {
                is SearchResult.Ok -> {
                    _uiState.update {
                        it.copy(
                            rows = searchRes.rows,
                            cursor = searchRes.nextCursor,
                            mode = searchRes.mode,
                            shortQuery = searchRes.shortQuery,
                            facets = if (facetRes is FacetCountsResult.Ok) {
                                BrowserFacets(
                                    byCategory = facetRes.byCategory,
                                    byAdapter = facetRes.byAdapter,
                                    total = facetRes.total,
                                )
                            } else it.facets,
                            isLoading = false,
                            errorMessage = null,
                        )
                    }
                }
                is SearchResult.Failed -> {
                    Timber.w("HubBrowserViewModel.search failed: %s exit=%s", searchRes.reason, searchRes.exitCode)
                    _uiState.update {
                        it.copy(
                            rows = emptyList(),
                            cursor = null,
                            errorMessage = searchRes.reason,
                            isLoading = false,
                        )
                    }
                }
            }
        }
    }

    fun loadMore() {
        val s = _uiState.value
        val cur = s.cursor ?: return
        if (s.isAppending) return
        _uiState.update { it.copy(isAppending = true, errorMessage = null) }
        viewModelScope.launch {
            val res = runner.searchEvents(
                q = s.q.takeIf { it.isNotBlank() },
                adapter = s.adapter,
                category = s.category,
                subtype = s.subtype,
                since = s.since,
                until = s.until,
                cursor = cur,
                limit = BROWSER_PAGE_SIZE,
            )
            when (res) {
                is SearchResult.Ok -> {
                    _uiState.update {
                        it.copy(
                            rows = it.rows + res.rows,
                            cursor = res.nextCursor,
                            mode = res.mode,
                            isAppending = false,
                        )
                    }
                }
                is SearchResult.Failed -> {
                    _uiState.update {
                        it.copy(errorMessage = res.reason, isAppending = false)
                    }
                }
            }
        }
    }
}
