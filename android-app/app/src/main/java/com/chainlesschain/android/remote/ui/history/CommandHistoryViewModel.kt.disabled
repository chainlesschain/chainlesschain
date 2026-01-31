package com.chainlesschain.android.remote.ui.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.chainlesschain.android.remote.data.*
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 命令历史 ViewModel
 *
 * 功能：
 * - 查看命令历史列表
 * - 搜索和过滤
 * - 查看命令详情
 * - 重放命令
 * - 统计信息
 */
@HiltViewModel
class CommandHistoryViewModel @Inject constructor(
    private val repository: CommandHistoryRepository,
    private val commandClient: RemoteCommandClient,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(CommandHistoryUiState())
    val uiState: StateFlow<CommandHistoryUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 分页数据
    private val _currentFilter = MutableStateFlow<HistoryFilter>(HistoryFilter.All)
    private val _searchQuery = MutableStateFlow("")

    val pagedCommands: Flow<PagingData<CommandHistoryEntity>> = combine(
        _currentFilter,
        _searchQuery
    ) { filter, query ->
        Pair(filter, query)
    }.flatMapLatest { (filter, query) ->
        when {
            query.isNotEmpty() -> repository.searchPaged(query)
            filter is HistoryFilter.ByNamespace -> repository.getByNamespacePaged(filter.namespace)
            filter is HistoryFilter.ByStatus -> repository.getByStatusPaged(filter.status)
            else -> repository.getAllPaged()
        }
    }.cachedIn(viewModelScope)

    // 统计信息
    val statistics: Flow<CommandStatistics> = repository.getStatisticsFlow()

    // 最近命令（用于快捷访问）
    val recentCommands: Flow<List<CommandHistoryEntity>> = repository.getRecentFlow(10)

    init {
        loadStatistics()
    }

    /**
     * 加载统计信息
     */
    private fun loadStatistics() {
        viewModelScope.launch {
            val count = repository.getCount()
            _uiState.update { it.copy(totalCount = count) }
        }
    }

    /**
     * 设置过滤器
     */
    fun setFilter(filter: HistoryFilter) {
        _currentFilter.value = filter
        _uiState.update { it.copy(currentFilter = filter) }
    }

    /**
     * 搜索命令
     */
    fun search(query: String) {
        _searchQuery.value = query
        _uiState.update { it.copy(searchQuery = query) }
    }

    /**
     * 清除搜索
     */
    fun clearSearch() {
        _searchQuery.value = ""
        _uiState.update { it.copy(searchQuery = "") }
    }

    /**
     * 查看命令详情
     */
    fun viewCommandDetail(commandId: Long) {
        viewModelScope.launch {
            val command = repository.getById(commandId)
            _uiState.update { it.copy(selectedCommand = command) }
        }
    }

    /**
     * 关闭命令详情
     */
    fun closeCommandDetail() {
        _uiState.update { it.copy(selectedCommand = null) }
    }

    /**
     * 重放命令
     */
    fun replayCommand(command: CommandHistoryEntity) {
        viewModelScope.launch {
            _uiState.update { it.copy(isReplaying = true, error = null) }

            try {
                // 构造命令方法名
                val method = "${command.namespace}.${command.action}"

                // 发送命令
                val result = commandClient.invoke<Any>(method, command.params)

                if (result.isSuccess) {
                    Timber.d("命令重放成功: $method")
                    _uiState.update { it.copy(
                        isReplaying = false,
                        replaySuccess = true
                    )}
                } else {
                    val error = result.exceptionOrNull()?.message ?: "重放失败"
                    _uiState.update { it.copy(
                        isReplaying = false,
                        error = error
                    )}
                }
            } catch (e: Exception) {
                Timber.e(e, "命令重放失败")
                _uiState.update { it.copy(
                    isReplaying = false,
                    error = e.message ?: "重放失败"
                )}
            }
        }
    }

    /**
     * 删除命令
     */
    fun deleteCommand(command: CommandHistoryEntity) {
        viewModelScope.launch {
            repository.delete(command)
            loadStatistics()
        }
    }

    /**
     * 清空所有命令
     */
    fun clearAllCommands() {
        viewModelScope.launch {
            _uiState.update { it.copy(isClearing = true) }
            repository.deleteAll()
            _uiState.update { it.copy(
                isClearing = false,
                totalCount = 0
            )}
        }
    }

    /**
     * 清理旧记录
     */
    fun cleanupOldRecords(keepCount: Int = 1000) {
        viewModelScope.launch {
            repository.cleanup(keepCount)
            loadStatistics()
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 清除重放成功状态
     */
    fun clearReplaySuccess() {
        _uiState.update { it.copy(replaySuccess = false) }
    }
}

/**
 * UI 状态
 */
data class CommandHistoryUiState(
    val isReplaying: Boolean = false,
    val isClearing: Boolean = false,
    val error: String? = null,
    val selectedCommand: CommandHistoryEntity? = null,
    val currentFilter: HistoryFilter = HistoryFilter.All,
    val searchQuery: String = "",
    val totalCount: Int = 0,
    val replaySuccess: Boolean = false
)

/**
 * 历史过滤器
 */
sealed class HistoryFilter {
    data object All : HistoryFilter()
    data class ByNamespace(val namespace: String) : HistoryFilter()
    data class ByStatus(val status: CommandStatus) : HistoryFilter()
}
