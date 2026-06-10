package com.chainlesschain.android.presentation.parentedu

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.presentation.aistudy.GentlenessReport
import com.chainlesschain.android.presentation.aistudy.GuardianMetrics
import com.chainlesschain.android.presentation.aistudy.ParentEducationEngine
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class GentlenessUiState(
    val metrics: GuardianMetrics,
    val report: GentlenessReport,
    /** cancellation/deferral 是否来自真实任务史 (M5 family_task 30 天窗口)。 */
    val fromRealData: Boolean = false,
)

/**
 * M10 监管温和度月报屏的 ViewModel。把 [ParentEducationEngine] 纯函数接到界面
 * (主文档 §3.10)。
 *
 * v0.2: init 经 [GuardianMetricsAggregator] 从 M5 family_task 真实任务史导出
 * cancellation/deferral 率 (无任务史时回落演示数据); 滑块仍可在其上做 what-if 调整。
 *
 * 真实接线 (设备/后端阻塞 follow-up): forceStop/urgentCall/rejection 由 M4 执行层 +
 * 审批日志计数注入 ([GuardianMetricsAggregator.TelemetryCounts] seam)、peerScores 由
 * 后端去隐私化统计分布下发、推课接微课程平台。
 */
@HiltViewModel
class GentlenessReportViewModel @Inject constructor(
    private val taskRepository: FamilyTaskRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(build(DEMO_METRICS))
    val uiState: StateFlow<GentlenessUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val tasks = runCatching { taskRepository.observeForChild(DEMO_CHILD_DID).first() }
                .getOrDefault(emptyList())
            if (tasks.isNotEmpty()) {
                val real = GuardianMetricsAggregator.aggregate(
                    tasks = tasks,
                    now = System.currentTimeMillis(),
                    // forceStop/urgentCall/rejection 采集缺口: 保留演示值, 不假装为 0 真值。
                    telemetry = GuardianMetricsAggregator.TelemetryCounts(
                        forceStopCount = DEMO_METRICS.forceStopCount,
                        urgentCallCount = DEMO_METRICS.urgentCallCount,
                        rejectionRate = DEMO_METRICS.rejectionRate,
                    ),
                )
                _uiState.value = build(real, fromRealData = true)
            }
        }
    }

    fun setRejectionRate(v: Float) = recompute { it.copy(rejectionRate = v.toDouble()) }
    fun setForceStopCount(v: Float) = recompute { it.copy(forceStopCount = v.toInt()) }
    fun setUrgentCallCount(v: Float) = recompute { it.copy(urgentCallCount = v.toInt()) }
    fun setTaskDeferralRate(v: Float) = recompute { it.copy(taskDeferralRate = v.toDouble()) }

    private fun recompute(transform: (GuardianMetrics) -> GuardianMetrics) {
        _uiState.value = build(transform(_uiState.value.metrics), _uiState.value.fromRealData)
    }

    private fun build(metrics: GuardianMetrics, fromRealData: Boolean = false) = GentlenessUiState(
        metrics = metrics,
        report = ParentEducationEngine.generateReport(metrics = metrics, peerScores = PEER_SCORES),
        fromRealData = fromRealData,
    )

    private companion object {
        /** 演示/缺口回落值 (真实任务史只覆盖 cancellation/deferral 两项)。 */
        val DEMO_METRICS = GuardianMetrics(
            rejectionRate = 0.73,
            cancellationRate = 0.2,
            forceStopCount = 35,
            urgentCallCount = 4,
            taskDeferralRate = 0.45,
        )

        /** 脱敏同类家长温和度样本 (演示; 真实分布由后端下发是 follow-up)。 */
        val PEER_SCORES = listOf(40, 52, 58, 63, 68, 72, 75, 80, 85, 90)

        /** 与 FamilyTaskViewModel 一致的演示 child DID (配对流程 FAMILY-13 后替真)。 */
        const val DEMO_CHILD_DID = "did:chain:local-child"
    }
}
