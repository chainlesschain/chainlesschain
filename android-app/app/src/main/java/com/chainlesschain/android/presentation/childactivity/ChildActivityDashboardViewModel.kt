package com.chainlesschain.android.presentation.childactivity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.data.telemetry.TelemetryEventConverter
import com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
import com.chainlesschain.android.telemetry.ChildActivityDashboard
import com.chainlesschain.android.telemetry.ChildActivitySummary
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/** 「孩子活动看板」UI 状态。每个有数据的孩子一份 [ChildActivitySummary]。 */
data class ChildActivityUiState(
    val loading: Boolean = true,
    val children: List<ChildActivitySummary> = emptyList(),
    val windowLabel: String = "近 24 小时",
)

/**
 * 家长端「孩子活动看板」ViewModel（FAMILY-67，主文档 §3.2/§3.6）。
 *
 * 把"采集→上行→收件落库"后存进 child_event 镜像表的事件，经 [ChildActivityDashboard]
 * 纯函数聚合成家长可读摘要：每孩子的每 app 前台时长 / top app / 总屏幕时长 / 来源&分级计数。
 *
 * childDid 解析：观察**全部孩子**最近事件 ([ChildEventRepository.observeRecentAnyChild])，
 * 按 child_did 分组、各自聚合 → 家长配多个孩子时每个一段；单设备(孩子角色)自测时即本机
 * 自身采集的前台用量。聚合是纯函数，仅墙钟窗口 [windowMs] 取自 [now]（VM 允许读时钟）。
 */
@HiltViewModel
class ChildActivityDashboardViewModel @Inject constructor(
    private val childEventRepository: ChildEventRepository,
) : ViewModel() {

    val uiState: StateFlow<ChildActivityUiState> =
        childEventRepository.observeRecentAnyChild(limit = RECENT_LIMIT)
            .map { entities ->
                val now = System.currentTimeMillis()
                val windowStart = now - WINDOW_MS
                val windowEnd = now + 1 // 右开窗口含 now
                val events = entities.mapNotNull { TelemetryEventConverter.fromEntity(it) }
                val summaries = events.map { it.childDid }.distinct()
                    .map { childDid ->
                        ChildActivityDashboard.summarize(
                            childDid = childDid,
                            events = events,
                            windowStartMs = windowStart,
                            windowEndMs = windowEnd,
                        )
                    }
                    .filter { it.totalEvents > 0 }
                    .sortedByDescending { it.totalForegroundMs }
                ChildActivityUiState(loading = false, children = summaries)
            }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ChildActivityUiState())

    private companion object {
        const val RECENT_LIMIT = 1000
        const val WINDOW_MS = 24L * 60 * 60 * 1000
    }
}
