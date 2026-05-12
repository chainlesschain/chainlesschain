package com.chainlesschain.android.presentation.screens.turn

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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.NetworkCheck
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import com.chainlesschain.android.core.p2p.ice.StunTestResult
import com.chainlesschain.android.core.p2p.ice.TurnServerCredentials
import org.webrtc.PeerConnection

/**
 * v1.1 issue #19 W3：Settings → 中继服务器 (TURN) Compose 屏。
 *
 * 功能：
 *  - 顶部 transport policy chip 切换 (ALL / RELAY / NOHOST)
 *  - 中部 user-defined TURN 列表（url + username 显示，password 隐藏）+ 删除按钮
 *  - 底部 "添加 TURN 服务器" 按钮 → 弹 AlertDialog 输入 url/username/password
 *  - "测试 STUN" 按钮（默认 stun.l.google.com:19302）→ 弹结果
 *
 * 默认 init 时 IceServerConfig 已有 openrelay.metered.ca 兜底；用户加自托管会一并使用。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TurnSettingsScreen(
    onBack: () -> Unit = {},
    viewModel: TurnSettingsViewModel = hiltViewModel(),
) {
    val turnServers by viewModel.turnServers.collectAsState()
    val transportPolicy by viewModel.transportPolicy.collectAsState()
    val testResult by viewModel.testResult.collectAsState()

    var showAddDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("中继服务器 (TURN)") }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Transport policy section
            item {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            "ICE 传输策略",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "ALL = 全部候选 (默认)；RELAY = 仅走 TURN 中继 (隐私 / 严格 NAT)；NOHOST = 不用本地 host 地址",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            for (policy in PeerConnection.IceTransportsType.values()) {
                                FilterChip(
                                    selected = transportPolicy == policy,
                                    onClick = { viewModel.setTransportPolicy(policy) },
                                    label = { Text(policy.name) },
                                )
                            }
                        }
                    }
                }
            }

            // STUN test
            item {
                Card(
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    "STUN 连通性测试",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    "测试 stun.l.google.com:19302 可达性",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            OutlinedButton(onClick = {
                                viewModel.testStun("stun:stun.l.google.com:19302")
                            }) {
                                Icon(Icons.Default.NetworkCheck, contentDescription = null)
                                Spacer(Modifier.height(0.dp))
                                Text(" 测试")
                            }
                        }
                        testResult?.let { result ->
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = stunResultLabel(result),
                                style = MaterialTheme.typography.bodySmall,
                                color = stunResultColor(result),
                                fontFamily = FontFamily.Monospace,
                            )
                        }
                    }
                }
            }

            // TURN servers list header
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                ) {
                    Text(
                        "用户自定义 TURN 服务器 (${turnServers.size})",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Button(onClick = { showAddDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = null)
                        Spacer(Modifier.height(0.dp))
                        Text(" 添加")
                    }
                }
            }

            if (turnServers.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "无自定义 TURN 服务器 — 内置 openrelay.metered.ca 已自动兜底",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                items(items = turnServers, key = { it.url }) { server ->
                    TurnServerCard(server, onRemove = { viewModel.removeTurnServer(server.url) })
                }
            }

            // 文档链接
            item {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = onBack,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("返回") }
                Text(
                    "自托管 TURN 服务器搭建文档：docs/guides/TURN_Setup.md",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }

    if (showAddDialog) {
        AddTurnServerDialog(
            onAdd = { url, user, pass ->
                viewModel.addTurnServer(url, user, pass)
                showAddDialog = false
            },
            onDismiss = { showAddDialog = false },
        )
    }
}

@Composable
private fun TurnServerCard(server: TurnServerCredentials, onRemove: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    server.url,
                    style = MaterialTheme.typography.titleSmall,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 2,
                )
                Text(
                    "用户名: ${server.username}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "密码: ${"•".repeat(server.password.length.coerceAtMost(12))}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onRemove) {
                Icon(Icons.Default.Delete, contentDescription = "删除", tint = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun AddTurnServerDialog(onAdd: (String, String, String) -> Unit, onDismiss: () -> Unit) {
    var url by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val canAdd = url.isNotBlank() && username.isNotBlank() && password.isNotBlank()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("添加 TURN 服务器") },
        text = {
            Column {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("URL") },
                    placeholder = { Text("turn:host:port?transport=tcp") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    label = { Text("用户名") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("密码") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "URL 格式：turn:HOST:PORT 或 turn:HOST:PORT?transport=tcp，turns:... 走 TLS。" +
                        "凭证一般为 long-term username + shared-secret，由 TURN 服务器管理员提供。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onAdd(url, username, password) },
                enabled = canAdd,
            ) { Text("添加") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

private fun stunResultLabel(r: StunTestResult): String = when (r) {
    is StunTestResult.Success -> "✅ ${r.url} 响应 ${r.latencyMs}ms"
    is StunTestResult.Timeout -> "⏰ ${r.url} 超时（5s）"
    is StunTestResult.Failed -> "❌ ${r.url} 失败：${r.error}"
}

@Composable
private fun stunResultColor(r: StunTestResult): androidx.compose.ui.graphics.Color = when (r) {
    is StunTestResult.Success -> MaterialTheme.colorScheme.primary
    is StunTestResult.Timeout, is StunTestResult.Failed -> MaterialTheme.colorScheme.error
}
