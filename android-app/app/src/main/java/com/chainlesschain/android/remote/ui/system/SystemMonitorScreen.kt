package com.chainlesschain.android.remote.ui.system

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.SystemStatus
import com.chainlesschain.android.remote.commands.SystemInfo
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.roundToInt

/**
 * 系统监控界面
 *
 * 功能：
 * - 实时监控 PC 端系统状态
 * - CPU、内存使用率图表
 * - 系统信息详情
 * - 自动刷新
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SystemMonitorScreen(
    viewModel: SystemMonitorViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val currentStatus by viewModel.currentStatus.collectAsState()
    val systemInfo by viewModel.systemInfo.collectAsState()
    val cpuHistory by viewModel.cpuHistory.collectAsState()
    val memoryHistory by viewModel.memoryHistory.collectAsState()

    var showSettings by remember { mutableStateOf(false) }

    // 自动刷新
    LaunchedEffect(connectionState, uiState.isAutoRefreshEnabled) {
        if (connectionState == ConnectionState.CONNECTED && uiState.isAutoRefreshEnabled) {
            viewModel.startAutoRefresh(uiState.refreshInterval)
        } else {
            viewModel.stopAutoRefresh()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("系统监控") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 自动刷新开关
                    IconButton(
                        onClick = {
                            if (uiState.isAutoRefreshEnabled) {
                                viewModel.stopAutoRefresh()
                            } else {
                                viewModel.startAutoRefresh(uiState.refreshInterval)
                            }
                        },
                        enabled = connectionState == ConnectionState.CONNECTED
                    ) {
                        Icon(
                            imageVector = if (uiState.isAutoRefreshEnabled) {
                                Icons.Default.PauseCircle
                            } else {
                                Icons.Default.PlayCircle
                            },
                            contentDescription = if (uiState.isAutoRefreshEnabled) "停止自动刷新" else "开始自动刷新",
                            tint = if (uiState.isAutoRefreshEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                    }

                    // 设置
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
                    }

                    // 刷新按钮
                    IconButton(
                        onClick = { viewModel.refreshStatus() },
                        enabled = connectionState == ConnectionState.CONNECTED && !uiState.isRefreshing
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                connectionState != ConnectionState.CONNECTED -> {
                    // 未连接提示
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.CloudOff,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                            )
                            Text(
                                text = "未连接到 PC",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                currentStatus == null && !uiState.isRefreshing -> {
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
                                Icons.Default.Monitor,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)
                            )
                            Text(
                                text = "点击刷新按钮获取系统状态",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Button(onClick = { viewModel.refreshStatus() }) {
                                Icon(Icons.Default.Refresh, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("刷新")
                            }
                        }
                    }
                }
                else -> {
                    // 显示监控数据
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        // 状态指示器
                        item {
                            StatusIndicatorCard(
                                isRefreshing = uiState.isRefreshing,
                                isAutoRefreshEnabled = uiState.isAutoRefreshEnabled,
                                refreshInterval = uiState.refreshInterval,
                                lastRefreshTime = uiState.lastRefreshTime
                            )
                        }

                        // CPU 状态
                        currentStatus?.let { status ->
                            item {
                                CpuStatusCard(
                                    cpuStatus = status.cpu,
                                    cpuHistory = cpuHistory
                                )
                            }

                            // 内存状态
                            item {
                                MemoryStatusCard(
                                    memoryStatus = status.memory,
                                    memoryHistory = memoryHistory
                                )
                            }
                        }

                        // 系统信息
                        systemInfo?.let { info ->
                            item {
                                SystemInfoCard(systemInfo = info)
                            }
                        }
                    }
                }
            }

            // 错误提示
            uiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearError() }) {
                            Text("关闭")
                        }
                    }
                ) {
                    Text(error)
                }
            }
        }
    }

    // 设置对话框
    if (showSettings) {
        MonitorSettingsDialog(
            refreshInterval = uiState.refreshInterval,
            onRefreshIntervalChange = { viewModel.setRefreshInterval(it) },
            onDismiss = { showSettings = false }
        )
    }
}

/**
 * 状态指示器卡片
 */
@Composable
fun StatusIndicatorCard(
    isRefreshing: Boolean,
    isAutoRefreshEnabled: Boolean,
    refreshInterval: Int,
    lastRefreshTime: Long
) {
    val dateFormat = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isAutoRefreshEnabled) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // 状态图标
                if (isRefreshing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp
                    )
                } else if (isAutoRefreshEnabled) {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .background(Color(0xFF4CAF50), CircleShape)
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .background(Color(0xFF9E9E9E), CircleShape)
                    )
                }

                Column {
                    Text(
                        text = if (isAutoRefreshEnabled) "自动刷新中" else "已暂停",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold
                    )
                    if (lastRefreshTime > 0) {
                        Text(
                            text = "最后更新: ${dateFormat.format(Date(lastRefreshTime))}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            if (isAutoRefreshEnabled) {
                AssistChip(
                    onClick = { },
                    label = { Text("${refreshInterval}s") },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Timer,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                )
            }
        }
    }
}

/**
 * CPU 状态卡片
 */
@Composable
fun CpuStatusCard(
    cpuStatus: com.chainlesschain.android.remote.commands.CPUStatus,
    cpuHistory: List<Float>
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 标题
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    Icons.Default.Memory,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary
                )
                Text(
                    text = "CPU",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            // CPU 使用率
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = cpuStatus.usage,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.secondary
                )
                Text(
                    text = "${cpuStatus.cores} 核",
                    style = MaterialTheme.typography.bodyLarge
                )
            }

            // CPU 型号
            Text(
                text = cpuStatus.model,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
            )

            // 历史图表
            if (cpuHistory.isNotEmpty()) {
                UsageChart(
                    data = cpuHistory,
                    color = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(100.dp)
                )
            }
        }
    }
}

/**
 * 内存状态卡片
 */
@Composable
fun MemoryStatusCard(
    memoryStatus: com.chainlesschain.android.remote.commands.MemoryStatus,
    memoryHistory: List<Float>
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 标题
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    Icons.Default.Storage,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.tertiary
                )
                Text(
                    text = "内存",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            // 内存使用率
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = memoryStatus.usagePercent,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.tertiary
                )
            }

            // 内存详情
            Text(
                text = "已用 ${formatBytes(memoryStatus.used)} / 总计 ${formatBytes(memoryStatus.total)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f)
            )

            // 历史图表
            if (memoryHistory.isNotEmpty()) {
                UsageChart(
                    data = memoryHistory,
                    color = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(100.dp)
                )
            }
        }
    }
}

/**
 * 使用率图表
 */
@Composable
fun UsageChart(
    data: List<Float>,
    color: Color,
    modifier: Modifier = Modifier
) {
    if (data.isEmpty()) return

    Canvas(modifier = modifier) {
        val width = size.width
        val height = size.height
        val max = 100f
        val spacing = width / (data.size - 1).coerceAtLeast(1)

        // 绘制网格线
        val gridColor = color.copy(alpha = 0.1f)
        for (i in 0..4) {
            val y = height * i / 4
            drawLine(
                color = gridColor,
                start = Offset(0f, y),
                end = Offset(width, y),
                strokeWidth = 1.dp.toPx()
            )
        }

        // 绘制折线
        val path = Path()
        data.forEachIndexed { index, value ->
            val x = index * spacing
            val y = height - (value / max * height).coerceIn(0f, height)

            if (index == 0) {
                path.moveTo(x, y)
            } else {
                path.lineTo(x, y)
            }
        }

        drawPath(
            path = path,
            color = color,
            style = Stroke(
                width = 3.dp.toPx(),
                cap = StrokeCap.Round
            )
        )

        // 绘制数据点
        data.forEachIndexed { index, value ->
            val x = index * spacing
            val y = height - (value / max * height).coerceIn(0f, height)

            drawCircle(
                color = color,
                radius = 4.dp.toPx(),
                center = Offset(x, y)
            )
        }
    }
}

/**
 * 系统信息卡片
 */
@Composable
fun SystemInfoCard(systemInfo: SystemInfo) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 标题
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    Icons.Default.Info,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "系统信息",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            Divider()

            // 操作系统
            InfoRow("操作系统", "${systemInfo.os.type} ${systemInfo.os.release}")
            InfoRow("架构", systemInfo.os.arch)
            InfoRow("版本", systemInfo.os.version)
            InfoRow("主机名", systemInfo.hostname)

            Divider()

            // CPU 信息
            InfoRow("CPU 型号", systemInfo.cpu.model)
            InfoRow("核心数", "${systemInfo.cpu.cores} 核")
            InfoRow("频率", "${systemInfo.cpu.speed} MHz")

            Divider()

            // 内存信息
            InfoRow("总内存", formatBytes(systemInfo.memory.total))
            InfoRow("可用内存", formatBytes(systemInfo.memory.free))

            Divider()

            // 运行时间
            InfoRow("运行时间", formatUptime(systemInfo.uptime))
        }
    }
}

/**
 * 信息行
 */
@Composable
fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
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
 * 监控设置对话框
 */
@Composable
fun MonitorSettingsDialog(
    refreshInterval: Int,
    onRefreshIntervalChange: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("监控设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // 刷新间隔
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "刷新间隔",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "${refreshInterval}s",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }

                    Slider(
                        value = refreshInterval.toFloat(),
                        onValueChange = { onRefreshIntervalChange(it.roundToInt()) },
                        valueRange = 1f..30f,
                        steps = 28
                    )

                    Text(
                        text = "较短的间隔会增加网络和系统负载",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("确定")
            }
        }
    )
}

/**
 * 格式化字节大小
 */
fun formatBytes(bytes: Long): String {
    val kb = bytes / 1024.0
    val mb = kb / 1024.0
    val gb = mb / 1024.0

    return when {
        gb >= 1 -> String.format("%.2f GB", gb)
        mb >= 1 -> String.format("%.2f MB", mb)
        kb >= 1 -> String.format("%.2f KB", kb)
        else -> "$bytes B"
    }
}

/**
 * 格式化运行时间
 */
fun formatUptime(seconds: Long): String {
    val days = seconds / 86400
    val hours = (seconds % 86400) / 3600
    val minutes = (seconds % 3600) / 60

    return buildString {
        if (days > 0) append("${days}天 ")
        if (hours > 0) append("${hours}小时 ")
        if (minutes > 0) append("${minutes}分钟")
    }.ifEmpty { "不到1分钟" }
}
