package com.chainlesschain.android.remote.ui

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay

/**
 * 设备扫描界面
 *
 * 功能：
 * - 扫描局域网内的 PC 设备
 * - 显示发现的设备列表
 * - 快速注册新设备
 * - 显示扫描进度
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceScanScreen(
    onNavigateBack: () -> Unit = {},
    onDeviceSelected: (String) -> Unit = {}
) {
    var isScanning by remember { mutableStateOf(false) }
    var discoveredDevices by remember { mutableStateOf<List<DiscoveredDevice>>(emptyList()) }
    var showRegisterDialog by remember { mutableStateOf(false) }
    var selectedDevice by remember { mutableStateOf<DiscoveredDevice?>(null) }

    // 模拟扫描过程
    LaunchedEffect(isScanning) {
        if (isScanning) {
            delay(2000)
            discoveredDevices = listOf(
                DiscoveredDevice(
                    peerId = "peer-001",
                    deviceName = "新的台式机",
                    ipAddress = "192.168.1.100",
                    isRegistered = false
                ),
                DiscoveredDevice(
                    peerId = "peer-002",
                    deviceName = "我的台式机",
                    ipAddress = "192.168.1.101",
                    isRegistered = true
                )
            )
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
                },
                actions = {
                    if (isScanning) {
                        CircularProgressIndicator(
                            modifier = Modifier
                                .size(24.dp)
                                .padding(end = 12.dp),
                            strokeWidth = 2.dp
                        )
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
            // 扫描状态卡片
            ScanStatusCard(
                isScanning = isScanning,
                deviceCount = discoveredDevices.size,
                onStartScan = { isScanning = true }
            )

            // 发现的设备列表
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
                                if (!device.isRegistered) {
                                    selectedDevice = device
                                    showRegisterDialog = true
                                }
                            }
                        )
                    }
                }
            } else if (!isScanning) {
                // 空状态
                EmptyScanState()
            }
        }
    }

    // 注册设备对话框
    if (showRegisterDialog && selectedDevice != null) {
        RegisterDeviceDialog(
            device = selectedDevice!!,
            onDismiss = {
                showRegisterDialog = false
                selectedDevice = null
            },
            onConfirm = { deviceName ->
                // TODO: 实际注册设备
                showRegisterDialog = false
                selectedDevice = null
            }
        )
    }
}

/**
 * 扫描状态卡片
 */
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
            containerColor = if (isScanning)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = if (isScanning) Icons.Default.Radar else Icons.Default.Search,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = if (isScanning)
                    MaterialTheme.colorScheme.primary
                else
                    MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = if (isScanning) "正在扫描..." else "准备扫描",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = if (isScanning)
                    "正在搜索局域网内的 PC 设备"
                else
                    "点击下方按钮开始扫描局域网内的设备",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            if (deviceCount > 0 && !isScanning) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "已发现 $deviceCount 个设备",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Medium
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = onStartScan,
                enabled = !isScanning,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(if (isScanning) "扫描中..." else "开始扫描")
            }
        }
    }
}

/**
 * 发现的设备项
 */
@Composable
fun DiscoveredDeviceItem(
    device: DiscoveredDevice,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick, enabled = !device.isRegistered),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (device.isRegistered)
                MaterialTheme.colorScheme.surfaceVariant
            else
                MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 设备图标
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(
                        if (device.isRegistered)
                            Color(0xFF9E9E9E).copy(alpha = 0.2f)
                        else
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Computer,
                    contentDescription = null,
                    tint = if (device.isRegistered)
                        Color(0xFF9E9E9E)
                    else
                        MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(28.dp)
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            // 设备信息
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = device.deviceName,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.NetworkCheck,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = device.ipAddress,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 状态标识
            if (device.isRegistered) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = Color(0xFF9E9E9E).copy(alpha = 0.15f)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = Color(0xFF9E9E9E)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "已注册",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFF9E9E9E)
                        )
                    }
                }
            } else {
                Icon(
                    imageVector = Icons.Default.ChevronRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 空状态
 */
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

        Text(
            text = "暂无发现设备",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "请确保 PC 端应用正在运行且与手机在同一网络",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
    }
}

/**
 * 注册设备对话框
 */
@Composable
fun RegisterDeviceDialog(
    device: DiscoveredDevice,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var deviceName by remember { mutableStateOf(device.deviceName) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("注册新设备") },
        text = {
            Column {
                Text(
                    text = "发现新的 PC 设备，是否要注册？",
                    style = MaterialTheme.typography.bodyMedium
                )

                Spacer(modifier = Modifier.height(16.dp))

                OutlinedTextField(
                    value = deviceName,
                    onValueChange = { deviceName = it },
                    label = { Text("设备名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "IP: ${device.ipAddress}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(deviceName) },
                enabled = deviceName.isNotBlank()
            ) {
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

// 数据类
data class DiscoveredDevice(
    val peerId: String,
    val deviceName: String,
    val ipAddress: String,
    val isRegistered: Boolean
)
