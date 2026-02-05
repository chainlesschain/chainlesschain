package com.chainlesschain.android.remote.ui.system

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SystemMonitorScreen(
    viewModel: SystemMonitorViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val status by viewModel.currentStatus.collectAsState()
    val info by viewModel.systemInfo.collectAsState()
    val cpuHistory by viewModel.cpuHistory.collectAsState()
    val memoryHistory by viewModel.memoryHistory.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("System Monitor") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refreshStatus() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
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
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "Connection: $connectionState",
                color = if (connectionState == ConnectionState.CONNECTED) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { viewModel.refreshStatus() }) { Text("Refresh") }
                Button(
                    onClick = {
                        if (uiState.isAutoRefreshEnabled) viewModel.stopAutoRefresh()
                        else viewModel.startAutoRefresh(uiState.refreshInterval)
                    }
                ) {
                    Text(if (uiState.isAutoRefreshEnabled) "Stop Auto" else "Start Auto")
                }
                Button(
                    onClick = {
                        val next = when (uiState.refreshInterval) {
                            3 -> 5
                            5 -> 10
                            else -> 3
                        }
                        viewModel.setRefreshInterval(next)
                    }
                ) {
                    Text("${uiState.refreshInterval}s")
                }
            }

            status?.let { s ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MetricCard(
                        modifier = Modifier.weight(1f),
                        title = "CPU",
                        value = s.cpu.usage,
                        subtitle = "${s.cpu.cores} cores"
                    )
                    MetricCard(
                        modifier = Modifier.weight(1f),
                        title = "Memory",
                        value = s.memory.usagePercent,
                        subtitle = formatBytes(s.memory.used) + " / " + formatBytes(s.memory.total)
                    )
                }

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("Host: ${s.system.hostname}", fontWeight = FontWeight.Medium)
                        Text("Platform: ${s.system.platform} ${s.system.arch}")
                        Text("Uptime: ${formatDuration(s.system.uptime)}")
                    }
                }
            } ?: Text("No status data yet.")

            info?.let { systemInfo ->
                Text(
                    text = "OS: ${systemInfo.os.type} ${systemInfo.os.version}",
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Text(
                text = "CPU samples: ${cpuHistory.size}, Memory samples: ${memoryHistory.size}" +
                    " | Last refresh: ${formatTime(uiState.lastRefreshTime)}",
                style = MaterialTheme.typography.bodySmall
            )
            uiState.error?.let { error ->
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
private fun MetricCard(
    modifier: Modifier = Modifier,
    title: String,
    value: String,
    subtitle: String
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(title, style = MaterialTheme.typography.labelMedium)
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun formatTime(timestamp: Long): String {
    if (timestamp <= 0L) return "--"
    val sdf = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    return sdf.format(Date(timestamp))
}

private fun formatBytes(bytes: Long): String {
    val kb = 1024.0
    val mb = kb * 1024
    val gb = mb * 1024
    return when {
        bytes >= gb -> String.format(Locale.US, "%.2f GB", bytes / gb)
        bytes >= mb -> String.format(Locale.US, "%.1f MB", bytes / mb)
        bytes >= kb -> String.format(Locale.US, "%.1f KB", bytes / kb)
        else -> "$bytes B"
    }
}

private fun formatDuration(seconds: Long): String {
    val d = seconds / 86400
    val h = (seconds % 86400) / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    return buildString {
        if (d > 0) append("${d}d ")
        if (h > 0 || d > 0) append("${h}h ")
        if (m > 0 || h > 0 || d > 0) append("${m}m ")
        append("${s}s")
    }.trim()
}
