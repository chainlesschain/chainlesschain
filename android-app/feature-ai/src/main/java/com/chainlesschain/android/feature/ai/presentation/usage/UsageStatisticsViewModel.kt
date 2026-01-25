package com.chainlesschain.android.feature.ai.presentation.usage

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.domain.usage.UsageStatistics
import com.chainlesschain.android.feature.ai.domain.usage.UsageTracker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Token使用统计ViewModel
 */
@HiltViewModel
class UsageStatisticsViewModel @Inject constructor(
    private val usageTracker: UsageTracker
) : ViewModel() {

    private val _allUsage = MutableStateFlow<List<UsageStatistics>>(emptyList())
    val allUsage: StateFlow<List<UsageStatistics>> = _allUsage.asStateFlow()

    init {
        loadUsage()
    }

    /**
     * 加载使用统计
     */
    private fun loadUsage() {
        viewModelScope.launch {
            usageTracker.getAllUsage().collect { usage ->
                _allUsage.value = usage.sortedByDescending { it.totalTokens }
            }
        }
    }

    /**
     * 刷新统计
     */
    fun refresh() {
        loadUsage()
    }

    /**
     * 清除统计数据
     */
    fun clearUsage(provider: LLMProvider? = null) {
        viewModelScope.launch {
            usageTracker.clearUsage(provider)
            loadUsage()
        }
    }
}
