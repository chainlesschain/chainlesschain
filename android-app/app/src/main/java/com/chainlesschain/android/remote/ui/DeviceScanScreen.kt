package com.chainlesschain.android.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.NetworkCheck
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceScanScreen(
    onNavigateBack: () -> Unit = {},
    onDeviceSelected: (String, String) -> Unit = { _, _ -> },
    viewModel: DeviceScanViewModel = hiltViewModel()
) {
    var isScanning by remember { mutableStateOf(false) }
    val uiState by viewModel.uiState.collectAsState()
    val discoveredDevices = uiState.discoveredDevices

    var showRegisterDialog by remember { mutableStateOf(false) }
    var selectedDevice by remember { mutableStateOf<DiscoveredDevice?>(null) }

    LaunchedEffect(isScanning) {
        if (isScanning) {
            delay(1500)
            viewModel.discoverDevices()
            isScanning = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("扫描设备") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
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
            ScanStatusCard(
                isScanning = isScanning,
                deviceCount = discoveredDevices.size,
                onStartScan = { isScanning = true }
            )

            if (discoveredDevices.isNotEmpty()) {
                Text(
                    text = "发现的设备 (${discoveredDevices.size})",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(16.dp)
                )
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(discoveredDevices) { device ->
                        DiscoveredDeviceItem(
                            device = device,
                            onClick = {
                                if (device.isRegistered) {
                                    onDeviceSelected(device.peerId, device.did)
                                } else {
                                    selectedDevice = device
                                    showRegisterDialog = true
                                }
                            }
                        )
                    }
                }
            } else if (!isScanning) {
                EmptyScanState()
            }
        }
    }

    if (showRegisterDialog && selectedDevice != null) {
        RegisterDeviceDialog(
            device = selectedDevice!!,
            onDismiss = {
                showRegisterDialog = false
                selectedDevice = null
            },
            onConfirm = { deviceName ->
                val target = selectedDevice ?: return@RegisterDeviceDialog
                viewModel.registerDevice(target, deviceName) {
                    onDeviceSelected(target.peerId, target.did)
                }
                showRegisterDialog = false
                selectedDevice = null
            }
        )
    }
}

@Composable
fun ScanStatusCard(
    isScanning: Boolean,
    deviceCount: Int,
    onStartScan: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isScanning) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = null,
                modifier = Modifier.size(56.dp)
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = if (isScanning) "扫描中..." else "准备扫描",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = if (isScanning) "正在搜索局域网内的设备"
                else "点击下方按钮发现可用的电脑",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center
            )
            if (!isScanning && deviceCount > 0) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "发现 $deviceCount 台设备",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Medium
                )
            }
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = onStartScan,
                enabled = !isScanning,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(if (isScanning) "扫描中..." else "开始扫描")
            }
        }
    }
}

@Composable
fun DiscoveredDeviceItem(
    device: DiscoveredDevice,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Computer, contentDescription = null)
            }
            Spacer(modifier = Modifier.size(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(device.deviceName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.NetworkCheck,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.size(4.dp))
                    Text(
                        text = device.ipAddress,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            if (device.isRegistered) {
                Surface(shape = RoundedCornerShape(12.dp), color = Color(0xFF4CAF50).copy(alpha = 0.15f)) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = Color(0xFF2E7D32)
                        )
                        Spacer(modifier = Modifier.size(4.dp))
                        Text("已注册", style = MaterialTheme.typography.labelSmall, color = Color(0xFF2E7D32))
                    }
                }
            } else {
                Icon(Icons.Default.ChevronRight, contentDescription = null)
            }
        }
    }
}

@Composable
fun EmptyScanState() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.SearchOff,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text("未发现设备", style = MaterialTheme.typography.titleMedium)
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            "请确保桌面应用在同一局域网内运行",
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
fun RegisterDeviceDialog(
    device: DiscoveredDevice,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var deviceName by remember { mutableStateOf(device.deviceName) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("注册设备") },
        text = {
            Column {
                Text("连接前请先注册此设备")
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = deviceName,
                    onValueChange = { deviceName = it },
                    label = { Text("设备名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text("IP: ${device.ipAddress}", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(deviceName) }, enabled = deviceName.isNotBlank()) {
                Text("注册")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

data class DiscoveredDevice(
    val peerId: String,
    val deviceName: String,
    val ipAddress: String,
    val did: String = "did:key:$peerId",
    val isRegistered: Boolean = false
)
