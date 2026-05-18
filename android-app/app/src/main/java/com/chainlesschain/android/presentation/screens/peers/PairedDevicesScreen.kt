package com.chainlesschain.android.presentation.screens.peers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.p2p.PeerInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * v1.1 issue #19 W2.5：Settings → 已配对设备 Compose 页。
 *
 * 显示当前 P2P connectedPeers 列表（peer ID, DID, 连接时间, age）+ "全部解除" 按钮。
 *
 * v1.1 lifecycle 仍 single-peer-at-a-time（连前必先 disconnect 现有），所以列表实际只有
 * 0 或 1 entry；UI 已 ready 多设备视图，等 W2.2 lifecycle 多 peer 落地后自然显示 N 条。
 *
 * v1.2+ 留尾：per-peer disconnect / device rename / online status ping。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairedDevicesScreen(
    onBack: () -> Unit = {},
    viewModel: PairedDevicesViewModel = hiltViewModel(),
) {
    val devices by viewModel.pairedDevices.collectAsState()
    var showConfirmDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("已配对设备") }) }
    ) { padding ->
        Column(modifier = Modifier
            .fillMaxSize()
            .padding(padding)) {
            // 顶部 stats
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                ),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "${devices.size} 台桌面已配对",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = "v1.1 lifecycle 仍单 peer；W2.2 lifecycle 多 peer 落地后此处显示 N 台",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (devices.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "无已配对设备 — 通过 QR 配对或扫描桌面 mDNS",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(items = devices, key = { it.peerId }) { device ->
                        DeviceCard(device)
                    }
                    item {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { showConfirmDialog = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("全部解除配对") }
                        Spacer(Modifier.height(4.dp))
                        OutlinedButton(
                            onClick = onBack,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("返回") }
                    }
                }
            }
        }
    }

    if (showConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showConfirmDialog = false },
            icon = {
                Icon(
                    Icons.Default.DesktopWindows,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                )
            },
            title = { Text("解除所有桌面配对？") },
            text = {
                Text(
                    "断开所有 ${devices.size} 台已配对桌面。同步会停止；离线缓存的命令仍保留。" +
                        "需要重新扫码 / mDNS 才能重连。",
                    style = MaterialTheme.typography.bodyMedium,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showConfirmDialog = false
                    viewModel.disconnectAll()
                }) { Text("确认解除") }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmDialog = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun DeviceCard(device: PeerInfo) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = androidx.compose.foundation.shape.CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.padding(end = 12.dp),
            ) {
                Icon(
                    Icons.Default.DesktopWindows,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.padding(8.dp),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = device.peerId,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                )
                Text(
                    text = "DID: ${device.did.take(40)}…",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                )
                Text(
                    text = "连接 ${ageLabel(device.connectedAt)} · ${exactTime(device.connectedAt)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun ageLabel(ms: Long): String {
    val ageSec = (System.currentTimeMillis() - ms) / 1000
    return when {
        ageSec < 60 -> "${ageSec}s 前"
        ageSec < 3600 -> "${ageSec / 60}m 前"
        ageSec < 86400 -> "${ageSec / 3600}h 前"
        else -> "${ageSec / 86400}d 前"
    }
}

private fun exactTime(ms: Long): String {
    val fmt = SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault())
    return fmt.format(Date(ms))
}
