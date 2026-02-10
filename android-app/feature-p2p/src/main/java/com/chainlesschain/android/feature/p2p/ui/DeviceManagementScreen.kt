package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.P2PDeviceViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.DeviceWithSession
import java.text.SimpleDateFormat
import java.util.*

/**
 * 设备管理界面
 *
 * 管理与当前DID关联的所有设备
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceManagementScreen(
    onBack: () -> Unit,
    onDeviceClick: (String) -> Unit,
    onVerifyDevice: (String) -> Unit = {},
    viewModel: P2PDeviceViewModel = hiltViewModel()
) {
    val connectedDevices by viewModel.connectedDevices.collectAsState()
    val discoveredDevices by viewModel.discoveredDevices.collectAsState()
    val isScanning by viewModel.isScanning.collectAsState()
    val uiState by viewModel.uiState.collectAsState()

    var showDisconnectDialog by remember { mutableStateOf<DeviceWithSession?>(null) }
    var selectedTab by remember { mutableStateOf(0) } // 0=已连接, 1=发现的设备

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设备管理") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 顶部扫描按钮（更明显）
                    IconButton(
                        onClick = {
                            if (isScanning) {
                                viewModel.stopScanning()
                            } else {
                                viewModel.startScanning()
                                selectedTab = 1 // 切换到发现的设备页
                            }
                        }
                    ) {
                        Icon(
                            imageVector = if (isScanning) Icons.Default.Stop else Icons.Default.Search,
                            contentDescription = if (isScanning) "停止扫描" else "扫描设备",
                            tint = if (isScanning) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            // 浮动扫描按钮
            FloatingActionButton(
                onClick = {
                    if (isScanning) {
                        viewModel.stopScanning()
                    } else {
                        viewModel.startScanning()
                        selectedTab = 1 // 切换到发现的设备页
                    }
                },
                containerColor = if (isScanning) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.primary
                }
            ) {
                Icon(
                    imageVector = if (isScanning) Icons.Default.Stop else Icons.Default.Search,
                    contentDescription = if (isScanning) "停止扫描" else "扫描设备"
                )
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 设备统计卡片
            DeviceStatisticsCard(
                totalDevices = connectedDevices.size,
                verifiedDevices = connectedDevices.count { it.isVerified },
                discoveredCount = discoveredDevices.size,
                isScanning = isScanning
            )

            Divider()

            // Tab 切换（已连接 / 发现的设备）
            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = { Text("已连接 (${connectedDevices.size})") }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("发现的设备 (${discoveredDevices.size})")
                            if (isScanning) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp
                                )
                            }
                        }
                    }
                )
            }

            // 内容区域
            when (selectedTab) {
                0 -> {
                    // 已连接的设备
                    if (connectedDevices.isEmpty()) {
                        EmptyDeviceList(message = "暂无已连接设备", hint = "点击右下角按钮扫描新设备")
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(connectedDevices, key = { it.deviceId }) { device ->
                                DeviceCard(
                                    device = device,
                                    onClick = { onDeviceClick(device.deviceId) },
                                    onDisconnect = { showDisconnectDialog = device },
                                    onVerify = { onVerifyDevice(device.deviceId) }
                                )
                            }
                        }
                    }
                }
                1 -> {
                    // 发现的设备
                    if (discoveredDevices.isEmpty()) {
                        EmptyDeviceList(
                            message = if (isScanning) "正在扫描附近设备..." else "未发现设备",
                            hint = if (isScanning) "请稍候，正在搜索中" else "点击右下角按钮开始扫描"
                        )
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(discoveredDevices, key = { it.deviceId }) { device ->
                                DiscoveredDeviceCard(
                                    device = device,
                                    onConnect = {
                                        viewModel.connectDevice(device)
                                        viewModel.stopScanning()
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }

        // 断开连接确认对话框
        showDisconnectDialog?.let { device ->
            DisconnectConfirmDialog(
                deviceName = device.deviceName,
                onConfirm = {
                    viewModel.disconnectDevice(device.deviceId)
                    showDisconnectDialog = null
                },
                onDismiss = { showDisconnectDialog = null }
            )
        }

        // 错误提示
        if (uiState is com.chainlesschain.android.feature.p2p.viewmodel.DeviceUiState.Error) {
            val error = (uiState as com.chainlesschain.android.feature.p2p.viewmodel.DeviceUiState.Error).message
            Snackbar(
                modifier = Modifier.padding(16.dp),
                action = {
                    TextButton(onClick = { viewModel.clearError() }) {
                        Text("关闭")
                    }
                }
            ) {
                Text(error)
            }
        }
    }
}

/**
 * 设备统计卡片
 */
@Composable
fun DeviceStatisticsCard(
    totalDevices: Int,
    verifiedDevices: Int,
    discoveredCount: Int = 0,
    isScanning: Boolean = false
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            // 总设备数
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = Icons.Default.Devices,
                    contentDescription = null,
                    modifier = Modifier.size(32.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = totalDevices.toString(),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Text(
                    text = "已连接",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
            }

            Divider(
                modifier = Modifier
                    .height(80.dp)
                    .width(1.dp)
            )

            // 已验证设备数
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = Icons.Default.Verified,
                    contentDescription = null,
                    modifier = Modifier.size(32.dp),
                    tint = MaterialTheme.colorScheme.tertiary
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = verifiedDevices.toString(),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Text(
                    text = "已验证",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
            }

            Divider(
                modifier = Modifier
                    .height(80.dp)
                    .width(1.dp)
            )

            // 发现的设备数
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = if (isScanning) Icons.Default.Search else Icons.Default.DevicesOther,
                    contentDescription = null,
                    modifier = Modifier.size(32.dp),
                    tint = if (isScanning) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.6f)
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = discoveredCount.toString(),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Text(
                    text = if (isScanning) "扫描中" else "已发现",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                )
            }
        }
    }
}

/**
 * 设备卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceCard(
    device: DeviceWithSession,
    onClick: () -> Unit,
    onDisconnect: () -> Unit,
    onVerify: () -> Unit = {}
) {
    var showMenu by remember { mutableStateOf(false) }

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 设备图标
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = if (device.isVerified) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.errorContainer
                },
                modifier = Modifier.size(48.dp)
            ) {
                Box(
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.PhoneAndroid,
                        contentDescription = null,
                        tint = if (device.isVerified) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.error
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.width(16.dp))

            // 设备信息
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = device.deviceName,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )

                    if (device.isVerified) {
                        Icon(
                            imageVector = Icons.Default.Verified,
                            contentDescription = "已验证",
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "设备ID: ${device.deviceId.take(16)}...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(4.dp))

                // 会话信息
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = null,
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.tertiary
                    )
                    Text(
                        text = "E2EE会话 • ${device.sessionInfo.sendMessageNumber}/${device.sessionInfo.receiveMessageNumber} 消息",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 更多菜单
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(
                        Icons.Default.MoreVert,
                        contentDescription = "更多选项"
                    )
                }

                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("查看详情") },
                        onClick = {
                            showMenu = false
                            onClick()
                        },
                        leadingIcon = {
                            Icon(Icons.Default.Info, contentDescription = null)
                        }
                    )

                    if (!device.isVerified) {
                        DropdownMenuItem(
                            text = { Text("验证设备") },
                            onClick = {
                                showMenu = false
                                onVerify()
                            },
                            leadingIcon = {
                                Icon(Icons.Default.Security, contentDescription = null)
                            }
                        )
                    }

                    Divider()

                    DropdownMenuItem(
                        text = { Text("断开连接", color = MaterialTheme.colorScheme.error) },
                        onClick = {
                            showMenu = false
                            onDisconnect()
                        },
                        leadingIcon = {
                            Icon(
                                Icons.Default.LinkOff,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    )
                }
            }
        }
    }
}

/**
 * 空设备列表
 */
@Composable
fun EmptyDeviceList(
    message: String = "暂无已连接设备",
    hint: String = "扫描附近设备以建立连接"
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Icon(
                imageVector = Icons.Default.DevicesOther,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )

            Text(
                text = message,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Text(
                text = hint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )
        }
    }
}

/**
 * 发现的设备卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiscoveredDeviceCard(
    device: com.chainlesschain.android.core.p2p.model.P2PDevice,
    onConnect: () -> Unit
) {
    Card(
        onClick = onConnect,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 设备图标
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.secondaryContainer,
                modifier = Modifier.size(48.dp)
            ) {
                Box(
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.PhoneAndroid,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.secondary
                    )
                }
            }

            Spacer(modifier = Modifier.width(16.dp))

            // 设备信息
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = device.deviceName,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "设备ID: ${device.deviceId.take(16)}...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(4.dp))

                // 地址信息
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.SignalCellularAlt,
                        contentDescription = null,
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.tertiary
                    )
                    Text(
                        text = device.address ?: "未知地址",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 连接按钮
            FilledTonalButton(
                onClick = onConnect,
                modifier = Modifier.padding(start = 8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Link,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text("连接")
            }
        }
    }
}

/**
 * 断开连接确认对话框
 */
@Composable
fun DisconnectConfirmDialog(
    deviceName: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.Warning,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error
            )
        },
        title = {
            Text("断开设备连接")
        },
        text = {
            Text("确定要断开与 \"$deviceName\" 的连接吗？\n\n这将删除与该设备的加密会话，需要重新配对才能再次连接。")
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                colors = ButtonDefaults.textButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Text("断开连接")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

/**
 * 格式化会话时间
 */
private fun formatSessionTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "刚刚"
        diff < 3600_000 -> "${diff / 60_000}分钟前"
        diff < 86400_000 -> "${diff / 3600_000}小时前"
        diff < 604800_000 -> "${diff / 86400_000}天前"
        else -> {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            sdf.format(Date(timestamp))
        }
    }
}
