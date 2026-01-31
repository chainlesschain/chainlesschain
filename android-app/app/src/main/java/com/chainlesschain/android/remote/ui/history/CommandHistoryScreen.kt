package com.chainlesschain.android.remote.ui.history

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import com.chainlesschain.android.remote.data.CommandHistoryEntity
import com.chainlesschain.android.remote.data.CommandStatus
import com.chainlesschain.android.remote.data.CommandStatistics
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.text.SimpleDateFormat
import java.util.*

/**
 * 命令历史界面
 *
 * 功能：
 * - 查看命令历史列表（分页）
 * - 搜索命令
 * - 按命名空间/状态过滤
 * - 查看命令详情
 * - 重放命令
 * - 删除命令
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommandHistoryScreen(
    viewModel: CommandHistoryViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val statistics by viewModel.statistics.collectAsState(initial = CommandStatistics(0, 0, 0, 0.0))
    val pagedCommands = viewModel.pagedCommands.collectAsLazyPagingItems()

    var searchQuery by remember { mutableStateOf("") }
    var showClearDialog by remember { mutableStateOf(false) }
    var showFilterMenu by remember { mutableStateOf(false) }

    // 重放成功提示
    LaunchedEffect(uiState.replaySuccess) {
        if (uiState.replaySuccess) {
            kotlinx.coroutines.delay(2000)
            viewModel.clearReplaySuccess()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("命令历史") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 过滤菜单
                    Box {
                        IconButton(onClick = { showFilterMenu = true }) {
                            Icon(Icons.Default.FilterList, contentDescription = "过滤")
                        }

                        DropdownMenu(
                            expanded = showFilterMenu,
                            onDismissRequest = { showFilterMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("全部") },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.All)
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.List, null) }
                            )
                            Divider()
                            DropdownMenuItem(
                                text = { Text("AI 命令") },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.ByNamespace("ai"))
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.Psychology, null) }
                            )
                            DropdownMenuItem(
                                text = { Text("系统命令") },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.ByNamespace("system"))
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.Computer, null) }
                            )
                            Divider()
                            DropdownMenuItem(
                                text = { Text("成功") },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.ByStatus(CommandStatus.SUCCESS))
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.CheckCircle, null) }
                            )
                            DropdownMenuItem(
                                text = { Text("失败") },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.ByStatus(CommandStatus.FAILURE))
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.Error, null) }
                            )
                        }
                    }

                    // 清空按钮
                    IconButton(
                        onClick = { showClearDialog = true },
                        enabled = uiState.totalCount > 0
                    ) {
                        Icon(Icons.Default.DeleteSweep, contentDescription = "清空")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 搜索栏
            SearchBar(
                query = searchQuery,
                onQueryChange = { searchQuery = it },
                onSearch = { viewModel.search(searchQuery) },
                onClear = {
                    searchQuery = ""
                    viewModel.clearSearch()
                },
                modifier = Modifier.padding(16.dp)
            )

            // 当前过滤器显示
            if (uiState.currentFilter !is HistoryFilter.All || uiState.searchQuery.isNotEmpty()) {
                CurrentFilterChip(
                    filter = uiState.currentFilter,
                    searchQuery = uiState.searchQuery,
                    onClearFilter = { viewModel.setFilter(HistoryFilter.All) },
                    onClearSearch = { viewModel.clearSearch() },
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }

            // 统计信息
            if (statistics.total > 0) {
                StatisticsCard(
                    statistics = statistics,
                    modifier = Modifier.padding(16.dp)
                )
            }

            // 命令列表
            when {
                pagedCommands.loadState.refresh is LoadState.Loading -> {
                    // 加载中
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                pagedCommands.itemCount == 0 -> {
                    // 空状态
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.History,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                            )
                            Text(
                                text = if (uiState.searchQuery.isNotEmpty()) "未找到匹配的命令" else "暂无命令历史",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                else -> {
                    // 命令列表
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(pagedCommands.itemCount) { index ->
                            val command = pagedCommands[index]
                            command?.let {
                                CommandHistoryItem(
                                    command = it,
                                    onClick = { viewModel.viewCommandDetail(it.id) },
                                    onReplay = {
                                        if (connectionState == ConnectionState.CONNECTED) {
                                            viewModel.replayCommand(it)
                                        }
                                    },
                                    onDelete = { viewModel.deleteCommand(it) },
                                    canReplay = connectionState == ConnectionState.CONNECTED
                                )
                            }
                        }

                        // 加载更多指示器
                        if (pagedCommands.loadState.append is LoadState.Loading) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                }
                            }
                        }
                    }
                }
            }

            // 错误提示
            uiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier.padding(16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearError() }) {
                            Text("关闭")
                        }
                    }
                ) {
                    Text(error)
                }
            }

            // 重放成功提示
            if (uiState.replaySuccess) {
                Snackbar(
                    modifier = Modifier.padding(16.dp),
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.tertiary
                        )
                        Text("命令已重放")
                    }
                }
            }
        }
    }

    // 命令详情对话框
    uiState.selectedCommand?.let { command ->
        CommandDetailDialog(
            command = command,
            onDismiss = { viewModel.closeCommandDetail() },
            onReplay = {
                viewModel.replayCommand(command)
                viewModel.closeCommandDetail()
            },
            canReplay = connectionState == ConnectionState.CONNECTED
        )
    }

    // 清空确认对话框
    if (showClearDialog) {
        ClearConfirmDialog(
            onConfirm = {
                viewModel.clearAllCommands()
                showClearDialog = false
            },
            onDismiss = { showClearDialog = false }
        )
    }
}

/**
 * 搜索栏
 */
@Composable
fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text("搜索命令...") },
        leadingIcon = {
            Icon(Icons.Default.Search, contentDescription = null)
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = onClear) {
                    Icon(Icons.Default.Clear, contentDescription = "清除")
                }
            }
        },
        singleLine = true,
        shape = RoundedCornerShape(28.dp)
    )
}

/**
 * 当前过滤器芯片
 */
@Composable
fun CurrentFilterChip(
    filter: HistoryFilter,
    searchQuery: String,
    onClearFilter: () -> Unit,
    onClearSearch: () -> Unit,
    modifier: Modifier = Modifier
) {
    LazyRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (searchQuery.isNotEmpty()) {
            item {
                FilterChip(
                    selected = true,
                    onClick = onClearSearch,
                    label = { Text("搜索: $searchQuery") },
                    trailingIcon = {
                        Icon(Icons.Default.Close, null, Modifier.size(16.dp))
                    }
                )
            }
        }

        if (filter !is HistoryFilter.All) {
            item {
                FilterChip(
                    selected = true,
                    onClick = onClearFilter,
                    label = {
                        Text(when (filter) {
                            is HistoryFilter.ByNamespace -> "命名空间: ${filter.namespace}"
                            is HistoryFilter.ByStatus -> "状态: ${filter.status.name}"
                            else -> "全部"
                        })
                    },
                    trailingIcon = {
                        Icon(Icons.Default.Close, null, Modifier.size(16.dp))
                    }
                )
            }
        }
    }
}

/**
 * 统计信息卡片
 */
@Composable
fun StatisticsCard(
    statistics: CommandStatistics,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatItem("总计", statistics.total.toString(), Icons.Default.List)
            StatItem("成功", statistics.success.toString(), Icons.Default.CheckCircle, Color(0xFF4CAF50))
            StatItem("失败", statistics.failure.toString(), Icons.Default.Error, Color(0xFFF44336))
            StatItem("平均耗时", "${statistics.avgDuration.toInt()}ms", Icons.Default.Timer)
        }
    }
}

/**
 * 统计项
 */
@Composable
fun StatItem(
    label: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    color: Color = MaterialTheme.colorScheme.onPrimaryContainer
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(20.dp)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = color
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
        )
    }
}

/**
 * 命令历史项
 */
@Composable
fun CommandHistoryItem(
    command: CommandHistoryEntity,
    onClick: () -> Unit,
    onReplay: () -> Unit,
    onDelete: () -> Unit,
    canReplay: Boolean
) {
    val dateFormat = remember { SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault()) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 标题行
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // 命名空间图标
                    Icon(
                        imageVector = when (command.namespace) {
                            "ai" -> Icons.Default.Psychology
                            "system" -> Icons.Default.Computer
                            else -> Icons.Default.Code
                        },
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )

                    Text(
                        text = "${command.namespace}.${command.action}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                }

                // 状态指示器
                CommandStatusBadge(status = command.status)
            }

            // 时间和耗时
            Row(
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = dateFormat.format(Date(command.timestamp)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "${command.duration}ms",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 错误信息（如果有）
            command.error?.let { error ->
                Text(
                    text = error,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            // 操作按钮
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // 重放按钮
                OutlinedButton(
                    onClick = onReplay,
                    enabled = canReplay,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        Icons.Default.Replay,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("重放")
                }

                // 删除按钮
                OutlinedButton(
                    onClick = onDelete,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("删除")
                }
            }
        }
    }
}

/**
 * 命令状态徽章
 */
@Composable
fun CommandStatusBadge(status: CommandStatus) {
    val (text, color) = when (status) {
        CommandStatus.SUCCESS -> "成功" to Color(0xFF4CAF50)
        CommandStatus.FAILURE -> "失败" to Color(0xFFF44336)
        CommandStatus.PENDING -> "等待中" to Color(0xFFFF9800)
        CommandStatus.CANCELLED -> "已取消" to Color(0xFF9E9E9E)
    }

    Surface(
        shape = CircleShape,
        color = color.copy(alpha = 0.15f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Text(
                text = text,
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

/**
 * 命令详情对话框
 */
@Composable
fun CommandDetailDialog(
    command: CommandHistoryEntity,
    onDismiss: () -> Unit,
    onReplay: () -> Unit,
    canReplay: Boolean
) {
    val dateFormat = remember { SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("命令详情") },
        text = {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 命令信息
                item {
                    DetailItem("命令", "${command.namespace}.${command.action}")
                }
                item {
                    DetailItem("状态", command.status.name)
                }
                item {
                    DetailItem("执行时间", dateFormat.format(Date(command.timestamp)))
                }
                item {
                    DetailItem("耗时", "${command.duration}ms")
                }
                item {
                    DetailItem("设备", command.deviceDid)
                }

                // 参数
                if (command.params.isNotEmpty()) {
                    item {
                        Text(
                            text = "参数",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    item {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant
                        ) {
                            Text(
                                text = command.params.entries.joinToString("\n") { "${it.key}: ${it.value}" },
                                modifier = Modifier.padding(12.dp),
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                    }
                }

                // 结果
                command.result?.let { result ->
                    item {
                        Text(
                            text = "结果",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    item {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant
                        ) {
                            Text(
                                text = result,
                                modifier = Modifier.padding(12.dp),
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                maxLines = 10,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }

                // 错误
                command.error?.let { error ->
                    item {
                        Text(
                            text = "错误",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    item {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.errorContainer
                        ) {
                            Text(
                                text = error,
                                modifier = Modifier.padding(12.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (canReplay) {
                TextButton(onClick = onReplay) {
                    Icon(Icons.Default.Replay, null, Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("重放")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        }
    )
}

/**
 * 详情项
 */
@Composable
fun DetailItem(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium
        )
    }
}

/**
 * 清空确认对话框
 */
@Composable
fun ClearConfirmDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("清空命令历史") },
        text = { Text("确定要清空所有命令历史吗？此操作不可恢复。") },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                colors = ButtonDefaults.textButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Text("确定")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
