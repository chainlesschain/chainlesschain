package com.chainlesschain.android.presentation.screens.offline

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.offline.OfflineCommandEntity
import com.chainlesschain.android.remote.offline.OfflineCommandQueue
import com.chainlesschain.android.remote.offline.QueueStats
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * v1.1 issue #19 OfflineQueue Settings 页 ViewModel — 包 [OfflineCommandQueue]，给 UI
 * 暴露 stats / recent commands / 4 个动作 (refresh / dismiss / retry-failed / clear-all)。
 */
@HiltViewModel
class OfflineQueueViewModel @Inject constructor(
    private val queue: OfflineCommandQueue,
) : ViewModel() {

    val stats: StateFlow<QueueStats> = queue.stats

    private val _recent = MutableStateFlow<List<OfflineCommandEntity>>(emptyList())
    val recent: StateFlow<List<OfflineCommandEntity>> = _recent.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _recent.value = queue.getRecentCommands(limit = 100)
        }
    }

    /** 重试所有 status="failed" 的命令（reset retries=0 → status=pending → 立即 try send 一次）。 */
    fun retryFailed() {
        viewModelScope.launch {
            queue.retryFailedCommands()
            refresh()
        }
    }

    /** 清掉所有 pending 命令（不动 sent/failed）。 */
    fun clearAll() {
        viewModelScope.launch {
            queue.clear()
            refresh()
        }
    }
}
