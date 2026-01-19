package com.chainlesschain.android.feature.knowledge.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.PagingData
import androidx.paging.cachedIn
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.knowledge.data.repository.KnowledgeRepository
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeItem
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 知识库视图模型
 *
 * 管理知识库列表、搜索、编辑等状态
 */
@HiltViewModel
class KnowledgeViewModel @Inject constructor(
    private val repository: KnowledgeRepository
) : ViewModel() {

    // UI状态
    private val _uiState = MutableStateFlow(KnowledgeUiState())
    val uiState: StateFlow<KnowledgeUiState> = _uiState.asStateFlow()

    // 知识库列表（分页）
    private val _searchQuery = MutableStateFlow("")
    val knowledgeItems: Flow<PagingData<KnowledgeItem>> = _searchQuery
        .flatMapLatest { query ->
            if (query.isEmpty()) {
                when (_uiState.value.filterMode) {
                    FilterMode.ALL -> repository.getItems()
                    FilterMode.FAVORITE -> repository.getFavoriteItems()
                    FilterMode.FOLDER -> {
                        val folderId = _uiState.value.selectedFolderId
                        if (folderId != null) {
                            repository.getItemsByFolder(folderId)
                        } else {
                            repository.getItems()
                        }
                    }
                }
            } else {
                repository.searchItems(query)
            }
        }
        .cachedIn(viewModelScope)

    // 当前编辑的条目
    private val _currentItem = MutableStateFlow<KnowledgeItem?>(null)
    val currentItem: StateFlow<KnowledgeItem?> = _currentItem.asStateFlow()

    /**
     * 搜索知识库
     */
    fun searchKnowledge(query: String) {
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
     * 切换筛选模式
     */
    fun setFilterMode(mode: FilterMode, folderId: String? = null) {
        _uiState.update {
            it.copy(
                filterMode = mode,
                selectedFolderId = folderId
            )
        }
        // 触发刷新
        _searchQuery.value = _searchQuery.value
    }

    /**
     * 加载条目详情
     */
    fun loadItem(id: String) {
        viewModelScope.launch {
            repository.getItemById(id).collect { item ->
                _currentItem.value = item
            }
        }
    }

    /**
     * 创建新条目
     */
    fun createItem(
        title: String,
        content: String,
        type: KnowledgeType = KnowledgeType.NOTE,
        folderId: String? = null,
        tags: List<String> = emptyList()
    ) {
        if (title.isBlank()) {
            _uiState.update { it.copy(error = "标题不能为空") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // TODO: 从AuthRepository获取deviceId
            val deviceId = "device-${System.currentTimeMillis()}"

            when (val result = repository.createItem(
                title = title,
                content = content,
                type = type,
                folderId = folderId,
                tags = tags,
                deviceId = deviceId
            )) {
                is Result.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            operationSuccess = true,
                            successMessage = "创建成功"
                        )
                    }
                    // 刷新列表
                    _searchQuery.value = _searchQuery.value
                }
                is Result.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = result.message ?: "创建失败"
                        )
                    }
                }
                is Result.Loading -> {}
            }
        }
    }

    /**
     * 更新条目
     */
    fun updateItem(
        id: String,
        title: String,
        content: String,
        tags: List<String> = emptyList()
    ) {
        if (title.isBlank()) {
            _uiState.update { it.copy(error = "标题不能为空") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            when (val result = repository.updateItem(id, title, content, tags)) {
                is Result.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            operationSuccess = true,
                            successMessage = "更新成功"
                        )
                    }
                }
                is Result.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = result.message ?: "更新失败"
                        )
                    }
                }
                is Result.Loading -> {}
            }
        }
    }

    /**
     * 删除条目
     */
    fun deleteItem(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            when (val result = repository.deleteItem(id)) {
                is Result.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            operationSuccess = true,
                            successMessage = "删除成功"
                        )
                    }
                    // 刷新列表
                    _searchQuery.value = _searchQuery.value
                }
                is Result.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = result.message ?: "删除失败"
                        )
                    }
                }
                is Result.Loading -> {}
            }
        }
    }

    /**
     * 切换收藏状态
     */
    fun toggleFavorite(id: String) {
        viewModelScope.launch {
            when (repository.toggleFavorite(id)) {
                is Result.Success -> {
                    _searchQuery.value = _searchQuery.value // 触发刷新
                }
                is Result.Error -> {
                    _uiState.update { it.copy(error = "操作失败") }
                }
                is Result.Loading -> {}
            }
        }
    }

    /**
     * 切换置顶状态
     */
    fun togglePinned(id: String) {
        viewModelScope.launch {
            when (repository.togglePinned(id)) {
                is Result.Success -> {
                    _searchQuery.value = _searchQuery.value // 触发刷新
                }
                is Result.Error -> {
                    _uiState.update { it.copy(error = "操作失败") }
                }
                is Result.Loading -> {}
            }
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 清除成功消息
     */
    fun clearSuccess() {
        _uiState.update {
            it.copy(
                operationSuccess = false,
                successMessage = null
            )
        }
    }
}

/**
 * 知识库UI状态
 */
data class KnowledgeUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val operationSuccess: Boolean = false,
    val successMessage: String? = null,
    val searchQuery: String = "",
    val filterMode: FilterMode = FilterMode.ALL,
    val selectedFolderId: String? = null
)

/**
 * 筛选模式
 */
enum class FilterMode {
    ALL,        // 全部
    FAVORITE,   // 收藏
    FOLDER      // 文件夹
}
