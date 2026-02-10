package com.chainlesschain.android.feature.mcp.presentation

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
import com.chainlesschain.android.feature.mcp.domain.model.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MCPScreen(
    viewModel: MCPViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val selectedServer by viewModel.selectedServer.collectAsState()

    var showAddServerDialog by remember { mutableStateOf(false) }
    var selectedTab by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("MCP Servers") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showAddServerDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = "Add Server")
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
                    text = { Text("Servers") }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = { Text("Recent Calls") }
                )
            }

            when {
                uiState.isLoading && uiState.servers.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                selectedTab == 0 -> {
                    Row(modifier = Modifier.fillMaxSize()) {
                        // Server List
                        ServerListPanel(
                            servers = uiState.servers,
                            connectedIds = uiState.connectedServerIds,
                            selectedServerId = selectedServer?.id,
                            onServerClick = { viewModel.selectServer(it) },
                            onConnect = { viewModel.connectServer(it.id) },
                            onDisconnect = { viewModel.disconnectServer(it.id) },
                            modifier = Modifier.weight(1f)
                        )

                        // Server Detail
                        if (selectedServer != null) {
                            VerticalDivider()
                            ServerDetailPanel(
                                server = selectedServer!!,
                                isConnected = selectedServer!!.id in uiState.connectedServerIds,
                                statistics = uiState.serverStatistics,
                                toolCalls = uiState.serverToolCalls,
                                onCallTool = { tool ->
                                    viewModel.callTool(selectedServer!!.id, tool.name)
                                },
                                onDelete = { viewModel.deleteServer(selectedServer!!.id) },
                                onClose = { viewModel.selectServer(null) },
                                modifier = Modifier.width(350.dp)
                            )
                        }
                    }
                }
                selectedTab == 1 -> {
                    LaunchedEffect(Unit) {
                        viewModel.loadRecentToolCalls()
                    }
                    RecentCallsPanel(
                        calls = uiState.recentToolCalls,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }

    if (showAddServerDialog) {
        AddServerDialog(
            onDismiss = { showAddServerDialog = false },
            onAdd = { name, url, transport ->
                viewModel.addServer(name, url, transport)
                showAddServerDialog = false
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
private fun ServerListPanel(
    servers: List<MCPServer>,
    connectedIds: Set<String>,
    selectedServerId: String?,
    onServerClick: (MCPServer) -> Unit,
    onConnect: (MCPServer) -> Unit,
    onDisconnect: (MCPServer) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier.fillMaxHeight(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (servers.isEmpty()) {
            item {
                Box(
                    modifier = Modifier.fillParentMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.CloudOff,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.outline
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("No servers configured", color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
        } else {
            items(servers) { server ->
                val isConnected = server.id in connectedIds
                val isSelected = server.id == selectedServerId

                ServerCard(
                    server = server,
                    isConnected = isConnected,
                    isSelected = isSelected,
                    onClick = { onServerClick(server) },
                    onConnect = { onConnect(server) },
                    onDisconnect = { onDisconnect(server) }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServerCard(
    server: MCPServer,
    isConnected: Boolean,
    isSelected: Boolean,
    onClick: () -> Unit,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(server.name, style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.width(8.dp))
                    StatusIndicator(status = server.status)
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    server.url,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Row(
                    modifier = Modifier.padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    AssistChip(
                        onClick = {},
                        label = { Text(server.transport.name) }
                    )
                    if (server.tools.isNotEmpty()) {
                        AssistChip(
                            onClick = {},
                            label = { Text("${server.tools.size} tools") }
                        )
                    }
                }
            }

            if (isConnected) {
                IconButton(onClick = onDisconnect) {
                    Icon(Icons.Default.LinkOff, contentDescription = "Disconnect")
                }
            } else {
                IconButton(onClick = onConnect) {
                    Icon(Icons.Default.Link, contentDescription = "Connect")
                }
            }
        }
    }
}

@Composable
private fun StatusIndicator(status: ServerStatus) {
    val color = when (status) {
        ServerStatus.CONNECTED -> Color(0xFF4CAF50)
        ServerStatus.CONNECTING -> Color(0xFFFF9800)
        ServerStatus.DISCONNECTED -> Color.Gray
        ServerStatus.ERROR -> Color(0xFFF44336)
    }

    Surface(
        shape = MaterialTheme.shapes.small,
        color = color.copy(alpha = 0.2f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .padding(1.dp)
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    shape = MaterialTheme.shapes.small,
                    color = color
                ) {}
            }
            Text(
                status.name.lowercase().replaceFirstChar { it.uppercase() },
                style = MaterialTheme.typography.labelSmall,
                color = color
            )
        }
    }
}

@Composable
private fun ServerDetailPanel(
    server: MCPServer,
    isConnected: Boolean,
    statistics: com.chainlesschain.android.feature.mcp.data.repository.ServerStatistics,
    toolCalls: List<MCPToolCall>,
    onCallTool: (MCPTool) -> Unit,
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
            Text(server.name, style = MaterialTheme.typography.titleLarge)
            Row {
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete")
                }
                IconButton(onClick = onClose) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }
        }

        // Statistics
        if (statistics.totalCalls > 0) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text("Statistics", style = MaterialTheme.typography.titleSmall)
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        StatItem("Total", statistics.totalCalls.toString())
                        StatItem("Success", statistics.successfulCalls.toString())
                        StatItem("Failed", statistics.failedCalls.toString())
                    }
                    Text(
                        "Avg Latency: ${statistics.averageLatency}ms",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        }

        // Tools
        if (server.tools.isNotEmpty()) {
            Text(
                "Tools (${server.tools.size})",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 16.dp, bottom = 8.dp)
            )
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(server.tools) { tool ->
                    ToolItem(
                        tool = tool,
                        enabled = isConnected,
                        onClick = { onCallTool(tool) }
                    )
                }
            }
        } else if (isConnected) {
            Text(
                "No tools available",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 16.dp)
            )
        }

        // Recent calls for this server
        if (toolCalls.isNotEmpty()) {
            Text(
                "Recent Calls",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(top = 16.dp, bottom = 8.dp)
            )
            toolCalls.take(5).forEach { call ->
                ToolCallItem(call)
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
private fun ToolItem(
    tool: MCPTool,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        enabled = enabled && tool.isEnabled
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(tool.name, style = MaterialTheme.typography.bodyMedium)
                tool.description?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }
            if (tool.requiresConfirmation) {
                Icon(
                    Icons.Default.Warning,
                    contentDescription = "Requires confirmation",
                    tint = Color(0xFFFF9800),
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}

@Composable
private fun ToolCallItem(call: MCPToolCall) {
    val statusColor = when (call.status) {
        ToolCallStatus.COMPLETED -> Color(0xFF4CAF50)
        ToolCallStatus.FAILED -> Color(0xFFF44336)
        ToolCallStatus.RUNNING -> Color(0xFF2196F3)
        else -> Color.Gray
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(call.toolName, style = MaterialTheme.typography.bodySmall)
        Text(
            call.status.name,
            style = MaterialTheme.typography.labelSmall,
            color = statusColor
        )
    }
}

@Composable
private fun RecentCallsPanel(
    calls: List<MCPToolCall>,
    modifier: Modifier = Modifier
) {
    if (calls.isEmpty()) {
        Box(
            modifier = modifier,
            contentAlignment = Alignment.Center
        ) {
            Text("No recent tool calls", color = MaterialTheme.colorScheme.outline)
        }
    } else {
        LazyColumn(
            modifier = modifier,
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(calls) { call ->
                Card {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(call.toolName, style = MaterialTheme.typography.titleSmall)
                            Text(
                                call.status.name,
                                style = MaterialTheme.typography.labelSmall,
                                color = when (call.status) {
                                    ToolCallStatus.COMPLETED -> Color(0xFF4CAF50)
                                    ToolCallStatus.FAILED -> Color(0xFFF44336)
                                    else -> Color.Gray
                                }
                            )
                        }
                        Text(
                            "Server: ${call.serverId.take(8)}...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline
                        )
                        call.result?.let {
                            Text(
                                it.take(100),
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                        }
                        call.error?.let {
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
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddServerDialog(
    onDismiss: () -> Unit,
    onAdd: (String, String, MCPTransport) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var selectedTransport by remember { mutableStateOf(MCPTransport.HTTP_SSE) }
    var expanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add MCP Server") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("URL") },
                    placeholder = { Text("http://localhost:3000") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedTransport.name,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Transport") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        MCPTransport.entries.forEach { transport ->
                            DropdownMenuItem(
                                text = { Text(transport.name) },
                                onClick = {
                                    selectedTransport = transport
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onAdd(name, url, selectedTransport) },
                enabled = name.isNotBlank() && url.isNotBlank()
            ) {
                Text("Add")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
