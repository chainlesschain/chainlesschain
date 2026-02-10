package com.chainlesschain.android.feature.performance.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.performance.domain.model.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PerformanceScreen(
    viewModel: PerformanceViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val isMonitoring by viewModel.isMonitoring.collectAsState()
    val currentMetrics by viewModel.currentMetrics.collectAsState()

    var selectedTab by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Performance") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.toggleMonitoring() }) {
                        Icon(
                            if (isMonitoring) Icons.Default.Stop else Icons.Default.PlayArrow,
                            contentDescription = if (isMonitoring) "Stop" else "Start"
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Monitoring status
            if (isMonitoring) {
                MonitoringBanner()
            }

            // Tabs
            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = { Text("Overview") }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = { Text("Caches") }
                )
                Tab(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    text = { Text("Alerts") }
                )
            }

            when {
                uiState.isLoading && uiState.snapshots.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                selectedTab == 0 -> {
                    OverviewPanel(
                        metrics = currentMetrics,
                        activeTraces = uiState.activeTraces,
                        modifier = Modifier.fillMaxSize()
                    )
                }
                selectedTab == 1 -> {
                    CachesPanel(
                        caches = uiState.caches,
                        onClearCache = { viewModel.clearCache(it) },
                        onClearAll = { viewModel.clearAllCaches() },
                        modifier = Modifier.fillMaxSize()
                    )
                }
                selectedTab == 2 -> {
                    AlertsPanel(
                        alerts = uiState.alerts,
                        onAcknowledge = { viewModel.acknowledgeAlert(it) },
                        onClearAll = { viewModel.clearAllAlerts() },
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }

    uiState.message?.let {
        LaunchedEffect(it) { viewModel.clearMessage() }
    }
    uiState.error?.let {
        LaunchedEffect(it) { viewModel.clearError() }
    }
}

@Composable
private fun MonitoringBanner() {
    Surface(
        color = Color(0xFF4CAF50).copy(alpha = 0.1f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(8.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.FiberManualRecord,
                contentDescription = null,
                tint = Color(0xFF4CAF50),
                modifier = Modifier.size(12.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("Monitoring Active", style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun OverviewPanel(
    metrics: PerformanceMetrics?,
    activeTraces: List<OperationTrace>,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Memory Card
        item {
            MetricCard(
                title = "Memory",
                icon = Icons.Default.Memory,
                metrics?.memory?.let {
                    listOf(
                        "Used" to formatBytes(it.usedBytes),
                        "Available" to formatBytes(it.availableBytes),
                        "Usage" to "${String.format("%.1f", it.usagePercent)}%"
                    )
                } ?: emptyList(),
                color = metrics?.memory?.let {
                    when {
                        it.usagePercent > 80 -> Color(0xFFF44336)
                        it.usagePercent > 60 -> Color(0xFFFF9800)
                        else -> Color(0xFF4CAF50)
                    }
                } ?: Color.Gray
            )
        }

        // CPU Card
        item {
            MetricCard(
                title = "CPU",
                icon = Icons.Default.Speed,
                metrics?.cpu?.let {
                    listOf(
                        "Usage" to "${String.format("%.1f", it.usagePercent)}%",
                        "Cores" to it.coreCount.toString()
                    )
                } ?: emptyList(),
                color = metrics?.cpu?.let {
                    when {
                        it.usagePercent > 80 -> Color(0xFFF44336)
                        it.usagePercent > 60 -> Color(0xFFFF9800)
                        else -> Color(0xFF4CAF50)
                    }
                } ?: Color.Gray
            )
        }

        // Network Card
        item {
            MetricCard(
                title = "Network",
                icon = Icons.Default.Wifi,
                metrics?.network?.let {
                    listOf(
                        "Requests" to it.requestCount.toString(),
                        "Sent" to formatBytes(it.bytesSent),
                        "Received" to formatBytes(it.bytesReceived),
                        "Avg Latency" to "${it.averageLatencyMs}ms"
                    )
                } ?: emptyList(),
                color = Color(0xFF2196F3)
            )
        }

        // AI Card
        item {
            MetricCard(
                title = "AI/LLM",
                icon = Icons.Default.Psychology,
                metrics?.ai?.let {
                    listOf(
                        "Requests" to it.requestCount.toString(),
                        "Tokens" to it.totalTokensUsed.toString(),
                        "Avg Latency" to "${it.averageLatencyMs}ms"
                    )
                } ?: emptyList(),
                color = Color(0xFF9C27B0)
            )
        }

        // Active Traces
        if (activeTraces.isNotEmpty()) {
            item {
                Text("Active Operations (${activeTraces.size})", style = MaterialTheme.typography.titleMedium)
            }
            items(activeTraces.take(5)) { trace ->
                TraceItem(trace)
            }
        }
    }
}

@Composable
private fun MetricCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    metrics: List<Pair<String, String>>,
    color: Color
) {
    Card {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(icon, contentDescription = null, tint = color)
                Text(title, style = MaterialTheme.typography.titleMedium)
            }
            Spacer(modifier = Modifier.height(12.dp))
            if (metrics.isEmpty()) {
                Text("No data", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    metrics.forEach { (label, value) ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(value, style = MaterialTheme.typography.titleLarge)
                            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TraceItem(trace: OperationTrace) {
    Card {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(trace.name, style = MaterialTheme.typography.bodyMedium)
                Text(
                    trace.category.name,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
        }
    }
}

@Composable
private fun CachesPanel(
    caches: List<CacheStatistics>,
    onClearCache: (String) -> Unit,
    onClearAll: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Caches (${caches.size})", style = MaterialTheme.typography.titleMedium)
            if (caches.isNotEmpty()) {
                TextButton(onClick = onClearAll) {
                    Text("Clear All")
                }
            }
        }

        if (caches.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text("No caches", color = MaterialTheme.colorScheme.outline)
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(caches) { cache ->
                    CacheItem(cache = cache, onClear = { onClearCache(cache.name) })
                }
            }
        }
    }
}

@Composable
private fun CacheItem(
    cache: CacheStatistics,
    onClear: () -> Unit
) {
    Card {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(cache.name, style = MaterialTheme.typography.titleSmall)
                IconButton(onClick = onClear, modifier = Modifier.size(24.dp)) {
                    Icon(Icons.Default.Delete, contentDescription = "Clear", modifier = Modifier.size(16.dp))
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { cache.fillRate },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    "${cache.size}/${cache.maxSize}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Text(
                    "Hit Rate: ${String.format("%.1f", cache.hitRate * 100)}%",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}

@Composable
private fun AlertsPanel(
    alerts: List<PerformanceAlert>,
    onAcknowledge: (String) -> Unit,
    onClearAll: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Alerts (${alerts.size})", style = MaterialTheme.typography.titleMedium)
            if (alerts.isNotEmpty()) {
                TextButton(onClick = onClearAll) {
                    Text("Clear All")
                }
            }
        }

        if (alerts.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = null,
                        tint = Color(0xFF4CAF50),
                        modifier = Modifier.size(48.dp)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("No alerts", color = MaterialTheme.colorScheme.outline)
                }
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(alerts) { alert ->
                    AlertItem(alert = alert, onAcknowledge = { onAcknowledge(alert.id) })
                }
            }
        }
    }
}

@Composable
private fun AlertItem(
    alert: PerformanceAlert,
    onAcknowledge: () -> Unit
) {
    val severityColor = when (alert.severity) {
        AlertSeverity.CRITICAL -> Color(0xFFF44336)
        AlertSeverity.ERROR -> Color(0xFFFF5722)
        AlertSeverity.WARNING -> Color(0xFFFF9800)
        AlertSeverity.INFO -> Color(0xFF2196F3)
    }

    Card(
        colors = CardDefaults.cardColors(
            containerColor = severityColor.copy(alpha = 0.1f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        when (alert.severity) {
                            AlertSeverity.CRITICAL -> Icons.Default.Error
                            AlertSeverity.ERROR -> Icons.Default.Warning
                            AlertSeverity.WARNING -> Icons.Default.Warning
                            AlertSeverity.INFO -> Icons.Default.Info
                        },
                        contentDescription = null,
                        tint = severityColor,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(alert.type.name.replace("_", " "), style = MaterialTheme.typography.titleSmall)
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(alert.message, style = MaterialTheme.typography.bodySmall)
            }
            if (!alert.acknowledged) {
                IconButton(onClick = onAcknowledge) {
                    Icon(Icons.Default.Check, contentDescription = "Acknowledge")
                }
            }
        }
    }
}

private fun formatBytes(bytes: Long): String {
    return when {
        bytes >= 1_000_000_000 -> String.format("%.1f GB", bytes / 1_000_000_000.0)
        bytes >= 1_000_000 -> String.format("%.1f MB", bytes / 1_000_000.0)
        bytes >= 1_000 -> String.format("%.1f KB", bytes / 1_000.0)
        else -> "$bytes B"
    }
}
