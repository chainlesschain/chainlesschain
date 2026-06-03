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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
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
    val tabs = listOf(
        stringResource(R.string.rs_net_tab_status),
        stringResource(R.string.rs_net_tab_interfaces),
        stringResource(R.string.rs_net_tab_tools)
    )

    var pingHost by remember { mutableStateOf("") }
    var resolveHost by remember { mutableStateOf("") }

    val isConnected = connectionState == ConnectionState.CONNECTED

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.rs_net_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.common_refresh))
                    }
                    IconButton(
                        onClick = {
                            if (uiState.isAutoRefreshEnabled) viewModel.stopAutoRefresh()
                            else viewModel.startAutoRefresh()
                        }
                    ) {
                        Icon(
                            if (uiState.isAutoRefreshEnabled) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = stringResource(R.string.rs_net_auto_refresh)
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
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.rs_net_dismiss))
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
                            text = if (networkStatus?.connected == true) stringResource(R.string.common_connected) else stringResource(R.string.common_disconnected),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        networkStatus?.type?.let {
                            Text(
                                text = stringResource(R.string.rs_net_type_fmt, it),
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
                        Text(stringResource(R.string.rs_net_details), fontWeight = FontWeight.Bold)
                        status.ip?.let { Text(stringResource(R.string.rs_net_local_ip_fmt, it)) }
                        status.gateway?.let { Text(stringResource(R.string.rs_net_gateway_fmt, it)) }
                        status.dns?.let { Text(stringResource(R.string.rs_net_dns_fmt, it.joinToString(", "))) }
                        status.mac?.let { Text(stringResource(R.string.rs_net_mac_fmt, it)) }
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
                        Text(stringResource(R.string.rs_net_public_ip), fontWeight = FontWeight.Bold)
                        Text(
                            text = publicIP ?: stringResource(R.string.rs_net_not_fetched),
                            color = if (publicIP != null) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    IconButton(onClick = onGetPublicIP) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.rs_net_get_public_ip))
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
                        Text(stringResource(R.string.rs_net_bandwidth_usage), fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Default.ArrowDownward, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                Text(bw.rxRateFormatted, fontWeight = FontWeight.Bold)
                                Text(stringResource(R.string.rs_net_download), style = MaterialTheme.typography.bodySmall)
                            }
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Default.ArrowUpward, contentDescription = null, tint = MaterialTheme.colorScheme.tertiary)
                                Text(bw.txRateFormatted, fontWeight = FontWeight.Bold)
                                Text(stringResource(R.string.rs_net_upload), style = MaterialTheme.typography.bodySmall)
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
                Text(stringResource(R.string.rs_net_get_wifi_info))
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
                        Text(stringResource(R.string.rs_net_wifi), fontWeight = FontWeight.Bold)
                        wifi.ssid?.let { Text(stringResource(R.string.rs_net_ssid_fmt, it)) }
                        wifi.signal?.let { Text(stringResource(R.string.rs_net_signal_fmt, it)) }
                        wifi.channel?.let { Text(stringResource(R.string.rs_net_channel_fmt, it)) }
                        wifi.authentication?.let { Text(stringResource(R.string.rs_net_security_fmt, it)) }
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
                    stringResource(R.string.rs_net_no_interfaces),
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
                                text = if (iface.up == true) stringResource(R.string.rs_net_iface_up) else stringResource(R.string.rs_net_iface_down),
                                color = if (iface.up == true) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.error
                            )
                        }
                        iface.type?.let { Text(stringResource(R.string.rs_net_type_fmt, it), style = MaterialTheme.typography.bodySmall) }
                        iface.ip4?.let { Text(stringResource(R.string.rs_net_ipv4_fmt, it), style = MaterialTheme.typography.bodySmall) }
                        iface.ip6?.let { Text(stringResource(R.string.rs_net_ipv6_fmt, it), style = MaterialTheme.typography.bodySmall) }
                        iface.mac?.let { Text(stringResource(R.string.rs_net_mac_fmt, it), style = MaterialTheme.typography.bodySmall) }
                        iface.speed?.let { Text(stringResource(R.string.rs_net_speed_fmt, it), style = MaterialTheme.typography.bodySmall) }
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
                    Text(stringResource(R.string.rs_net_ping), fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = pingHost,
                        onValueChange = onPingHostChange,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text(stringResource(R.string.rs_net_enter_host)) },
                        singleLine = true
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = onPing,
                            enabled = enabled && pingHost.isNotBlank()
                        ) {
                            Text(stringResource(R.string.rs_net_ping))
                        }
                        OutlinedButton(
                            onClick = onTraceroute,
                            enabled = enabled && pingHost.isNotBlank()
                        ) {
                            Text(stringResource(R.string.rs_net_traceroute))
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
                    Text(stringResource(R.string.rs_net_dns_lookup), fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = resolveHost,
                        onValueChange = onResolveHostChange,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text(stringResource(R.string.rs_net_enter_hostname)) },
                        singleLine = true
                    )
                    Button(
                        onClick = onResolve,
                        enabled = enabled && resolveHost.isNotBlank()
                    ) {
                        Text(stringResource(R.string.rs_net_resolve))
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
                    Text(stringResource(R.string.rs_net_speed_test), fontWeight = FontWeight.Bold)
                    Button(
                        onClick = onSpeedTest,
                        enabled = enabled,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Speed, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(R.string.rs_net_run_speed_test))
                    }
                    speedTestResult?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
