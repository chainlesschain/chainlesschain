package com.chainlesschain.android.presentation.screens.offline

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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.offline.OfflineCommandEntity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * v1.1 issue #19 OfflineQueue Settings 页。
 *
 * 功能：
 * - 顶部 stats 摘要（total / pending / sending / failed）
 * - 列表显示最近 100 命令（method / age / status / 重试次数 / 错误）
 * - 操作：重试所有 failed / 清空 pending / 刷新
 *
 * 入口：v1.0 没显式 router 接入；后续 V6 Settings panel 加 deep-link `chainlesschain://settings/offline-queue`
 * 时再 wire（v1.0 demo 阶段直接通过 hiltViewModel() 容器化）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OfflineQueueScreen(
    onBack: () -> Unit = {},
    viewModel: OfflineQueueViewModel = hiltViewModel(),
) {
    val stats by viewModel.stats.collectAsState()
    val recent by viewModel.recent.collectAsState()
    val ttlDays by viewModel.ttlDays.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("离线队列") },
                actions = {
                    TextButton(onClick = { viewModel.refresh() }) { Text("刷新") }
                },
            )
        }
    ) { padding ->
        Column(modifier = Modifier
            .fillMaxSize()
            .padding(padding)) {
            StatsHeader(stats.total, stats.pending, stats.sending, stats.failed)

            // v1.2 prep #1：TTL Quick-pick row（用户可配，1d/7d/14d/30d quick-pick）
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                shape = RoundedCornerShape(10.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        "保留期限 (TTL)",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        "超过 $ttlDays 天的命令自动清理；下次启动 + 每 push tick 时校验",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (days in com.chainlesschain.android.remote.offline.OfflineQueuePreferences.QUICK_PICK_DAYS) {
                            FilterChip(
                                selected = ttlDays == days,
                                onClick = { viewModel.setTtlDays(days) },
                                label = { Text("${days}d") },
                            )
                        }
                    }
                }
            }

            // 操作按钮
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = { viewModel.retryFailed() },
                    enabled = stats.failed > 0,
                    modifier = Modifier.weight(1f),
                ) { Text("重试失败 (${stats.failed})") }
                OutlinedButton(
                    onClick = { viewModel.clearAll() },
                    enabled = stats.pending > 0,
                    modifier = Modifier.weight(1f),
                ) { Text("清空 pending") }
            }

            if (recent.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "队列为空",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(items = recent, key = { it.id }) { cmd ->
                        CommandCard(cmd)
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
}

@Composable
private fun StatsHeader(total: Int, pending: Int, sending: Int, failed: Int) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            StatChip(label = "总计", value = total)
            StatChip(label = "待发", value = pending)
            StatChip(label = "发送中", value = sending, color = MaterialTheme.colorScheme.primary)
            StatChip(label = "失败", value = failed, color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun StatChip(
    label: String,
    value: Int,
    color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value.toString(),
            style = MaterialTheme.typography.titleLarge,
            color = color,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun CommandCard(cmd: OfflineCommandEntity) {
    val (bg, fg, label) = when (cmd.status) {
        "pending" -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
            "待发",
        )
        "sending" -> Triple(
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
            "发送中",
        )
        "failed" -> Triple(
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer,
            "失败",
        )
        else -> Triple(
            MaterialTheme.colorScheme.surface,
            MaterialTheme.colorScheme.onSurface,
            cmd.status,
        )
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
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
                Spacer(Modifier.height(0.dp))
                Text(
                    "  ${cmd.method}",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.height(2.dp))
            Text(
                "id ${cmd.id.take(8)}… · ${timeLabel(cmd.timestamp)} · 重试 ${cmd.retries}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontFamily = FontFamily.Monospace,
            )
            cmd.errorMessage?.let { err ->
                Text(
                    "⚠️ $err",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

private fun timeLabel(ms: Long): String {
    val ageSec = (System.currentTimeMillis() - ms) / 1000
    return when {
        ageSec < 60 -> "${ageSec}s 前"
        ageSec < 3600 -> "${ageSec / 60}m 前"
        ageSec < 86400 -> "${ageSec / 3600}h 前"
        else -> SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(ms))
    }
}
