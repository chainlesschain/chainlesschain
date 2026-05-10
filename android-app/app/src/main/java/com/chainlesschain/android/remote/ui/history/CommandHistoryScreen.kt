package com.chainlesschain.android.remote.ui.history

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import com.chainlesschain.android.R
import com.chainlesschain.android.remote.data.CommandHistoryEntity
import com.chainlesschain.android.remote.data.CommandStatistics
import com.chainlesschain.android.remote.data.CommandStatus
import com.chainlesschain.android.remote.p2p.ConnectionState
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommandHistoryScreen(
    viewModel: CommandHistoryViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val statistics by viewModel.statistics.collectAsState(initial = CommandStatistics(0, 0, 0, 0.0))
    val pagedCommands = viewModel.pagedCommands.collectAsLazyPagingItems()

    var searchQuery by remember { mutableStateOf("") }
    var showClearDialog by remember { mutableStateOf(false) }
    var showFilterMenu by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.replaySuccess) {
        if (uiState.replaySuccess) {
            delay(1500)
            viewModel.clearReplaySuccess()
        }
    }

    LaunchedEffect(searchQuery) {
        delay(300)
        if (searchQuery.isBlank()) viewModel.clearSearch() else viewModel.search(searchQuery)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.rs_history_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { showFilterMenu = true }) {
                            Icon(Icons.Default.FilterList, contentDescription = stringResource(R.string.common_filter))
                        }
                        DropdownMenu(
                            expanded = showFilterMenu,
                            onDismissRequest = { showFilterMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.rs_history_filter_all)) },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.All)
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.List, null) }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.rs_history_filter_ai)) },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.ByNamespace("ai"))
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.Psychology, null) }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.rs_history_filter_system)) },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.ByNamespace("system"))
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.Computer, null) }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.rs_history_filter_success)) },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.ByStatus(CommandStatus.SUCCESS))
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.CheckCircle, null) }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.rs_history_filter_failed)) },
                                onClick = {
                                    viewModel.setFilter(HistoryFilter.ByStatus(CommandStatus.FAILURE))
                                    showFilterMenu = false
                                },
                                leadingIcon = { Icon(Icons.Default.Error, null) }
                            )
                        }
                    }

                    IconButton(onClick = { pagedCommands.refresh() }) {
                        Icon(Icons.Default.History, contentDescription = stringResource(R.string.common_refresh))
                    }

                    IconButton(onClick = { showClearDialog = true }, enabled = uiState.totalCount > 0) {
                        Icon(Icons.Default.DeleteSweep, contentDescription = stringResource(R.string.common_clear))
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            SearchBar(
                query = searchQuery,
                onQueryChange = { searchQuery = it },
                onSearch = { viewModel.search(searchQuery) },
                onClear = {
                    searchQuery = ""
                    viewModel.clearSearch()
                },
                modifier = Modifier.padding(16.dp)
            )

            if (uiState.currentFilter !is HistoryFilter.All || uiState.searchQuery.isNotEmpty()) {
                CurrentFilterChip(
                    filter = uiState.currentFilter,
                    searchQuery = uiState.searchQuery,
                    onClearFilter = { viewModel.setFilter(HistoryFilter.All) },
                    onClearSearch = {
                        searchQuery = ""
                        viewModel.clearSearch()
                    },
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }

            if (statistics.total > 0) {
                StatisticsCard(statistics = statistics, modifier = Modifier.padding(16.dp))
            }

            when {
                pagedCommands.loadState.refresh is LoadState.Loading -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }

                pagedCommands.itemCount == 0 -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(Icons.Default.History, null, modifier = Modifier.size(64.dp))
                            Text(if (uiState.searchQuery.isNotEmpty()) stringResource(R.string.rs_history_no_match) else stringResource(R.string.rs_history_empty))
                        }
                    }
                }

                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(pagedCommands.itemCount) { index ->
                            val command = pagedCommands[index]
                            command?.let {
                                CommandHistoryItem(
                                    command = it,
                                    onClick = { viewModel.viewCommandDetail(it.id) },
                                    onReplay = {
                                        if (connectionState == ConnectionState.CONNECTED) viewModel.replayCommand(it)
                                    },
                                    onDelete = { viewModel.deleteCommand(it) },
                                    canReplay = connectionState == ConnectionState.CONNECTED
                                )
                            }
                        }

                        if (pagedCommands.loadState.append is LoadState.Loading) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                }
                            }
                        }
                    }
                }
            }

            uiState.error?.let { error ->
                Snackbar(modifier = Modifier.padding(16.dp), action = {
                    TextButton(onClick = { viewModel.clearError() }) { Text(stringResource(R.string.common_close)) }
                }) {
                    Text(error)
                }
            }

            if (uiState.replaySuccess) {
                Snackbar(modifier = Modifier.padding(16.dp), containerColor = MaterialTheme.colorScheme.tertiaryContainer) {
                    Text(stringResource(R.string.rs_history_replayed))
                }
            }
        }
    }

    uiState.selectedCommand?.let { command ->
        CommandDetailDialog(
            command = command,
            onDismiss = { viewModel.closeCommandDetail() },
            onReplay = {
                viewModel.replayCommand(command)
                viewModel.closeCommandDetail()
            },
            canReplay = connectionState == ConnectionState.CONNECTED
        )
    }

    if (showClearDialog) {
        ClearConfirmDialog(
            onConfirm = {
                viewModel.clearAllCommands()
                showClearDialog = false
            },
            onDismiss = { showClearDialog = false }
        )
    }
}

@Composable
fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text(stringResource(R.string.rs_history_search_placeholder)) },
        leadingIcon = { Icon(Icons.Default.Search, null) },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = onClear) { Icon(Icons.Default.Clear, stringResource(R.string.common_clear)) }
            }
        },
        singleLine = true,
        shape = RoundedCornerShape(28.dp)
    )
}

@Composable
fun CurrentFilterChip(
    filter: HistoryFilter,
    searchQuery: String,
    onClearFilter: () -> Unit,
    onClearSearch: () -> Unit,
    modifier: Modifier = Modifier
) {
    LazyRow(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (searchQuery.isNotEmpty()) {
            item {
                FilterChip(
                    selected = true,
                    onClick = onClearSearch,
                    label = { Text(stringResource(R.string.rs_history_search_chip_fmt, searchQuery)) },
                    trailingIcon = { Icon(Icons.Default.Close, null, Modifier.size(16.dp)) }
                )
            }
        }

        if (filter !is HistoryFilter.All) {
            item {
                FilterChip(
                    selected = true,
                    onClick = onClearFilter,
                    label = {
                        Text(
                            when (filter) {
                                is HistoryFilter.ByNamespace -> stringResource(R.string.rs_history_namespace_fmt, filter.namespace)
                                is HistoryFilter.ByStatus -> stringResource(R.string.rs_history_status_fmt, filter.status.name)
                                else -> stringResource(R.string.rs_history_filter_all)
                            }
                        )
                    },
                    trailingIcon = { Icon(Icons.Default.Close, null, Modifier.size(16.dp)) }
                )
            }
        }
    }
}

@Composable
fun StatisticsCard(statistics: CommandStatistics, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatItem(stringResource(R.string.rs_history_stat_total), statistics.total.toString(), Icons.Default.List)
            StatItem(stringResource(R.string.rs_history_stat_success), statistics.success.toString(), Icons.Default.CheckCircle, Color(0xFF4CAF50))
            StatItem(stringResource(R.string.rs_history_stat_failed), statistics.failure.toString(), Icons.Default.Error, Color(0xFFF44336))
            StatItem(stringResource(R.string.rs_history_stat_avg), "${statistics.avgDuration.toInt()}ms", Icons.Default.Timer)
        }
    }
}

@Composable
fun StatItem(
    label: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    color: Color = MaterialTheme.colorScheme.onPrimaryContainer
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = color)
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
        )
    }
}

@Composable
fun CommandHistoryItem(
    command: CommandHistoryEntity,
    onClick: () -> Unit,
    onReplay: () -> Unit,
    onDelete: () -> Unit,
    canReplay: Boolean
) {
    val dateFormat = remember { SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault()) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(
                        imageVector = when (command.namespace) {
                            "ai" -> Icons.Default.Psychology
                            "system" -> Icons.Default.Computer
                            else -> Icons.Default.List
                        },
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )

                    Text(
                        text = "${command.namespace}.${command.action}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                }

                CommandStatusBadge(status = command.status)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(dateFormat.format(Date(command.timestamp)), style = MaterialTheme.typography.bodySmall)
                Text("${command.duration}ms", style = MaterialTheme.typography.bodySmall)
            }

            command.error?.let { err ->
                Text(err, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onReplay, enabled = canReplay, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Replay, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.rs_history_action_replay))
                }
                OutlinedButton(
                    onClick = onDelete,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) {
                    Icon(Icons.Default.Delete, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.common_delete))
                }
            }
        }
    }
}

@Composable
fun CommandStatusBadge(status: CommandStatus) {
    val (text, color) = when (status) {
        CommandStatus.SUCCESS -> stringResource(R.string.rs_history_status_success) to Color(0xFF4CAF50)
        CommandStatus.FAILURE -> stringResource(R.string.rs_history_status_failure) to Color(0xFFF44336)
        CommandStatus.PENDING -> stringResource(R.string.rs_history_status_pending) to Color(0xFFFF9800)
        CommandStatus.CANCELLED -> stringResource(R.string.rs_history_status_cancelled) to Color(0xFF9E9E9E)
    }

    Surface(shape = CircleShape, color = color.copy(alpha = 0.15f)) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(color))
            Text(text, style = MaterialTheme.typography.labelSmall, color = color, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun CommandDetailDialog(
    command: CommandHistoryEntity,
    onDismiss: () -> Unit,
    onReplay: () -> Unit,
    canReplay: Boolean
) {
    val dateFormat = remember { SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.rs_history_detail_title)) },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item { DetailItem(stringResource(R.string.rs_history_detail_command), "${command.namespace}.${command.action}") }
                item { DetailItem(stringResource(R.string.rs_history_detail_status), command.status.name) }
                item { DetailItem(stringResource(R.string.rs_history_detail_time), dateFormat.format(Date(command.timestamp))) }
                item { DetailItem(stringResource(R.string.rs_history_detail_duration), "${command.duration}ms") }
                item { DetailItem(stringResource(R.string.rs_history_detail_device), command.deviceDid) }
            }
        },
        confirmButton = {
            if (canReplay) {
                TextButton(onClick = onReplay) {
                    Icon(Icons.Default.Replay, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.rs_history_action_replay))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_close)) }
        }
    )
}

@Composable
fun DetailItem(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun ClearConfirmDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.rs_history_clear_title)) },
        text = { Text(stringResource(R.string.rs_history_clear_message)) },
        confirmButton = {
            TextButton(onClick = onConfirm, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                Text(stringResource(R.string.common_confirm))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) }
        }
    )
}
