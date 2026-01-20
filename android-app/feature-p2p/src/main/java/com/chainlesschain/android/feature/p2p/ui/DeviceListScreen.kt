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
import com.chainlesschain.android.core.p2p.model.P2PDevice
import com.chainlesschain.android.feature.p2p.viewmodel.DeviceUiState
import com.chainlesschain.android.feature.p2p.viewmodel.DeviceWithSession
import com.chainlesschain.android.feature.p2p.viewmodel.P2PDeviceViewModel

/**
 * P2P 设备列表界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceListScreen(
    onDeviceClick: (String) -> Unit,
    onVerifyClick: (String) -> Unit,
    viewModel: P2PDeviceViewModel = hiltViewModel()
) {
    val discoveredDevices by viewModel.discoveredDevices.collectAsState()
    val connectedDevices by viewModel.connectedDevices.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val isScanning by viewModel.isScanning.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("P2P 设备") },
                actions = {
                    IconButton(
                        onClick = {
                            if (isScanning) {
                                viewModel.stopScanning()
                            } else {
                                viewModel.startScanning()
                            }
                        }
                    ) {
                        Icon(
                            imageVector = if (isScanning) Icons.Default.Stop else Icons.Default.Search,
                            contentDescription = if (isScanning) "停止扫描" else "开始扫描"
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
            // 错误提示
            if (uiState is DeviceUiState.Error) {
                ErrorBanner(
                    message = (uiState as DeviceUiState.Error).message,
                    onDismiss = { viewModel.clearError() }
                )
            }

            // 扫描状态
            if (isScanning) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth()
                )
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // 已连接设备
                if (connectedDevices.isNotEmpty()) {
                    item {
                        SectionHeader(text = "已连接设备")
                    }

                    items(connectedDevices) { device ->
                        ConnectedDeviceItem(
                            device = device,
                            onClick = { onDeviceClick(device.deviceId) },
                            onVerify = { onVerifyClick(device.deviceId) },
                            onDisconnect = { viewModel.disconnectDevice(device.deviceId) }
                        )
                    }

                    item {
                        Spacer(modifier = Modifier.height(16.dp))
                    }
                }

                // 发现的设备
                if (discoveredDevices.isNotEmpty()) {
                    item {
                        SectionHeader(text = "附近设备")
                    }

                    items(discoveredDevices) { device ->
                        DiscoveredDeviceItem(
                            device = device,
                            isConnecting = uiState is DeviceUiState.Connecting &&
                                    (uiState as DeviceUiState.Connecting).deviceId == device.deviceId,
                            onClick = { viewModel.connectDevice(device) }
                        )
                    }
                }

                // 空状态
                if (discoveredDevices.isEmpty() && connectedDevices.isEmpty() && !isScanning) {
                    item {
                        EmptyState(
                            onStartScan = { viewModel.startScanning() }
                        )
                    }
                }
            }
        }
    }
}

/**
 * 章节标题
 */
@Composable
fun SectionHeader(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(vertical = 8.dp)
    )
}

/**
 * 已连接设备项
 */
@Composable
fun ConnectedDeviceItem(
    device: DeviceWithSession,
    onClick: () -> Unit,
    onVerify: () -> Unit,
    onDisconnect: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 设备图标
            Icon(
                imageVector = Icons.Default.PhoneAndroid,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.width(16.dp))

            // 设备信息
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = device.deviceName,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )

                    if (device.isVerified) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Icon(
                            imageVector = Icons.Default.Verified,
                            contentDescription = "已验证",
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.tertiary
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "消息: ${device.sessionInfo.sendMessageNumber} 发送 / ${device.sessionInfo.receiveMessageNumber} 接收",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 操作按钮
            Row {
                if (!device.isVerified) {
                    IconButton(onClick = onVerify) {
                        Icon(
                            imageVector = Icons.Default.VerifiedUser,
                            contentDescription = "验证"
                        )
                    }
                }

                IconButton(onClick = onDisconnect) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "断开连接"
                    )
                }
            }
        }
    }
}

/**
 * 发现的设备项
 */
@Composable
fun DiscoveredDeviceItem(
    device: P2PDevice,
    isConnecting: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick,
        enabled = !isConnecting
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 设备图标
            Icon(
                imageVector = Icons.Default.DevicesOther,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = MaterialTheme.colorScheme.secondary
            )

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
                    text = device.deviceId.take(16) + "...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 连接按钮或加载指示器
            if (isConnecting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp)
                )
            } else {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = "连接"
                )
            }
        }
    }
}

/**
 * 错误横幅
 */
@Composable
fun ErrorBanner(
    message: String,
    onDismiss: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Error,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error
            )

            Spacer(modifier = Modifier.width(16.dp))

            Text(
                text = message,
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onErrorContainer
            )

            IconButton(onClick = onDismiss) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "关闭",
                    tint = MaterialTheme.colorScheme.onErrorContainer
                )
            }
        }
    }
}

/**
 * 空状态
 */
@Composable
fun EmptyState(
    onStartScan: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.Default.DevicesOther,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.outline
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "未发现设备",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "点击搜索按钮开始扫描附近的设备",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(onClick = onStartScan) {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = null
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("开始扫描")
        }
    }
}
