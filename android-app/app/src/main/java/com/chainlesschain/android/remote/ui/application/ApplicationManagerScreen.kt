package com.chainlesschain.android.remote.ui.application

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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.InstalledApp
import com.chainlesschain.android.remote.commands.RunningApp
import com.chainlesschain.android.remote.commands.RecentApp
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApplicationManagerScreen(
    viewModel: ApplicationManagerViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val filteredInstalledApps by viewModel.filteredInstalledApps.collectAsState()
    val runningApps by viewModel.runningApps.collectAsState()
    val recentApps by viewModel.recentApps.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val selectedApp by viewModel.selectedApp.collectAsState()

    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Running", "Installed", "Recent")

    val isConnected = connectionState == ConnectionState.CONNECTED

    // 关闭确认对话框
    if (uiState.showCloseConfirmDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissCloseConfirmDialog() },
            title = { Text("Close Application") },
            text = { Text("Close ${uiState.pendingCloseName}?") },
            confirmButton = {
                Row {
                    TextButton(onClick = { viewModel.confirmClose(force = false) }) {
                        Text("Close")
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    TextButton(
                        onClick = { viewModel.confirmClose(force = true) },
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Text("Force Close")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissCloseConfirmDialog() }) {
                    Text("Cancel")
                }
            }
        )
    }

    // 应用详情对话框
    selectedApp?.let { app ->
        AlertDialog(
            onDismissRequest = { viewModel.clearSelectedApp() },
            title = { Text(app.name) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    app.publisher?.let { Text("Publisher: $it") }
                    app.version?.let { Text("Version: $it") }
                    app.installDate?.let { Text("Installed: $it") }
                    app.installPath?.let { Text("Path: $it", maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    app.status?.let { Text("Status: $it") }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.clearSelectedApp()
                    viewModel.launchApp(app.name)
                }) {
                    Text("Launch")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.clearSelectedApp() }) {
                    Text("Close")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Applications") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
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
        ) {
            // 标签栏
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = {
                            selectedTab = index
                            when (index) {
                                0 -> viewModel.loadRunningApps()
                                1 -> viewModel.loadInstalledApps()
                                2 -> viewModel.loadRecentApps()
                            }
                        },
                        text = { Text(title) }
                    )
                }
            }

            // 错误提示
            uiState.error?.let { error ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
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
                    text = action,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }

            // 加载指示器
            if (uiState.isLoading || uiState.isExecuting) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            when (selectedTab) {
                0 -> RunningAppsTab(
                    apps = runningApps,
                    enabled = isConnected,
                    onFocus = { viewModel.focusApp(name = it.name, pid = it.pid) },
                    onClose = { viewModel.requestCloseConfirmation(it.name, it.pid) }
                )
                1 -> InstalledAppsTab(
                    apps = filteredInstalledApps,
                    searchQuery = searchQuery,
                    enabled = isConnected,
                    onSearchChange = { viewModel.updateSearchQuery(it) },
                    onSearch = { viewModel.searchApps(it) },
                    onAppClick = { viewModel.getAppInfo(it.name) },
                    onLaunch = { viewModel.launchApp(it.name) }
                )
                2 -> RecentAppsTab(
                    apps = recentApps,
                    enabled = isConnected,
                    onLaunch = { viewModel.launchApp(it.name) }
                )
            }
        }
    }
}

@Composable
private fun RunningAppsTab(
    apps: List<RunningApp>,
    enabled: Boolean,
    onFocus: (RunningApp) -> Unit,
    onClose: (RunningApp) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(
                "${apps.size} running applications",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
            )
        }

        if (apps.isEmpty()) {
            item {
                Text(
                    "No running applications",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            items(apps, key = { it.pid ?: it.name }) { app ->
                RunningAppItem(
                    app = app,
                    enabled = enabled,
                    onFocus = { onFocus(app) },
                    onClose = { onClose(app) }
                )
            }
        }
    }
}

@Composable
private fun RunningAppItem(
    app: RunningApp,
    enabled: Boolean,
    onFocus: () -> Unit,
    onClose: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Apps,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = app.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    app.pid?.let { Text("PID: $it", style = MaterialTheme.typography.bodySmall) }
                    app.cpu?.let { Text("CPU: ${formatPercent(it)}", style = MaterialTheme.typography.bodySmall) }
                    app.memory?.let { Text("Mem: ${formatBytes(it)}", style = MaterialTheme.typography.bodySmall) }
                }
                app.title?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            IconButton(onClick = onFocus, enabled = enabled) {
                Icon(Icons.Default.OpenInNew, contentDescription = "Focus")
            }
            IconButton(
                onClick = onClose,
                enabled = enabled,
                colors = IconButtonDefaults.iconButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(Icons.Default.Close, contentDescription = "Close")
            }
        }
    }
}

@Composable
private fun InstalledAppsTab(
    apps: List<InstalledApp>,
    searchQuery: String,
    enabled: Boolean,
    onSearchChange: (String) -> Unit,
    onSearch: (String) -> Unit,
    onAppClick: (InstalledApp) -> Unit,
    onLaunch: (InstalledApp) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        // 搜索栏
        OutlinedTextField(
            value = searchQuery,
            onValueChange = onSearchChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            placeholder = { Text("Search installed apps...") },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            trailingIcon = {
                if (searchQuery.isNotEmpty()) {
                    IconButton(onClick = {
                        onSearchChange("")
                        onSearch("")
                    }) {
                        Icon(Icons.Default.Clear, contentDescription = "Clear")
                    }
                }
            },
            singleLine = true
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                Text(
                    "${apps.size} applications",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
            }

            if (apps.isEmpty()) {
                item {
                    Text(
                        "No applications found. Click search to load.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                items(apps, key = { it.name }) { app ->
                    InstalledAppItem(
                        app = app,
                        enabled = enabled,
                        onClick = { onAppClick(app) },
                        onLaunch = { onLaunch(app) }
                    )
                }
            }
        }
    }
}

@Composable
private fun InstalledAppItem(
    app: InstalledApp,
    enabled: Boolean,
    onClick: () -> Unit,
    onLaunch: () -> Unit
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
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Apps,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = app.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    app.version?.let { Text("v$it", style = MaterialTheme.typography.bodySmall) }
                    app.publisher?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
            IconButton(onClick = onLaunch, enabled = enabled) {
                Icon(Icons.Default.PlayArrow, contentDescription = "Launch")
            }
        }
    }
}

@Composable
private fun RecentAppsTab(
    apps: List<RecentApp>,
    enabled: Boolean,
    onLaunch: (RecentApp) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(
                "Recent Applications",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
            )
        }

        if (apps.isEmpty()) {
            item {
                Text(
                    "No recent applications",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            items(apps, key = { it.name }) { app ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = enabled) { onLaunch(app) },
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.History,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = app.name,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium
                            )
                            app.path?.let {
                                Text(
                                    text = it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                        Icon(
                            Icons.Default.PlayArrow,
                            contentDescription = "Launch",
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                }
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
