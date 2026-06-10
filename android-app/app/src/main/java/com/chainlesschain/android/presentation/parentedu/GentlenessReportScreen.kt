package com.chainlesschain.android.presentation.parentedu

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.presentation.aistudy.Course
import kotlin.math.roundToInt

/**
 * M10 监管温和度月报屏。家庭 tab「家长成长」卡导航至此 (主文档 §3.10)。
 *
 * 显综合温和度评分 + 同类对比档位 + 关注点 + 推荐课程 + 公益热线入口。下方滑块为
 * 演示: 实时调监管指标可看到评分 / 滥用检测 / 推课如何变化 (引擎为纯函数)。
 */
@Composable
fun GentlenessReportScreen(
    onBack: () -> Unit,
    viewModel: GentlenessReportViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val report = state.report
    val metrics = state.metrics

    Column(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState()),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) { Text("← 返回") }
            Text(
                text = "家长成长 · 监管温和度",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        HorizontalDivider()

        ScoreCard(score = report.score, bandLabel = report.peerBand.label, percentile = report.peerBand.percentile)

        if (report.concerns.isNotEmpty()) {
            Block(title = "建议关注") {
                report.concerns.forEach { BulletLine(it) }
            }
        } else {
            Block(title = "本月节奏") { BulletLine("监管节奏温和，继续保持 👍") }
        }

        if (report.recommendedCourses.isNotEmpty()) {
            Block(title = "推荐课程") {
                report.recommendedCourses.forEach { CourseLine(it) }
            }
        }

        Block(title = "心理支持") {
            Text(
                text = report.helplineNote,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

        Text(
            text = "演示：调整监管指标看温和度变化",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        if (state.fromRealData) {
            Text(
                text = "取消率/延期率已按最近 30 天真实任务史计算，可继续滑动做假设分析",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        MetricSlider("请求拒绝率", "${pct(metrics.rejectionRate)}%", metrics.rejectionRate.toFloat(), 0f..1f) {
            viewModel.setRejectionRate(it)
        }
        MetricSlider("强制关闭应用次数", "${metrics.forceStopCount} 次", metrics.forceStopCount.toFloat(), 0f..80f) {
            viewModel.setForceStopCount(it)
        }
        MetricSlider("强接通次数", "${metrics.urgentCallCount} 次", metrics.urgentCallCount.toFloat(), 0f..20f) {
            viewModel.setUrgentCallCount(it)
        }
        MetricSlider("任务延期率", "${pct(metrics.taskDeferralRate)}%", metrics.taskDeferralRate.toFloat(), 0f..1f) {
            viewModel.setTaskDeferralRate(it)
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun ScoreCard(score: Int, bandLabel: String, percentile: Int?) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("本月监管温和度", style = MaterialTheme.typography.labelMedium)
            Text(
                text = "$score 分",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = if (percentile != null) "同类家长中$bandLabel（百分位 $percentile）" else bandLabel,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Block(title: String, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        content()
    }
}

@Composable
private fun BulletLine(text: String) {
    Text("· $text", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 1.dp))
}

@Composable
private fun CourseLine(course: Course) {
    Text("📘 ${course.title}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 1.dp))
}

@Composable
private fun MetricSlider(
    label: String,
    valueText: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onChange: (Float) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodySmall)
            Text(valueText, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
        }
        Slider(value = value, onValueChange = onChange, valueRange = range)
    }
}

private fun pct(v: Double): Int = (v.coerceIn(0.0, 1.0) * 100).roundToInt()
