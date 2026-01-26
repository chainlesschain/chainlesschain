package com.chainlesschain.android.feature.ai.presentation.usage

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.domain.usage.UsageStatistics

/**
 * Token使用统计界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageStatisticsScreen(
    onNavigateBack: () -> Unit,
    viewModel: UsageStatisticsViewModel = hiltViewModel()
) {
    val allUsage by viewModel.allUsage.collectAsState()
    var showClearDialog by remember { mutableStateOf(false) }
    var selectedProvider by remember { mutableStateOf<LLMProvider?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Token使用统计") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                    IconButton(onClick = { showClearDialog = true }) {
                        Icon(Icons.Default.Delete, contentDescription = "清除")
                    }
                }
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 总览卡片
            item {
                TotalUsageCard(allUsage)
            }

            // 各提供商统计
            items(allUsage) { usage ->
                ProviderUsageCard(
                    usage = usage,
                    onClear = {
                        selectedProvider = usage.provider
                        showClearDialog = true
                    }
                )
            }

            // 空状态提示
            if (allUsage.isEmpty()) {
                item {
                    EmptyUsageState()
                }
            }
        }
    }

    // 清除确认对话框
    if (showClearDialog) {
        AlertDialog(
            onDismissRequest = { showClearDialog = false },
            title = {
                Text(
                    text = if (selectedProvider != null) {
                        "清除${selectedProvider!!.displayName}的统计数据？"
                    } else {
                        "清除所有统计数据？"
                    }
                )
            },
            text = { Text("此操作不可撤销") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.clearUsage(selectedProvider)
                        showClearDialog = false
                        selectedProvider = null
                    }
                ) {
                    Text("确认", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showClearDialog = false
                    selectedProvider = null
                }) {
                    Text("取消")
                }
            }
        )
    }
}

/**
 * 总览卡片
 */
@Composable
private fun TotalUsageCard(allUsage: List<UsageStatistics>) {
    val totalTokens = allUsage.sumOf { it.totalTokens }
    val totalCost = allUsage.sumOf { it.estimatedCost }
    val totalRequests = allUsage.sumOf { it.requestCount }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(20.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "总使用量",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "所有提供商统计",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                    )
                }
                Icon(
                    imageVector = Icons.Default.Analytics,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.6f)
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            // 统计数据
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatisticItem(
                    icon = Icons.Default.Token,
                    label = "总Tokens",
                    value = formatNumber(totalTokens),
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                StatisticItem(
                    icon = Icons.Default.AttachMoney,
                    label = "总成本",
                    value = "$${String.format("%.4f", totalCost)}",
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                StatisticItem(
                    icon = Icons.Default.Chat,
                    label = "总请求",
                    value = formatNumber(totalRequests),
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }
    }
}

/**
 * 提供商使用卡片
 */
@Composable
private fun ProviderUsageCard(
    usage: UsageStatistics,
    onClear: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            // 标题行
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = usage.provider.displayName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "请求次数: ${usage.requestCount}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                IconButton(onClick = onClear) {
                    Icon(
                        Icons.Default.DeleteOutline,
                        contentDescription = "清除",
                        tint = MaterialTheme.colorScheme.error
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Token使用详情
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        text = "输入Token",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = formatNumber(usage.inputTokens),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium
                    )
                }

                Column {
                    Text(
                        text = "输出Token",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = formatNumber(usage.outputTokens),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium
                    )
                }

                Column {
                    Text(
                        text = "总计",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = formatNumber(usage.totalTokens),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // 成本
            Divider()
            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.AttachMoney,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.tertiary
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "预估成本",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                Text(
                    text = if (usage.estimatedCost == 0.0) {
                        "免费"
                    } else {
                        "$${String.format("%.6f", usage.estimatedCost)} USD"
                    },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (usage.estimatedCost == 0.0) {
                        MaterialTheme.colorScheme.tertiary
                    } else {
                        MaterialTheme.colorScheme.error
                    }
                )
            }
        }
    }
}

/**
 * 统计项
 */
@Composable
private fun StatisticItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
    color: androidx.compose.ui.graphics.Color
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = color.copy(alpha = 0.7f)
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = color
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color.copy(alpha = 0.7f)
        )
    }
}

/**
 * 空状态
 */
@Composable
private fun EmptyUsageState() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.Default.ShowChart,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "暂无使用数据",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "开始使用AI功能后，这里会显示统计信息",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
        )
    }
}

/**
 * 格式化数字
 */
private fun formatNumber(number: Long): String {
    return when {
        number >= 1_000_000 -> String.format("%.1fM", number / 1_000_000.0)
        number >= 1_000 -> String.format("%.1fK", number / 1_000.0)
        else -> number.toString()
    }
}
