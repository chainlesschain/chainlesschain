package com.chainlesschain.android.remote.ui.power

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.p2p.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PowerControlScreen(
    viewModel: PowerControlViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val scheduleInfo by viewModel.scheduleInfo.collectAsState()

    var showScheduleDialog by remember { mutableStateOf(false) }
    var scheduleMinutes by remember { mutableStateOf("30") }

    // 确认对话框
    if (uiState.showConfirmDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissConfirmDialog() },
            title = { Text("确认操作") },
            text = { Text("确定要执行 ${uiState.pendingAction} 操作吗？") },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmAction() }) {
                    Text("确认")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissConfirmDialog() }) {
                    Text("取消")
                }
            }
        )
    }

    // 定时关机对话框
    if (showScheduleDialog) {
        AlertDialog(
            onDismissRequest = { showScheduleDialog = false },
            title = { Text("设置定时关机") },
            text = {
                Column {
                    Text("请输入延迟时间（分钟）：")
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = scheduleMinutes,
                        onValueChange = { scheduleMinutes = it.filter { c -> c.isDigit() } },
                        label = { Text("分钟") },
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val minutes = scheduleMinutes.toIntOrNull() ?: 30
                        viewModel.scheduleShutdown(minutes)
                        showScheduleDialog = false
                    }
                ) {
                    Text("确定")
                }
            },
            dismissButton = {
                TextButton(onClick = { showScheduleDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Power Control") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 连接状态
            ConnectionStatusCard(connectionState)

            // 错误提示
            uiState.error?.let { error ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(error, color = MaterialTheme.colorScheme.onErrorContainer)
                        IconButton(onClick = { viewModel.clearError() }) {
                            Icon(Icons.Default.Close, contentDescription = "Dismiss")
                        }
                    }
                }
            }

            // 最后操作
            uiState.lastAction?.let { action ->
                Text(
                    text = "Last action: $action",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            // 电源操作
            Text(
                text = "Power Actions",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.PowerSettingsNew,
                    label = "Shutdown",
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.requestConfirmation("shutdown") }
                )
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.Refresh,
                    label = "Restart",
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.requestConfirmation("restart") }
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.Bedtime,
                    label = "Sleep",
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.requestConfirmation("sleep") }
                )
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.DownloadDone,
                    label = "Hibernate",
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.requestConfirmation("hibernate") }
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.Lock,
                    label = "Lock",
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.lock() }
                )
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.Logout,
                    label = "Logout",
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.requestConfirmation("logout") }
                )
            }

            Divider()

            // 定时任务
            Text(
                text = "Scheduled Tasks",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            scheduleInfo?.let { info ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp)
                    ) {
                        Text("Action: ${info.action}")
                        Text("Scheduled Time: ${info.scheduledTime ?: "N/A"}")
                        Text("Remaining: ${info.remainingMinutes ?: 0} min")
                        Spacer(modifier = Modifier.height(8.dp))
                        Button(
                            onClick = { viewModel.cancelSchedule() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error
                            )
                        ) {
                            Text("Cancel Schedule")
                        }
                    }
                }
            } ?: run {
                Text(
                    text = "No scheduled tasks",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Button(
                onClick = { showScheduleDialog = true },
                enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Schedule, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Schedule Shutdown")
            }

            // 加载指示器
            if (uiState.isExecuting) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
private fun ConnectionStatusCard(connectionState: ConnectionState) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = when (connectionState) {
                ConnectionState.CONNECTED -> MaterialTheme.colorScheme.primaryContainer
                ConnectionState.CONNECTING -> MaterialTheme.colorScheme.tertiaryContainer
                else -> MaterialTheme.colorScheme.surfaceVariant
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = when (connectionState) {
                    ConnectionState.CONNECTED -> Icons.Default.CheckCircle
                    ConnectionState.CONNECTING -> Icons.Default.Sync
                    else -> Icons.Default.Error
                },
                contentDescription = null
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("Status: $connectionState")
        }
    }
}

@Composable
private fun PowerButton(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            IconButton(
                onClick = onClick,
                enabled = enabled
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = label,
                    modifier = Modifier.size(32.dp)
                )
            }
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium
            )
        }
    }
}
