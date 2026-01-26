package com.chainlesschain.android.feature.p2p.ui.call

import androidx.compose.foundation.clickable
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
import com.chainlesschain.android.core.database.entity.call.CallHistoryEntity
import com.chainlesschain.android.core.database.entity.call.CallType
import com.chainlesschain.android.core.database.entity.call.MediaType
import java.text.SimpleDateFormat
import java.util.*

/**
 * 通话历史记录界面
 *
 * 展示所有通话记录，支持搜索、筛选和删除
 *
 * @param onNavigateBack 返回回调
 * @param onCallHistoryClick 点击通话记录回调
 * @param viewModel ViewModel
 *
 * @since v0.32.0
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallHistoryScreen(
    onNavigateBack: () -> Unit,
    onCallHistoryClick: (CallHistoryEntity) -> Unit = {},
    viewModel: CallHistoryViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val filterType by viewModel.filterType.collectAsState()

    val snackbarHostState = remember { SnackbarHostState() }
    var showFilterDialog by remember { mutableStateOf(false) }
    var showDeleteAllDialog by remember { mutableStateOf(false) }
    var showCleanupDialog by remember { mutableStateOf(false) }

    // Snackbar消息处理
    LaunchedEffect(uiState.snackbarMessage) {
        uiState.snackbarMessage?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.clearSnackbarMessage()
        }
    }

    // 错误处理
    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            snackbarHostState.showSnackbar(
                message = error,
                duration = SnackbarDuration.Long
            )
            viewModel.clearError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("通话记录")
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, "返回")
                    }
                },
                actions = {
                    // 搜索
                    IconButton(onClick = { /* TODO: 展开搜索框 */ }) {
                        Icon(Icons.Default.Search, "搜索")
                    }

                    // 筛选
                    IconButton(onClick = { showFilterDialog = true }) {
                        Icon(
                            if (filterType == FilterType.ALL)
                                Icons.Default.FilterList
                            else
                                Icons.Default.FilterAlt,
                            "筛选"
                        )
                    }

                    // 更多选项
                    var showMenu by remember { mutableStateOf(false) }
                    Box {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(Icons.Default.MoreVert, "更多")
                        }
                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("清理记录") },
                                onClick = {
                                    showMenu = false
                                    showCleanupDialog = true
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.Delete, null)
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("清空所有") },
                                onClick = {
                                    showMenu = false
                                    showDeleteAllDialog = true
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.DeleteForever, null)
                                }
                            )
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                uiState.isLoading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                uiState.callHistory.isEmpty() -> {
                    EmptyCallHistoryView(
                        modifier = Modifier.align(Alignment.Center),
                        filterType = filterType
                    )
                }
                else -> {
                    Column {
                        // 统计卡片
                        if (filterType == FilterType.ALL) {
                            CallStatisticsCard(
                                totalCount = uiState.totalCallCount,
                                missedCount = uiState.missedCallCount,
                                modifier = Modifier.padding(16.dp)
                            )
                        }

                        // 通话列表
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(
                                items = uiState.callHistory,
                                key = { it.id }
                            ) { callHistory ->
                                CallHistoryItem(
                                    callHistory = callHistory,
                                    onClick = { onCallHistoryClick(callHistory) },
                                    onDelete = { viewModel.deleteCallHistory(callHistory.id) }
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // 筛选对话框
    if (showFilterDialog) {
        FilterDialog(
            currentFilter = filterType,
            onFilterSelected = {
                viewModel.setFilterType(it)
                showFilterDialog = false
            },
            onDismiss = { showFilterDialog = false }
        )
    }

    // 清空所有对话框
    if (showDeleteAllDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteAllDialog = false },
            title = { Text("清空所有通话记录") },
            text = { Text("确定要删除所有通话记录吗？此操作不可恢复。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.deleteAllCallHistory()
                        showDeleteAllDialog = false
                    }
                ) {
                    Text("确定", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteAllDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    // 清理记录对话框
    if (showCleanupDialog) {
        CleanupDialog(
            onCleanup = { days ->
                viewModel.deleteOlderThan(days)
                showCleanupDialog = false
            },
            onDismiss = { showCleanupDialog = false }
        )
    }
}

/**
 * 统计卡片
 */
@Composable
private fun CallStatisticsCard(
    totalCount: Int,
    missedCount: Int,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = totalCount.toString(),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "总通话",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            VerticalDivider(modifier = Modifier.height(48.dp))

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = missedCount.toString(),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (missedCount > 0)
                        MaterialTheme.colorScheme.error
                    else
                        MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "未接来电",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 通话记录条目
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CallHistoryItem(
    callHistory: CallHistoryEntity,
    onClick: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showDeleteDialog by remember { mutableStateOf(false) }

    Card(
        modifier = modifier.fillMaxWidth(),
        onClick = onClick
    ) {
        ListItem(
            headlineContent = {
                Text(
                    text = callHistory.peerName,
                    fontWeight = FontWeight.Medium
                )
            },
            supportingContent = {
                Column {
                    Text(
                        text = formatCallTime(callHistory.startTime),
                        style = MaterialTheme.typography.bodySmall
                    )
                    if (callHistory.duration > 0) {
                        Text(
                            text = formatDuration(callHistory.duration),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            },
            leadingContent = {
                Icon(
                    imageVector = getCallTypeIcon(callHistory.callType, callHistory.mediaType),
                    contentDescription = null,
                    tint = getCallTypeColor(callHistory.callType)
                )
            },
            trailingContent = {
                IconButton(onClick = { showDeleteDialog = true }) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = "删除",
                        tint = MaterialTheme.colorScheme.error
                    )
                }
            }
        )
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("删除通话记录") },
            text = { Text("确定要删除这条通话记录吗？") },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDelete()
                        showDeleteDialog = false
                    }
                ) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("取消")
                }
            }
        )
    }
}

/**
 * 空状态视图
 */
@Composable
private fun EmptyCallHistoryView(
    filterType: FilterType,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.CallEnd,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = when (filterType) {
                FilterType.MISSED -> "暂无未接来电"
                FilterType.TODAY -> "今天还没有通话记录"
                FilterType.WEEK -> "本周还没有通话记录"
                FilterType.MONTH -> "本月还没有通话记录"
                else -> "暂无通话记录"
            },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 筛选对话框
 */
@Composable
private fun FilterDialog(
    currentFilter: FilterType,
    onFilterSelected: (FilterType) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("筛选通话记录") },
        text = {
            Column {
                FilterType.values().forEach { type ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onFilterSelected(type) }
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = currentFilter == type,
                            onClick = { onFilterSelected(type) }
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = when (type) {
                                FilterType.ALL -> "全部"
                                FilterType.MISSED -> "未接来电"
                                FilterType.OUTGOING -> "呼出"
                                FilterType.INCOMING -> "接听"
                                FilterType.AUDIO -> "音频通话"
                                FilterType.VIDEO -> "视频通话"
                                FilterType.TODAY -> "今天"
                                FilterType.WEEK -> "本周"
                                FilterType.MONTH -> "本月"
                            }
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        }
    )
}

/**
 * 清理对话框
 */
@Composable
private fun CleanupDialog(
    onCleanup: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("清理通话记录") },
        text = {
            Column {
                Text("删除多久之前的记录？")
                Spacer(modifier = Modifier.height(8.dp))
                listOf(
                    7 to "7天前",
                    30 to "30天前",
                    90 to "90天前",
                    180 to "180天前"
                ).forEach { (days, label) ->
                    TextButton(
                        onClick = { onCleanup(days) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(label)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

/**
 * 获取通话类型图标
 */
private fun getCallTypeIcon(callType: CallType, mediaType: MediaType): androidx.compose.ui.graphics.vector.ImageVector {
    return when (callType) {
        CallType.OUTGOING -> if (mediaType == MediaType.VIDEO) Icons.Default.Videocam else Icons.Default.CallMade
        CallType.INCOMING -> if (mediaType == MediaType.VIDEO) Icons.Default.Videocam else Icons.Default.CallReceived
        CallType.MISSED -> Icons.Default.CallMissed
    }
}

/**
 * 获取通话类型颜色
 */
@Composable
private fun getCallTypeColor(callType: CallType): androidx.compose.ui.graphics.Color {
    return when (callType) {
        CallType.MISSED -> MaterialTheme.colorScheme.error
        CallType.OUTGOING -> MaterialTheme.colorScheme.primary
        CallType.INCOMING -> MaterialTheme.colorScheme.tertiary
    }
}

/**
 * 格式化通话时间
 */
private fun formatCallTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "刚刚"
        diff < 3600_000 -> "${diff / 60_000}分钟前"
        diff < 86400_000 -> {
            val sdf = SimpleDateFormat("HH:mm", Locale.getDefault())
            "今天 ${sdf.format(Date(timestamp))}"
        }
        diff < 172800_000 -> {
            val sdf = SimpleDateFormat("HH:mm", Locale.getDefault())
            "昨天 ${sdf.format(Date(timestamp))}"
        }
        else -> {
            val sdf = SimpleDateFormat("MM-dd HH:mm", Locale.getDefault())
            sdf.format(Date(timestamp))
        }
    }
}

/**
 * 格式化通话时长
 */
private fun formatDuration(seconds: Long): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    val secs = seconds % 60

    return when {
        hours > 0 -> String.format("%d:%02d:%02d", hours, minutes, secs)
        minutes > 0 -> String.format("%d:%02d", minutes, secs)
        else -> String.format("0:%02d", secs)
    }
}
