package com.chainlesschain.android.feature.p2p.ui.call

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.entity.call.CallHistoryEntity
import com.chainlesschain.android.core.database.entity.call.CallType
import com.chainlesschain.android.core.database.entity.call.MediaType
import com.chainlesschain.android.feature.p2p.repository.call.CallHistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 通话历史记录ViewModel
 *
 * 管理通话历史的UI状态和业务逻辑
 *
 * 功能：
 * - 通话历史查询和展示
 * - 搜索和筛选
 * - 统计数据展示
 * - 历史记录删除
 *
 * @since v0.32.0
 */
@HiltViewModel
class CallHistoryViewModel @Inject constructor(
    private val callHistoryRepository: CallHistoryRepository
) : ViewModel() {

    // UI状态
    private val _uiState = MutableStateFlow(CallHistoryUiState())
    val uiState: StateFlow<CallHistoryUiState> = _uiState.asStateFlow()

    // 搜索关键词
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    // 筛选类型
    private val _filterType = MutableStateFlow<FilterType>(FilterType.ALL)
    val filterType: StateFlow<FilterType> = _filterType.asStateFlow()

    init {
        loadCallHistory()
        loadStatistics()
    }

    /**
     * 加载通话历史
     */
    private fun loadCallHistory() {
        viewModelScope.launch {
            combine(
                searchQuery,
                filterType
            ) { query, filter ->
                Pair(query, filter)
            }.flatMapLatest { (query, filter) ->
                when {
                    query.isNotBlank() -> {
                        // 搜索模式
                        callHistoryRepository.searchCallHistory(query)
                    }
                    filter != FilterType.ALL -> {
                        // 筛选模式
                        when (filter) {
                            FilterType.MISSED -> callHistoryRepository.getMissedCalls()
                            FilterType.OUTGOING -> callHistoryRepository.getCallHistoryByType(CallType.OUTGOING)
                            FilterType.INCOMING -> callHistoryRepository.getCallHistoryByType(CallType.INCOMING)
                            FilterType.AUDIO -> callHistoryRepository.getCallHistoryByMediaType(MediaType.AUDIO)
                            FilterType.VIDEO -> callHistoryRepository.getCallHistoryByMediaType(MediaType.VIDEO)
                            FilterType.TODAY -> callHistoryRepository.getTodayCallHistory()
                            FilterType.WEEK -> callHistoryRepository.getWeekCallHistory()
                            FilterType.MONTH -> callHistoryRepository.getMonthCallHistory()
                            else -> callHistoryRepository.getAllCallHistory()
                        }
                    }
                    else -> {
                        // 默认显示所有
                        callHistoryRepository.getAllCallHistory()
                    }
                }
            }.collect { result ->
                when (result) {
                    is Result.Success -> {
                        _uiState.update { it.copy(
                            callHistory = result.data,
                            isLoading = false,
                            error = null
                        ) }
                    }
                    is Result.Error -> {
                        _uiState.update { it.copy(
                            isLoading = false,
                            error = result.exception.message
                        ) }
                    }
                    is Result.Loading -> {
                        _uiState.update { it.copy(isLoading = true) }
                    }
                }
            }
        }
    }

    /**
     * 加载统计数据
     */
    private fun loadStatistics() {
        viewModelScope.launch {
            combine(
                callHistoryRepository.getCallHistoryCount(),
                callHistoryRepository.getMissedCallCount()
            ) { totalResult, missedResult ->
                Pair(totalResult, missedResult)
            }.collect { (totalResult, missedResult) ->
                if (totalResult is Result.Success && missedResult is Result.Success) {
                    _uiState.update { it.copy(
                        totalCallCount = totalResult.data,
                        missedCallCount = missedResult.data
                    ) }
                }
            }
        }
    }

    /**
     * 搜索通话记录
     */
    fun searchCallHistory(query: String) {
        _searchQuery.value = query
    }

    /**
     * 设置筛选类型
     */
    fun setFilterType(type: FilterType) {
        _filterType.value = type
        _searchQuery.value = "" // 清空搜索
    }

    /**
     * 清空搜索
     */
    fun clearSearch() {
        _searchQuery.value = ""
    }

    /**
     * 删除单条通话记录
     */
    fun deleteCallHistory(id: String) {
        viewModelScope.launch {
            when (val result = callHistoryRepository.deleteCallHistory(id)) {
                is Result.Success -> {
                    _uiState.update { it.copy(
                        snackbarMessage = "已删除通话记录"
                    ) }
                }
                is Result.Error -> {
                    _uiState.update { it.copy(
                        error = "删除失败: ${result.exception.message}"
                    ) }
                }
                else -> {}
            }
        }
    }

    /**
     * 删除指定联系人的所有通话记录
     */
    fun deleteByPeerDid(peerDid: String, peerName: String) {
        viewModelScope.launch {
            when (val result = callHistoryRepository.deleteByPeerDid(peerDid)) {
                is Result.Success -> {
                    _uiState.update { it.copy(
                        snackbarMessage = "已删除与 $peerName 的所有通话记录"
                    ) }
                }
                is Result.Error -> {
                    _uiState.update { it.copy(
                        error = "删除失败: ${result.exception.message}"
                    ) }
                }
                else -> {}
            }
        }
    }

    /**
     * 清空所有通话记录
     */
    fun deleteAllCallHistory() {
        viewModelScope.launch {
            when (val result = callHistoryRepository.deleteAll()) {
                is Result.Success -> {
                    _uiState.update { it.copy(
                        snackbarMessage = "已清空所有通话记录"
                    ) }
                }
                is Result.Error -> {
                    _uiState.update { it.copy(
                        error = "清空失败: ${result.exception.message}"
                    ) }
                }
                else -> {}
            }
        }
    }

    /**
     * 删除N天前的通话记录
     */
    fun deleteOlderThan(daysAgo: Int) {
        viewModelScope.launch {
            when (val result = callHistoryRepository.deleteOlderThan(daysAgo)) {
                is Result.Success -> {
                    _uiState.update { it.copy(
                        snackbarMessage = "已删除 $daysAgo 天前的通话记录"
                    ) }
                }
                is Result.Error -> {
                    _uiState.update { it.copy(
                        error = "删除失败: ${result.exception.message}"
                    ) }
                }
                else -> {}
            }
        }
    }

    /**
     * 获取指定联系人的通话总时长
     */
    fun loadTotalDuration(peerDid: String) {
        viewModelScope.launch {
            callHistoryRepository.getTotalDurationByPeerDid(peerDid).collect { result ->
                if (result is Result.Success) {
                    _uiState.update { it.copy(
                        selectedPeerTotalDuration = result.data
                    ) }
                }
            }
        }
    }

    /**
     * 清除Snackbar消息
     */
    fun clearSnackbarMessage() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

/**
 * 通话历史UI状态
 */
data class CallHistoryUiState(
    val callHistory: List<CallHistoryEntity> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val snackbarMessage: String? = null,
    val totalCallCount: Int = 0,
    val missedCallCount: Int = 0,
    val selectedPeerTotalDuration: Long = 0
)

/**
 * 筛选类型
 */
enum class FilterType {
    /** 全部 */
    ALL,

    /** 未接来电 */
    MISSED,

    /** 呼出 */
    OUTGOING,

    /** 接听 */
    INCOMING,

    /** 音频通话 */
    AUDIO,

    /** 视频通话 */
    VIDEO,

    /** 今天 */
    TODAY,

    /** 本周 */
    WEEK,

    /** 本月 */
    MONTH
}
