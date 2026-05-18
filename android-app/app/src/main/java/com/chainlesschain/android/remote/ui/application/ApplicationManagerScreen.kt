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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
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
    val tabs = listOf(
        stringResource(R.string.rs_app_tab_running),
        stringResource(R.string.rs_app_tab_installed),
        stringResource(R.string.rs_app_tab_recent)
    )

    val isConnected = connectionState == ConnectionState.CONNECTED

    // 关闭确认对话框
    if (uiState.showCloseConfirmDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissCloseConfirmDialog() },
            title = { Text(stringResource(R.string.rs_app_close_title)) },
            text = { Text(stringResource(R.string.rs_app_close_message_fmt, uiState.pendingCloseName ?: "")) },
            confirmButton = {
                Row {
                    TextButton(onClick = { viewModel.confirmClose(force = false) }) {
                        Text(stringResource(R.string.common_close))
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    TextButton(
                        onClick = { viewModel.confirmClose(force = true) },
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Text(stringResource(R.string.rs_app_force_close))
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissCloseConfirmDialog() }) {
                    Text(stringResource(R.string.common_cancel))
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
                    app.publisher?.let { Text(stringResource(R.string.rs_app_publisher_fmt, it)) }
                    app.version?.let { Text(stringResource(R.string.rs_app_version_fmt, it)) }
                    app.installDate?.let { Text(stringResource(R.string.rs_app_installed_fmt, it)) }
                    app.installPath?.let { Text(stringResource(R.string.rs_app_path_fmt, it), maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    app.status?.let { Text(stringResource(R.string.rs_app_status_fmt, it)) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.clearSelectedApp()
                    viewModel.launchApp(app.name)
                }) {
                    Text(stringResource(R.string.rs_app_launch))
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.clearSelectedApp() }) {
                    Text(stringResource(R.string.common_close))
                }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.rs_app_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.common_refresh))
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
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.rs_app_dismiss))
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
                stringResource(R.string.rs_app_running_count_fmt, apps.size),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
            )
        }

        if (apps.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.rs_app_no_running),
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
                    app.pid?.let { Text(stringResource(R.string.rs_proc_pid_fmt, it), style = MaterialTheme.typography.bodySmall) }
                    app.cpu?.let { Text(stringResource(R.string.rs_proc_cpu_fmt, formatPercent(it)), style = MaterialTheme.typography.bodySmall) }
                    app.memory?.let { Text(stringResource(R.string.rs_proc_mem_fmt, formatBytes(it)), style = MaterialTheme.typography.bodySmall) }
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
                Icon(Icons.Default.OpenInNew, contentDescription = stringResource(R.string.rs_app_focus))
            }
            IconButton(
                onClick = onClose,
                enabled = enabled,
                colors = IconButtonDefaults.iconButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(Icons.Default.Close, contentDescription = stringResource(R.string.common_close))
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
            placeholder = { Text(stringResource(R.string.rs_app_search_placeholder)) },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            trailingIcon = {
                if (searchQuery.isNotEmpty()) {
                    IconButton(onClick = {
                        onSearchChange("")
                        onSearch("")
                    }) {
                        Icon(Icons.Default.Clear, contentDescription = stringResource(R.string.common_clear))
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
                    stringResource(R.string.rs_app_count_fmt, apps.size),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
            }

            if (apps.isEmpty()) {
                item {
                    Text(
                        stringResource(R.string.rs_app_no_results),
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
                    app.version?.let { Text(stringResource(R.string.rs_app_version_v_fmt, it), style = MaterialTheme.typography.bodySmall) }
                    app.publisher?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
            IconButton(onClick = onLaunch, enabled = enabled) {
                Icon(Icons.Default.PlayArrow, contentDescription = stringResource(R.string.rs_app_launch))
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
                stringResource(R.string.rs_app_recent_apps),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
            )
        }

        if (apps.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.rs_app_no_recent),
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
                            contentDescription = stringResource(R.string.rs_app_launch),
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
