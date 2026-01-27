package com.chainlesschain.android.remote.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.SearchResult
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 远程 RAG 搜索 ViewModel
 *
 * 功能：
 * - 搜索 PC 端知识库
 * - 显示搜索结果
 * - 查看结果详情
 */
@HiltViewModel
class RemoteRAGSearchViewModel @Inject constructor(
    private val aiCommands: AICommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(RemoteRAGSearchUiState())
    val uiState: StateFlow<RemoteRAGSearchUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 搜索结果
    private val _searchResults = MutableStateFlow<List<SearchResult>>(emptyList())
    val searchResults: StateFlow<List<SearchResult>> = _searchResults.asStateFlow()

    // 搜索历史
    private val _searchHistory = MutableStateFlow<List<String>>(emptyList())
    val searchHistory: StateFlow<List<String>> = _searchHistory.asStateFlow()

    /**
     * 执行搜索
     */
    fun search(query: String, topK: Int = 10) {
        if (query.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(
                isSearching = true,
                error = null,
                currentQuery = query
            )}

            // 调用 RAG 搜索
            val result = aiCommands.ragSearch(
                query = query,
                topK = topK
            )

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    _searchResults.value = response.results
                    _uiState.update { it.copy(
                        isSearching = false,
                        totalResults = response.total
                    )}

                    // 添加到搜索历史
                    addToHistory(query)
                }
            } else {
                val error = result.exceptionOrNull()?.message ?: "搜索失败"
                Timber.e(result.exceptionOrNull(), "搜索失败")
                _uiState.update { it.copy(
                    isSearching = false,
                    error = error
                )}
            }
        }
    }

    /**
     * 添加到搜索历史
     */
    private fun addToHistory(query: String) {
        val history = _searchHistory.value.toMutableList()
        // 移除重复项
        history.remove(query)
        // 添加到开头
        history.add(0, query)
        // 限制历史记录数量
        if (history.size > 10) {
            history.removeAt(history.lastIndex)
        }
        _searchHistory.value = history
    }

    /**
     * 清除搜索结果
     */
    fun clearResults() {
        _searchResults.value = emptyList()
        _uiState.update { it.copy(
            currentQuery = null,
            totalResults = 0,
            error = null
        )}
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 设置 topK
     */
    fun setTopK(topK: Int) {
        _uiState.update { it.copy(topK = topK) }
    }
}

/**
 * UI 状态
 */
data class RemoteRAGSearchUiState(
    val isSearching: Boolean = false,
    val error: String? = null,
    val currentQuery: String? = null,
    val totalResults: Int = 0,
    val topK: Int = 10
)
