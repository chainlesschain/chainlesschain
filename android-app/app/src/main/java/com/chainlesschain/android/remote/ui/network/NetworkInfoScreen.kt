package com.chainlesschain.android.remote.ui.network

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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.NetworkInterface
import com.chainlesschain.android.remote.commands.NetworkStatusDetail
import com.chainlesschain.android.remote.p2p.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NetworkInfoScreen(
    viewModel: NetworkInfoViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val networkStatus by viewModel.networkStatus.collectAsState()
    val interfaces by viewModel.interfaces.collectAsState()
    val bandwidth by viewModel.bandwidth.collectAsState()
    val publicIP by viewModel.publicIP.collectAsState()
    val wifiInfo by viewModel.wifiInfo.collectAsState()

    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Status", "Interfaces", "Tools")

    var pingHost by remember { mutableStateOf("") }
    var resolveHost by remember { mutableStateOf("") }

    val isConnected = connectionState == ConnectionState.CONNECTED

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Network Info") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
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
                            contentDescription = "Auto Refresh"
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
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
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

            // 加载指示器
            if (uiState.isLoading || uiState.isExecuting) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            when (selectedTab) {
                0 -> StatusTab(
                    networkStatus = networkStatus,
                    bandwidth = bandwidth,
                    publicIP = publicIP,
                    wifiInfo = wifiInfo,
                    onGetPublicIP = { viewModel.getPublicIP() },
                    onGetWifi = { viewModel.getWifiInfo() }
                )
                1 -> InterfacesTab(interfaces = interfaces)
                2 -> ToolsTab(
                    enabled = isConnected && !uiState.isExecuting,
                    pingHost = pingHost,
                    onPingHostChange = { pingHost = it },
                    onPing = { viewModel.ping(pingHost) },
                    pingResult = uiState.pingResult,
                    resolveHost = resolveHost,
                    onResolveHostChange = { resolveHost = it },
                    onResolve = { viewModel.resolve(resolveHost) },
                    resolveResult = uiState.resolveResult,
                    onTraceroute = { viewModel.traceroute(pingHost) },
                    tracerouteResult = uiState.tracerouteResult,
                    onSpeedTest = { viewModel.speedTest() },
                    speedTestResult = uiState.speedTestResult
                )
            }
        }
    }
}

@Composable
private fun StatusTab(
    networkStatus: NetworkStatusDetail?,
    bandwidth: com.chainlesschain.android.remote.commands.BandwidthInfo?,
    publicIP: String?,
    wifiInfo: com.chainlesschain.android.remote.commands.WifiInfo?,
    onGetPublicIP: () -> Unit,
    onGetWifi: () -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 连接状态
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (networkStatus?.connected == true)
                        MaterialTheme.colorScheme.primaryContainer
                    else MaterialTheme.colorScheme.errorContainer
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        if (networkStatus?.connected == true) Icons.Default.Wifi else Icons.Default.WifiOff,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp)
                    )
                    Spacer(modifier = Modifier.width(16.dp))
                    Column {
                        Text(
                            text = if (networkStatus?.connected == true) "Connected" else "Disconnected",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        networkStatus?.type?.let {
                            Text(
                                text = "Type: $it",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                }
            }
        }

        // IP 信息
        networkStatus?.let { status ->
            item {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("Network Details", fontWeight = FontWeight.Bold)
                        status.ip?.let { Text("Local IP: $it") }
                        status.gateway?.let { Text("Gateway: $it") }
                        status.dns?.let { Text("DNS: ${it.joinToString(", ")}") }
                        status.mac?.let { Text("MAC: $it") }
                    }
                }
            }
        }

        // 公网 IP
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Public IP", fontWeight = FontWeight.Bold)
                        Text(
                            text = publicIP ?: "Not fetched",
                            color = if (publicIP != null) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    IconButton(onClick = onGetPublicIP) {
                        Icon(Icons.Default.Refresh, contentDescription = "Get Public IP")
                    }
                }
            }
        }

        // 带宽信息
        bandwidth?.let { bw ->
            item {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                    ) {
                        Text("Bandwidth Usage", fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Default.ArrowDownward, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                Text(bw.rxRateFormatted, fontWeight = FontWeight.Bold)
                                Text("Download", style = MaterialTheme.typography.bodySmall)
                            }
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Default.ArrowUpward, contentDescription = null, tint = MaterialTheme.colorScheme.tertiary)
                                Text(bw.txRateFormatted, fontWeight = FontWeight.Bold)
                                Text("Upload", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }

        // WiFi 信息
        item {
            OutlinedButton(
                onClick = onGetWifi,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Wifi, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Get WiFi Info")
            }
        }

        wifiInfo?.let { wifi ->
            item {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("WiFi", fontWeight = FontWeight.Bold)
                        wifi.ssid?.let { Text("SSID: $it") }
                        wifi.signal?.let { Text("Signal: $it dBm") }
                        wifi.channel?.let { Text("Channel: $it") }
                        wifi.authentication?.let { Text("Security: $it") }
                    }
                }
            }
        }
    }
}

@Composable
private fun InterfacesTab(interfaces: List<NetworkInterface>) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (interfaces.isEmpty()) {
            item {
                Text(
                    "No network interfaces found",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            items(interfaces) { iface ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = iface.name,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = if (iface.up == true) "UP" else "DOWN",
                                color = if (iface.up == true) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.error
                            )
                        }
                        iface.type?.let { Text("Type: $it", style = MaterialTheme.typography.bodySmall) }
                        iface.ip4?.let { Text("IPv4: $it", style = MaterialTheme.typography.bodySmall) }
                        iface.ip6?.let { Text("IPv6: $it", style = MaterialTheme.typography.bodySmall) }
                        iface.mac?.let { Text("MAC: $it", style = MaterialTheme.typography.bodySmall) }
                        iface.speed?.let { Text("Speed: ${it}Mbps", style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolsTab(
    enabled: Boolean,
    pingHost: String,
    onPingHostChange: (String) -> Unit,
    onPing: () -> Unit,
    pingResult: String?,
    resolveHost: String,
    onResolveHostChange: (String) -> Unit,
    onResolve: () -> Unit,
    resolveResult: String?,
    onTraceroute: () -> Unit,
    tracerouteResult: String?,
    onSpeedTest: () -> Unit,
    speedTestResult: String?
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Ping
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("Ping", fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = pingHost,
                        onValueChange = onPingHostChange,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Enter host (e.g., google.com)") },
                        singleLine = true
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = onPing,
                            enabled = enabled && pingHost.isNotBlank()
                        ) {
                            Text("Ping")
                        }
                        OutlinedButton(
                            onClick = onTraceroute,
                            enabled = enabled && pingHost.isNotBlank()
                        ) {
                            Text("Traceroute")
                        }
                    }
                    pingResult?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                    tracerouteResult?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        // DNS Resolve
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("DNS Lookup", fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = resolveHost,
                        onValueChange = onResolveHostChange,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Enter hostname") },
                        singleLine = true
                    )
                    Button(
                        onClick = onResolve,
                        enabled = enabled && resolveHost.isNotBlank()
                    ) {
                        Text("Resolve")
                    }
                    resolveResult?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        // Speed Test
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("Speed Test", fontWeight = FontWeight.Bold)
                    Button(
                        onClick = onSpeedTest,
                        enabled = enabled,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Speed, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Run Speed Test")
                    }
                    speedTestResult?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
