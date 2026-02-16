package com.chainlesschain.android.remote.ui.process

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
import com.chainlesschain.android.remote.commands.ProcessInfo
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProcessManagerScreen(
    viewModel: ProcessManagerViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val filteredProcesses by viewModel.filteredProcesses.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val resourceUsage by viewModel.resourceUsage.collectAsState()
    val selectedProcess by viewModel.selectedProcess.collectAsState()

    // 终止确认对话框
    if (uiState.showKillConfirmDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissKillConfirmDialog() },
            title = { Text(stringResource(R.string.process_kill_title)) },
            text = { Text(stringResource(R.string.process_kill_message, uiState.pendingKillName ?: "", uiState.pendingKillPid ?: 0)) },
            confirmButton = {
                Row {
                    TextButton(onClick = { viewModel.confirmKill(force = false) }) {
                        Text(stringResource(R.string.process_kill))
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    TextButton(
                        onClick = { viewModel.confirmKill(force = true) },
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Text(stringResource(R.string.process_force_kill))
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissKillConfirmDialog() }) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        )
    }

    // 进程详情对话框
    selectedProcess?.let { process ->
        AlertDialog(
            onDismissRequest = { viewModel.clearSelectedProcess() },
            title = { Text(process.name) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("PID: ${process.pid}")
                    Text("CPU: ${formatPercent(process.cpu)}")
                    Text("Memory: ${formatBytes(process.memory)}")
                    process.user?.let { Text("User: $it") }
                    process.status?.let { Text("Status: $it") }
                    process.command?.let { Text("Command: $it", maxLines = 3, overflow = TextOverflow.Ellipsis) }
                    process.startTime?.let { Text("Start Time: $it") }
                    process.threads?.let { Text("Threads: $it") }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.clearSelectedProcess()
                        viewModel.requestKillConfirmation(process.pid, process.name)
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text(stringResource(R.string.process_kill_button))
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.clearSelectedProcess() }) {
                    Text(stringResource(R.string.common_close))
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Process Manager") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.loadProcesses() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(
                        onClick = {
                            if (uiState.isAutoRefreshEnabled) viewModel.stopAutoRefresh()
                            else viewModel.startAutoRefresh()
                        }
                    ) {
                        Icon(
                            if (uiState.isAutoRefreshEnabled) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (uiState.isAutoRefreshEnabled) "Stop Auto" else "Start Auto"
                        )
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
        ) {
            // 搜索栏
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { viewModel.updateSearchQuery(it) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Search processes...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { viewModel.updateSearchQuery("") }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear")
                        }
                    }
                },
                singleLine = true
            )

            // 资源使用概览
            resourceUsage?.let { usage ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        ResourceIndicator("CPU", formatPercent(usage.cpuUsage))
                        ResourceIndicator("Memory", formatPercent(usage.memoryUsage))
                        ResourceIndicator("Processes", "${usage.processCount}")
                    }
                }
            }

            // 错误提示
            uiState.error?.let { error ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            error,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = { viewModel.clearError() }) {
                            Icon(Icons.Default.Close, contentDescription = "Dismiss")
                        }
                    }
                }
            }

            // 统计信息
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "${filteredProcesses.size} / ${uiState.totalProcesses} processes",
                    style = MaterialTheme.typography.bodySmall
                )
                if (uiState.isAutoRefreshEnabled) {
                    Text(
                        text = "Auto-refresh ON",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }

            // 加载指示器
            if (uiState.isLoading || uiState.isExecuting) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            // 进程列表
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(filteredProcesses, key = { it.pid }) { process ->
                    ProcessItem(
                        process = process,
                        onClick = { viewModel.getProcessDetail(process.pid) },
                        onKillClick = { viewModel.requestKillConfirmation(process.pid, process.name) }
                    )
                }
            }
        }
    }
}

@Composable
private fun ResourceIndicator(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun ProcessItem(
    process: ProcessInfo,
    onClick: () -> Unit,
    onKillClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = process.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "PID: ${process.pid}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "CPU: ${formatPercent(process.cpu)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "Mem: ${formatBytes(process.memory)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            IconButton(
                onClick = onKillClick,
                colors = IconButtonDefaults.iconButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(Icons.Default.Close, contentDescription = "Kill")
            }
        }
    }
}

private fun formatPercent(value: Double?): String {
    return if (value != null) {
        String.format(Locale.US, "%.1f%%", value)
    } else {
        "N/A"
    }
}

private fun formatBytes(bytes: Long?): String {
    if (bytes == null) return "N/A"
    val kb = 1024.0
    val mb = kb * 1024
    val gb = mb * 1024
    return when {
        bytes >= gb -> String.format(Locale.US, "%.1f GB", bytes / gb)
        bytes >= mb -> String.format(Locale.US, "%.1f MB", bytes / mb)
        bytes >= kb -> String.format(Locale.US, "%.0f KB", bytes / kb)
        else -> "$bytes B"
    }
}
