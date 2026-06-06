package com.chainlesschain.android.presentation.parentedu

import androidx.lifecycle.ViewModel
import com.chainlesschain.android.presentation.aistudy.GentlenessReport
import com.chainlesschain.android.presentation.aistudy.GuardianMetrics
import com.chainlesschain.android.presentation.aistudy.ParentEducationEngine
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

data class GentlenessUiState(
    val metrics: GuardianMetrics,
    val report: GentlenessReport,
)

/**
 * M10 监管温和度月报屏的 ViewModel。把 [ParentEducationEngine] 纯函数接到界面
 * (主文档 §3.10)。
 *
 * v0.1 演示: [GentlenessUiState.metrics] 为可调演示数据 (滑块实时驱动), peer 分布用脱敏
 * 样本常量, 让家长直观看到"评分 + 滥用检测 + 同类对比 + 推课"如何随监管行为变化。
 *
 * 真实接线 (设备/后端阻塞 follow-up): metrics 由 M2 telemetry 30 天聚合得到、
 * peerScores 由后端去隐私化统计分布下发、推课接微课程平台。
 */
@HiltViewModel
class GentlenessReportViewModel @Inject constructor() : ViewModel() {

    private val _uiState = MutableStateFlow(build(DEMO_METRICS))
    val uiState: StateFlow<GentlenessUiState> = _uiState.asStateFlow()

    fun setRejectionRate(v: Float) = recompute { it.copy(rejectionRate = v.toDouble()) }
    fun setForceStopCount(v: Float) = recompute { it.copy(forceStopCount = v.toInt()) }
    fun setUrgentCallCount(v: Float) = recompute { it.copy(urgentCallCount = v.toInt()) }
    fun setTaskDeferralRate(v: Float) = recompute { it.copy(taskDeferralRate = v.toDouble()) }

    private fun recompute(transform: (GuardianMetrics) -> GuardianMetrics) {
        _uiState.value = build(transform(_uiState.value.metrics))
    }

    private fun build(metrics: GuardianMetrics) = GentlenessUiState(
        metrics = metrics,
        report = ParentEducationEngine.generateReport(metrics = metrics, peerScores = PEER_SCORES),
    )

    private companion object {
        val DEMO_METRICS = GuardianMetrics(
            rejectionRate = 0.73,
            cancellationRate = 0.2,
            forceStopCount = 35,
            urgentCallCount = 4,
            taskDeferralRate = 0.45,
        )

        /** 脱敏同类家长温和度样本 (演示)。 */
        val PEER_SCORES = listOf(40, 52, 58, 63, 68, 72, 75, 80, 85, 90)
    }
}
