package com.chainlesschain.android.presentation.childactivity

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import com.chainlesschain.android.telemetry.AppUsage
import com.chainlesschain.android.telemetry.ChildActivitySummary

/**
 * 家长端「孩子活动看板」屏（FAMILY-67，主文档 §3.2/§3.6）。家庭 tab「孩子活动」卡导航至此。
 *
 * 渲染 [ChildActivityDashboardViewModel] 聚合出的每孩子摘要：近 24h 总屏幕时长 + top app
 * 用量条 + 来源/分级计数。隐私：仅展示"哪个 app 用多久"(L1)，不含聊天内容原文。
 * 数据来自 child_event 镜像表（孩子端采集→上行→收件落库）；单设备孩子角色自测时为本机自身采集。
 */
@Composable
fun ChildActivityDashboardScreen(
    onBack: () -> Unit,
    viewModel: ChildActivityDashboardViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onBack) { Text("← 返回") }
                Text(
                    text = "孩子活动 · ${state.windowLabel}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
            }
            HorizontalDivider()

            when {
                state.loading -> CenterHint("加载中…")
                state.children.isEmpty() -> CenterHint(
                    "暂无孩子活动数据。\n孩子端授予「使用情况访问」权限并配对同步后，这里会显示每个 app 的使用时长。",
                )
                else -> LazyColumn(
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(vertical = 12.dp),
                ) {
                    items(items = state.children, key = { it.childDid }) { summary ->
                        ChildActivityCard(summary)
                    }
                }
            }
        }
    }
}

@Composable
private fun CenterHint(text: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ChildActivityCard(summary: ChildActivitySummary) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "孩子 ${shortDid(summary.childDid)}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "总屏幕时长 ${formatDuration(summary.totalForegroundMs)} · 事件 ${summary.totalEvents} 条",
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(12.dp))

            if (summary.topApps.isEmpty()) {
                Text("近 24h 无前台 app 记录", style = MaterialTheme.typography.bodySmall)
            } else {
                Text("使用最多的 app", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(6.dp))
                val maxMs = summary.topApps.first().totalMs.coerceAtLeast(1L)
                summary.topApps.forEach { app -> AppUsageRow(app, maxMs) }
            }

            Spacer(Modifier.height(12.dp))
            Text(
                text = "数据粒度：${levelLine(summary)}",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun AppUsageRow(app: AppUsage, maxMs: Long) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = appLabel(app.packageName),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = "${formatDuration(app.totalMs)} · ${app.sessions} 次",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        LinearProgressIndicator(
            progress = { (app.totalMs.toFloat() / maxMs).coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().height(6.dp).padding(top = 2.dp),
        )
    }
}

/** "L1×3, L2×1" 这样的粒度行，透明展示家长当前能看到的级别分布。 */
private fun levelLine(summary: ChildActivitySummary): String =
    if (summary.eventsByLevel.isEmpty()) {
        "—"
    } else {
        summary.eventsByLevel.entries
            .sortedBy { it.key.ordinalLevel }
            .joinToString(", ") { "${it.key.name}×${it.value}" }
    }

/** 包名取末段做简易展示（无应用名解析时的兜底；真应用名需 PackageManager，在设备侧补）。 */
private fun appLabel(packageName: String): String =
    packageName.substringAfterLast('.').ifBlank { packageName }

private fun shortDid(did: String): String =
    if (did.length <= 16) did else "${did.take(10)}…${did.takeLast(4)}"

private fun formatDuration(ms: Long): String {
    val totalSec = ms / 1000
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return when {
        h > 0 -> "${h}h${m}m"
        m > 0 -> "${m}m"
        else -> "${s}s"
    }
}
