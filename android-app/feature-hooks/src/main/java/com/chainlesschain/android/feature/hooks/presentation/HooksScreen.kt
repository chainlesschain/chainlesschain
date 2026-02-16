package com.chainlesschain.android.feature.hooks.presentation

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
import com.chainlesschain.android.feature.hooks.domain.model.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HooksScreen(
    viewModel: HooksViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val selectedHook by viewModel.selectedHook.collectAsState()

    var showCreateDialog by remember { mutableStateOf(false) }
    var selectedTab by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Hooks") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showCreateDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = "Add Hook")
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
            // Tabs
            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = { Text("Hooks") }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = { Text("Logs") }
                )
            }

            when {
                uiState.isLoading && uiState.hooks.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                selectedTab == 0 -> {
                    Row(modifier = Modifier.fillMaxSize()) {
                        // Hook List
                        HookListPanel(
                            hooks = uiState.hooks,
                            selectedHookId = selectedHook?.id,
                            onHookClick = { viewModel.selectHook(it) },
                            onToggle = { hook, enabled -> viewModel.toggleHook(hook.id, enabled) },
                            modifier = Modifier.weight(1f)
                        )

                        // Hook Detail
                        selectedHook?.let { hook ->
                            VerticalDivider()
                            HookDetailPanel(
                                hook = hook,
                                stats = uiState.hookStats,
                                logs = uiState.hookLogs,
                                onTest = { viewModel.testHook(hook.id) },
                                onDelete = { viewModel.deleteHook(hook.id) },
                                onClose = { viewModel.selectHook(null) },
                                modifier = Modifier.width(350.dp)
                            )
                        }
                    }
                }
                selectedTab == 1 -> {
                    LogsPanel(
                        logs = uiState.recentLogs,
                        onClearAll = { viewModel.clearAllLogs() },
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }

    if (showCreateDialog) {
        CreateHookDialog(
            onDismiss = { showCreateDialog = false },
            onCreate = { name, event, type, priority ->
                viewModel.createHook(
                    name = name,
                    event = event,
                    type = type,
                    handler = HookHandler.Function(name.lowercase().replace(" ", "_")),
                    priority = priority
                )
                showCreateDialog = false
            }
        )
    }

    uiState.message?.let {
        LaunchedEffect(it) { viewModel.clearMessage() }
    }
    uiState.error?.let {
        LaunchedEffect(it) { viewModel.clearError() }
    }
}

@Composable
private fun HookListPanel(
    hooks: List<HookConfig>,
    selectedHookId: String?,
    onHookClick: (HookConfig) -> Unit,
    onToggle: (HookConfig, Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier.fillMaxHeight(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (hooks.isEmpty()) {
            item {
                Box(
                    modifier = Modifier.fillParentMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.Webhook,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.outline
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("No hooks configured", color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
        } else {
            items(hooks) { hook ->
                HookCard(
                    hook = hook,
                    isSelected = hook.id == selectedHookId,
                    onClick = { onHookClick(hook) },
                    onToggle = { onToggle(hook, it) }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HookCard(
    hook: HookConfig,
    isSelected: Boolean,
    onClick: () -> Unit,
    onToggle: (Boolean) -> Unit
) {
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.surface
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
                Text(hook.name, style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(4.dp))
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    AssistChip(
                        onClick = {},
                        label = { Text(hook.event.name) }
                    )
                    AssistChip(
                        onClick = {},
                        label = { Text(hook.type.name) },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = when (hook.type) {
                                HookType.SYNC -> Color(0xFF2196F3).copy(alpha = 0.1f)
                                HookType.ASYNC -> Color(0xFF4CAF50).copy(alpha = 0.1f)
                                HookType.COMMAND -> Color(0xFFFF9800).copy(alpha = 0.1f)
                                HookType.SCRIPT -> Color(0xFF9C27B0).copy(alpha = 0.1f)
                            }
                        )
                    )
                    AssistChip(
                        onClick = {},
                        label = { Text(hook.priority.name) }
                    )
                }
            }
            Switch(
                checked = hook.isEnabled,
                onCheckedChange = onToggle
            )
        }
    }
}

@Composable
private fun HookDetailPanel(
    hook: HookConfig,
    stats: HookStats?,
    logs: List<HookLog>,
    onTest: () -> Unit,
    onDelete: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .padding(16.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(hook.name, style = MaterialTheme.typography.titleLarge)
            Row {
                IconButton(onClick = onTest) {
                    Icon(Icons.Default.PlayArrow, contentDescription = "Test")
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete")
                }
                IconButton(onClick = onClose) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }
        }

        // Info
        hook.description?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(vertical = 8.dp)
            )
        }

        // Handler info
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text("Handler", style = MaterialTheme.typography.titleSmall)
                Spacer(modifier = Modifier.height(4.dp))
                val handlerInfo = when (val h = hook.handler) {
                    is HookHandler.Function -> "Function: ${h.name}"
                    is HookHandler.Command -> "Command: ${h.command}"
                    is HookHandler.Script -> "Script: ${h.path} (${h.interpreter})"
                    is HookHandler.Webhook -> "Webhook: ${h.url}"
                }
                Text(handlerInfo, style = MaterialTheme.typography.bodySmall)
            }
        }

        // Statistics
        if (stats != null && stats.totalExecutions > 0) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text("Statistics", style = MaterialTheme.typography.titleSmall)
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        StatItem("Total", stats.totalExecutions.toString())
                        StatItem("Success", stats.successCount.toString())
                        StatItem("Failed", stats.failureCount.toString())
                    }
                    Text(
                        "Avg Time: ${String.format("%.1f", stats.avgExecutionTimeMs)}ms",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        }

        // Recent logs
        if (logs.isNotEmpty()) {
            Text(
                "Recent Executions",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 16.dp, bottom = 8.dp)
            )
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(logs.take(10)) { log ->
                    LogItem(log)
                }
            }
        }
    }
}

@Composable
private fun StatItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleMedium)
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun LogItem(log: HookLog) {
    val statusColor = if (log.response.success) Color(0xFF4CAF50) else Color(0xFFF44336)

    Card {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(log.event.name, style = MaterialTheme.typography.bodySmall)
                Text(
                    "${log.response.executionTimeMs}ms",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
            Text(
                if (log.response.success) "OK" else "FAIL",
                style = MaterialTheme.typography.labelSmall,
                color = statusColor
            )
        }
    }
}

@Composable
private fun LogsPanel(
    logs: List<HookLog>,
    onClearAll: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Recent Logs (${logs.size})", style = MaterialTheme.typography.titleMedium)
            if (logs.isNotEmpty()) {
                TextButton(onClick = onClearAll) {
                    Text("Clear All")
                }
            }
        }

        if (logs.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text("No logs yet", color = MaterialTheme.colorScheme.outline)
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(logs) { log ->
                    FullLogItem(log)
                }
            }
        }
    }
}

@Composable
private fun FullLogItem(log: HookLog) {
    val statusColor = if (log.response.success) Color(0xFF4CAF50) else Color(0xFFF44336)

    Card {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(log.hookName, style = MaterialTheme.typography.titleSmall)
                Text(
                    if (log.response.success) "SUCCESS" else "FAILED",
                    style = MaterialTheme.typography.labelSmall,
                    color = statusColor
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                AssistChip(onClick = {}, label = { Text(log.event.name) })
                Text(
                    "${log.response.executionTimeMs}ms",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.align(Alignment.CenterVertically)
                )
            }
            log.response.result?.let {
                Text(
                    it.take(100),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
            log.response.error?.let {
                Text(
                    "Error: $it",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFFF44336),
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateHookDialog(
    onDismiss: () -> Unit,
    onCreate: (String, HookEvent, HookType, HookPriority) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var selectedEvent by remember { mutableStateOf(HookEvent.SESSION_START) }
    var selectedType by remember { mutableStateOf(HookType.SYNC) }
    var selectedPriority by remember { mutableStateOf(HookPriority.NORMAL) }

    var eventExpanded by remember { mutableStateOf(false) }
    var typeExpanded by remember { mutableStateOf(false) }
    var priorityExpanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create Hook") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))

                // Event dropdown
                ExposedDropdownMenuBox(
                    expanded = eventExpanded,
                    onExpandedChange = { eventExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedEvent.name,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Event") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(eventExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = eventExpanded,
                        onDismissRequest = { eventExpanded = false }
                    ) {
                        HookEvent.entries.take(10).forEach { event ->
                            DropdownMenuItem(
                                text = { Text(event.name) },
                                onClick = {
                                    selectedEvent = event
                                    eventExpanded = false
                                }
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))

                // Type dropdown
                ExposedDropdownMenuBox(
                    expanded = typeExpanded,
                    onExpandedChange = { typeExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedType.name,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Type") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(typeExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = typeExpanded,
                        onDismissRequest = { typeExpanded = false }
                    ) {
                        HookType.entries.forEach { type ->
                            DropdownMenuItem(
                                text = { Text(type.name) },
                                onClick = {
                                    selectedType = type
                                    typeExpanded = false
                                }
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))

                // Priority dropdown
                ExposedDropdownMenuBox(
                    expanded = priorityExpanded,
                    onExpandedChange = { priorityExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedPriority.name,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Priority") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(priorityExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = priorityExpanded,
                        onDismissRequest = { priorityExpanded = false }
                    ) {
                        HookPriority.entries.forEach { priority ->
                            DropdownMenuItem(
                                text = { Text(priority.name) },
                                onClick = {
                                    selectedPriority = priority
                                    priorityExpanded = false
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name, selectedEvent, selectedType, selectedPriority) },
                enabled = name.isNotBlank()
            ) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
