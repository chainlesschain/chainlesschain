package com.chainlesschain.android.remote.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.SearchResult
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

@HiltViewModel
class RemoteRAGSearchViewModel @Inject constructor(
    private val aiCommands: AICommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(RemoteRAGSearchUiState())
    val uiState: StateFlow<RemoteRAGSearchUiState> = _uiState.asStateFlow()

    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    private val _searchResults = MutableStateFlow<List<SearchResult>>(emptyList())
    val searchResults: StateFlow<List<SearchResult>> = _searchResults.asStateFlow()

    private val _searchHistory = MutableStateFlow<List<String>>(emptyList())
    val searchHistory: StateFlow<List<String>> = _searchHistory.asStateFlow()

    fun search(query: String, topK: Int = _uiState.value.topK) {
        val q = query.trim()
        if (q.isEmpty()) return
        if (connectionState.value != ConnectionState.CONNECTED) {
            _uiState.update { it.copy(error = "Not connected to PC") }
            return
        }

        _uiState.update {
            it.copy(
                isSearching = true,
                error = null,
                currentQuery = q,
                requestedTopK = topK.coerceIn(1, 50)
            )
        }

        viewModelScope.launch {
            val result = aiCommands.ragSearch(query = q, topK = _uiState.value.requestedTopK)
            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    _searchResults.value = response.results
                    _uiState.update {
                        it.copy(
                            isSearching = false,
                            totalResults = response.total,
                            hasMore = response.results.size >= it.requestedTopK && it.requestedTopK < 50
                        )
                    }
                    addToHistory(q)
                } else {
                    _uiState.update { it.copy(isSearching = false, error = "Empty response") }
                }
            } else {
                val error = result.exceptionOrNull()?.message ?: "Search failed"
                Timber.e(result.exceptionOrNull(), "RAG search failed")
                _uiState.update { it.copy(isSearching = false, error = error) }
            }
        }
    }

    fun loadMore() {
        val currentQuery = _uiState.value.currentQuery ?: return
        if (_uiState.value.isSearching) return
        val nextTopK = (_uiState.value.requestedTopK + 10).coerceAtMost(50)
        if (nextTopK == _uiState.value.requestedTopK) return
        search(currentQuery, nextTopK)
    }

    fun retryCurrentQuery() {
        val q = _uiState.value.currentQuery ?: return
        search(q, _uiState.value.requestedTopK)
    }

    private fun addToHistory(query: String) {
        val history = _searchHistory.value.toMutableList()
        history.remove(query)
        history.add(0, query)
        if (history.size > 10) history.removeAt(history.lastIndex)
        _searchHistory.value = history
    }

    fun clearResults() {
        _searchResults.value = emptyList()
        _uiState.update { it.copy(currentQuery = null, totalResults = 0, error = null, hasMore = false) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun setTopK(topK: Int) {
        _uiState.update { it.copy(topK = topK.coerceIn(1, 20), requestedTopK = topK.coerceIn(1, 50)) }
    }
}

@Immutable
data class RemoteRAGSearchUiState(
    val isSearching: Boolean = false,
    val error: String? = null,
    val currentQuery: String? = null,
    val totalResults: Int = 0,
    val topK: Int = 10,
    val requestedTopK: Int = 10,
    val hasMore: Boolean = false
)
