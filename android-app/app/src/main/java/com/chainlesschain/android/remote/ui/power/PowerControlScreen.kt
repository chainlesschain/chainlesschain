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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
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
            title = { Text(stringResource(R.string.power_confirm_title)) },
            text = { Text(stringResource(R.string.power_confirm_message, uiState.pendingAction ?: "")) },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmAction() }) {
                    Text(stringResource(R.string.common_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissConfirmDialog() }) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        )
    }

    // 定时关机对话框
    if (showScheduleDialog) {
        AlertDialog(
            onDismissRequest = { showScheduleDialog = false },
            title = { Text(stringResource(R.string.power_timer_title)) },
            text = {
                Column {
                    Text(stringResource(R.string.power_timer_prompt))
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = scheduleMinutes,
                        onValueChange = { scheduleMinutes = it.filter { c -> c.isDigit() } },
                        label = { Text(stringResource(R.string.power_timer_label)) },
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
                    Text(stringResource(R.string.common_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { showScheduleDialog = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.rs_power_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
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
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.rs_power_dismiss))
                        }
                    }
                }
            }

            // 最后操作
            uiState.lastAction?.let { action ->
                Text(
                    text = stringResource(R.string.rs_power_last_action_fmt, action),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            // 电源操作
            Text(
                text = stringResource(R.string.rs_power_actions),
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
                    label = stringResource(R.string.rs_power_shutdown),
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.requestConfirmation("shutdown") }
                )
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.Refresh,
                    label = stringResource(R.string.rs_power_restart),
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
                    label = stringResource(R.string.rs_power_sleep),
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.requestConfirmation("sleep") }
                )
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.DownloadDone,
                    label = stringResource(R.string.rs_power_hibernate),
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
                    label = stringResource(R.string.rs_power_lock),
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.lock() }
                )
                PowerButton(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.Logout,
                    label = stringResource(R.string.rs_power_logout),
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isExecuting,
                    onClick = { viewModel.requestConfirmation("logout") }
                )
            }

            HorizontalDivider()

            // 定时任务
            Text(
                text = stringResource(R.string.rs_power_scheduled_tasks),
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
                        Text(stringResource(R.string.rs_power_action_fmt, info.action))
                        Text(stringResource(R.string.rs_power_scheduled_time_fmt, info.scheduledTime ?: "N/A"))
                        Text(stringResource(R.string.rs_power_remaining_fmt, info.remainingMinutes ?: 0))
                        Spacer(modifier = Modifier.height(8.dp))
                        Button(
                            onClick = { viewModel.cancelSchedule() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error
                            )
                        ) {
                            Text(stringResource(R.string.rs_power_cancel_schedule))
                        }
                    }
                }
            } ?: run {
                Text(
                    text = stringResource(R.string.rs_power_no_scheduled),
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
                Text(stringResource(R.string.rs_power_schedule_shutdown))
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
            Text(stringResource(R.string.rs_power_status_fmt, connectionState.toString()))
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
