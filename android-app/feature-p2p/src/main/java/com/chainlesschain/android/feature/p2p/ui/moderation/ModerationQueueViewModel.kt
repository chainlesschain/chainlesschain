package com.chainlesschain.android.feature.p2p.ui.moderation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.ModerationStatus
import com.chainlesschain.android.core.model.Result
import com.chainlesschain.android.feature.p2p.repository.moderation.ModerationQueueItem
import com.chainlesschain.android.feature.p2p.repository.moderation.ModerationQueueRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 审核队列ViewModel
 */
@HiltViewModel
class ModerationQueueViewModel @Inject constructor(
    private val moderationQueueRepository: ModerationQueueRepository
) : ViewModel() {

    // UI状态
    private val _uiState = MutableStateFlow(ModerationQueueUiState())
    val uiState: StateFlow<ModerationQueueUiState> = _uiState.asStateFlow()

    // 当前选中的标签
    private val _currentTab = MutableStateFlow(ModerationTab.PENDING)

    init {
        loadData()
        loadStatistics()
    }

    /**
     * 加载数据
     */
    private fun loadData() {
        viewModelScope.launch {
            _currentTab.flatMapLatest { tab ->
                when (tab) {
                    ModerationTab.PENDING -> moderationQueueRepository.getPendingItems()
                    ModerationTab.APPEALING -> moderationQueueRepository.getAppealingItems()
                    ModerationTab.ALL -> moderationQueueRepository.getItemsByStatus(
                        ModerationStatus.PENDING
                    ).combine(
                        moderationQueueRepository.getItemsByStatus(ModerationStatus.APPEALING)
                    ) { pending, appealing ->
                        when {
                            pending is Result.Success && appealing is Result.Success ->
                                Result.Success(pending.data + appealing.data)
                            pending is Result.Error -> pending
                            appealing is Result.Error -> appealing
                            else -> Result.Success(emptyList())
                        }
                    }
                }
            }.collect { result ->
                when (result) {
                    is Result.Success -> {
                        _uiState.update { state ->
                            state.copy(
                                items = result.data.sortedByDescending { it.createdAt },
                                isLoading = false,
                                currentTab = _currentTab.value
                            )
                        }
                    }
                    is Result.Error -> {
                        _uiState.update { state ->
                            state.copy(
                                isLoading = false,
                                message = "加载失败: ${result.exception.message}"
                            )
                        }
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
                moderationQueueRepository.getPendingCount(),
                moderationQueueRepository.getAppealingCount()
            ) { pendingResult, appealingResult ->
                val pendingCount = (pendingResult as? Result.Success)?.data ?: 0
                val appealingCount = (appealingResult as? Result.Success)?.data ?: 0
                ModerationStatistics(pendingCount, appealingCount)
            }.collect { statistics ->
                _uiState.update { it.copy(statistics = statistics) }
            }
        }
    }

    /**
     * 选择标签
     */
    fun selectTab(tab: ModerationTab) {
        _currentTab.value = tab
    }

    /**
     * 批准内容
     */
    fun approveContent(id: Long) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // TODO: 获取当前用户DID
            val reviewerDid = "current_user_did"

            when (val result = moderationQueueRepository.approveContent(
                id = id,
                reviewerDid = reviewerDid,
                note = "审核通过"
            )) {
                is Result.Success -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "已批准"
                        )
                    }
                }
                is Result.Error -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "操作失败: ${result.exception.message}"
                        )
                    }
                }
            }
        }
    }

    /**
     * 拒绝内容
     */
    fun rejectContent(id: Long) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val reviewerDid = "current_user_did"

            when (val result = moderationQueueRepository.rejectContent(
                id = id,
                reviewerDid = reviewerDid,
                note = "审核拒绝"
            )) {
                is Result.Success -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "已拒绝"
                        )
                    }
                }
                is Result.Error -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "操作失败: ${result.exception.message}"
                        )
                    }
                }
            }
        }
    }

    /**
     * 删除内容
     */
    fun deleteContent(id: Long) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val reviewerDid = "current_user_did"

            when (val result = moderationQueueRepository.deleteContent(
                id = id,
                reviewerDid = reviewerDid,
                note = "违规删除"
            )) {
                is Result.Success -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "已删除"
                        )
                    }
                }
                is Result.Error -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "操作失败: ${result.exception.message}"
                        )
                    }
                }
            }
        }
    }

    /**
     * 批准申诉
     */
    fun approveAppeal(id: Long) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            when (val result = moderationQueueRepository.approveAppeal(
                id = id,
                appealResult = "申诉通过，恢复内容"
            )) {
                is Result.Success -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "申诉已批准"
                        )
                    }
                }
                is Result.Error -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "操作失败: ${result.exception.message}"
                        )
                    }
                }
            }
        }
    }

    /**
     * 拒绝申诉
     */
    fun rejectAppeal(id: Long) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            when (val result = moderationQueueRepository.rejectAppeal(
                id = id,
                appealResult = "申诉被拒绝，维持原决定"
            )) {
                is Result.Success -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "申诉已拒绝"
                        )
                    }
                }
                is Result.Error -> {
                    _uiState.update { state ->
                        state.copy(
                            isLoading = false,
                            message = "操作失败: ${result.exception.message}"
                        )
                    }
                }
            }
        }
    }

    /**
     * 清除消息
     */
    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}

/**
 * UI状态
 */
data class ModerationQueueUiState(
    val items: List<ModerationQueueItem> = emptyList(),
    val currentTab: ModerationTab = ModerationTab.PENDING,
    val isLoading: Boolean = true,
    val message: String? = null,
    val statistics: ModerationStatistics? = null
)

/**
 * 审核标签
 */
enum class ModerationTab(val displayName: String) {
    PENDING("待审核"),
    APPEALING("申诉中"),
    ALL("全部")
}

/**
 * 统计数据
 */
data class ModerationStatistics(
    val pendingCount: Int,
    val appealingCount: Int
)
