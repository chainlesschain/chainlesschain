package com.chainlesschain.android.presentation.screens.progress

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.task.LongRunningTask
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * M4 ProgressViewer Compose 屏。订阅 LongTaskRegistry，渲染所有桌面长时任务的进度
 * 卡片：Running 显示 LinearProgressIndicator（确定值用 progress，否则 indeterminate）；
 * Completed/Failed/Cancelled 各自彩色 chip + 错误信息；用户可逐条 dismiss 或一键
 * "清除已完成"。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressViewerScreen(
    onBack: () -> Unit = {},
    viewModel: ProgressViewerViewModel = hiltViewModel(),
) {
    val tasks by viewModel.tasks.collectAsState()
    val terminalCount = tasks.count { it.isTerminal() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("任务进度") },
                actions = {
                    if (terminalCount > 0) {
                        TextButton(onClick = { viewModel.clearTerminal() }) {
                            Text("清除已完成($terminalCount)")
                        }
                    }
                },
            )
        }
    ) { padding ->
        if (tasks.isEmpty()) {
            EmptyState(modifier = Modifier.padding(padding))
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(items = tasks, key = { it.id }) { task ->
                    TaskCard(
                        task = task,
                        onDismiss = { viewModel.dismiss(task.id) },
                    )
                }
                item {
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onBack,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("返回") }
                }
            }
        }
    }
}

@Composable
private fun TaskCard(task: LongRunningTask, onDismiss: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        StatusChip(state = task.state)
                        Spacer(Modifier.height(0.dp))
                        Text(
                            "  ${task.title}",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    task.description?.let {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (task.isTerminal()) {
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.height(28.dp),
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "dismiss",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            when (task.state) {
                LongRunningTask.State.Pending -> Text(
                    "等待开始…",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                LongRunningTask.State.Running -> RunningProgress(task.progress)
                LongRunningTask.State.Completed -> Text(
                    "已完成 · ${timeLabel(task.updatedAt)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                LongRunningTask.State.Failed -> Text(
                    "失败 · ${task.errorMessage ?: "-"}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                )
                LongRunningTask.State.Cancelled -> Text(
                    "已取消 · ${task.errorMessage ?: "用户撤回"}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun RunningProgress(progress: Float?) {
    if (progress != null) {
        Column {
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "${(progress * 100).toInt()}%",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    } else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(
                modifier = Modifier.height(16.dp),
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.height(0.dp))
            Text(
                "  正在运行…",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StatusChip(state: LongRunningTask.State) {
    val (bg, fg, label) = when (state) {
        LongRunningTask.State.Pending -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
            "等待",
        )
        LongRunningTask.State.Running -> Triple(
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
            "运行中",
        )
        LongRunningTask.State.Completed -> Triple(
            MaterialTheme.colorScheme.tertiaryContainer,
            MaterialTheme.colorScheme.onTertiaryContainer,
            "已完成",
        )
        LongRunningTask.State.Failed -> Triple(
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer,
            "失败",
        )
        LongRunningTask.State.Cancelled -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
            "已取消",
        )
    }
    Surface(
        shape = RoundedCornerShape(4.dp),
        color = bg,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = fg,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun EmptyState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "暂无任务",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun timeLabel(ms: Long): String {
    val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    return fmt.format(Date(ms))
}
