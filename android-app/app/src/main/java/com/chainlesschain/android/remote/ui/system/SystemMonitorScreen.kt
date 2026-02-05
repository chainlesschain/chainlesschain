package com.chainlesschain.android.remote.ui.system

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
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
            }

            status?.let { s ->
                Text("CPU: ${s.cpu.usage} (${s.cpu.cores} cores)", fontWeight = FontWeight.Medium)
                Text("Memory: ${s.memory.usagePercent}")
                Text("Host: ${s.system.hostname}")
                Text("Platform: ${s.system.platform} ${s.system.arch}")
            } ?: Text("No status data yet.")

            info?.let { systemInfo ->
                Text(
                    text = "OS: ${systemInfo.os.type} ${systemInfo.os.version}",
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Text(
                text = "CPU samples: ${cpuHistory.size}, Memory samples: ${memoryHistory.size}",
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
