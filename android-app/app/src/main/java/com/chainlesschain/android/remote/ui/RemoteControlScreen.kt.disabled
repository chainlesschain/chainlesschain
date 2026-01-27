package com.chainlesschain.android.remote.ui

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.commands.SystemStatus
import java.text.SimpleDateFormat
import java.util.*

/**
 * 远程控制主界面
 *
 * 功能：
 * 1. 设备连接面板 - PC 设备列表、连接状态、一键连接/断开、连接质量指示
 * 2. 命令快捷入口 - AI 命令、系统命令
 * 3. 状态监控 - PC 端状态（CPU、内存）、连接状态
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteControlScreen(
    viewModel: RemoteControlViewModel = hiltViewModel(),
    onNavigateToAIChat: () -> Unit = {},
    onNavigateToRAGSearch: () -> Unit = {},
    onNavigateToAgentControl: () -> Unit = {},
    onNavigateToScreenshot: () -> Unit = {},
    onNavigateToSystemMonitor: () -> Unit = {},
    onNavigateToCommandHistory: () -> Unit = {},
    onNavigateToRemoteDesktop: () -> Unit = {},
    onNavigateToFileTransfer: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val connectedPeer by viewModel.connectedPeer.collectAsState()

    var showNotificationDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("远程控制") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                ),
                actions = {
                    // 刷新按钮
                    IconButton(
                        onClick = { viewModel.refreshSystemStatus() },
                        enabled = connectionState == ConnectionState.CONNECTED
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                }
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 1. 设备连接面板
            item {
                DeviceConnectionPanel(
                    connectionState = connectionState,
                    connectedPeer = connectedPeer,
                    onConnect = {
                        // TODO: 实际项目中应该显示设备选择对话框
                        // 这里使用测试数据
                        viewModel.connectToPC(
                            pcPeerId = "pc-test-001",
                            pcDID = "did:key:test-pc"
                        )
                    },
                    onDisconnect = { viewModel.disconnect() }
                )
            }

            // 2. 系统状态监控
            item {
                AnimatedVisibility(
                    visible = connectionState == ConnectionState.CONNECTED,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically()
                ) {
                    SystemStatusPanel(
                        systemStatus = uiState.systemStatus,
                        systemInfo = uiState.systemInfo,
                        lastRefreshTime = uiState.lastRefreshTime
                    )
                }
            }

            // 3. AI 命令快捷入口
            item {
                CommandShortcutsSection(
                    title = "AI 命令",
                    icon = Icons.Default.Psychology,
                    enabled = connectionState == ConnectionState.CONNECTED,
                    commands = listOf(
                        CommandShortcut(
                            title = "AI 对话",
                            subtitle = "与 PC 端 LLM 对话",
                            icon = Icons.Default.Chat,
                            onClick = onNavigateToAIChat
                        ),
                        CommandShortcut(
                            title = "RAG 搜索",
                            subtitle = "搜索 PC 端知识库",
                            icon = Icons.Default.Search,
                            onClick = onNavigateToRAGSearch
                        ),
                        CommandShortcut(
                            title = "Agent 控制",
                            subtitle = "控制 PC 端 AI Agent",
                            icon = Icons.Default.SmartToy,
                            onClick = onNavigateToAgentControl
                        )
                    )
                )
            }

            // 4. 系统命令快捷入口
            item {
                CommandShortcutsSection(
                    title = "系统命令",
                    icon = Icons.Default.Computer,
                    enabled = connectionState == ConnectionState.CONNECTED,
                    commands = listOf(
                        CommandShortcut(
                            title = "系统监控",
                            subtitle = "实时监控 PC 端系统状态",
                            icon = Icons.Default.Monitor,
                            onClick = onNavigateToSystemMonitor
                        ),
                        CommandShortcut(
                            title = "远程桌面",
                            subtitle = "连接到 PC 端桌面并远程控制",
                            icon = Icons.Default.DesktopWindows,
                            onClick = onNavigateToRemoteDesktop
                        ),
                        CommandShortcut(
                            title = "文件传输",
                            subtitle = "在 PC 和 Android 之间传输文件",
                            icon = Icons.Default.Folder,
                            onClick = onNavigateToFileTransfer
                        ),
                        CommandShortcut(
                            title = "截图",
                            subtitle = "获取 PC 端屏幕截图",
                            icon = Icons.Default.Screenshot,
                            onClick = onNavigateToScreenshot
                        ),
                        CommandShortcut(
                            title = "发送通知",
                            subtitle = "向 PC 端发送通知",
                            icon = Icons.Default.Notifications,
                            onClick = { showNotificationDialog = true }
                        ),
                        CommandShortcut(
                            title = "命令历史",
                            subtitle = "查看命令执行记录",
                            icon = Icons.Default.History,
                            onClick = onNavigateToCommandHistory
                        )
                    )
                )
            }
        }

        // 错误提示
        uiState.error?.let { error ->
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

        // 发送通知对话框
        if (showNotificationDialog) {
            SendNotificationDialog(
                onDismiss = { showNotificationDialog = false },
                onSend = { title, body ->
                    viewModel.sendNotification(
                        title = title,
                        body = body,
                        onSuccess = {
                            showNotificationDialog = false
                        },
                        onError = { error ->
                            // 错误已在 ViewModel 中处理
                        }
                    )
                }
            )
        }

        // 加载指示器
        if (uiState.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        }
    }
}

/**
 * 设备连接面板
 */
@Composable
fun DeviceConnectionPanel(
    connectionState: ConnectionState,
    connectedPeer: com.chainlesschain.android.remote.p2p.PeerInfo?,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 标题
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    Icons.Default.Computer,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "PC 设备连接",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            Divider()

            // 连接状态指示
            ConnectionStatusIndicator(connectionState, connectedPeer)

            // 连接/断开按钮
            Button(
                onClick = {
                    when (connectionState) {
                        ConnectionState.CONNECTED -> onDisconnect()
                        ConnectionState.DISCONNECTED -> onConnect()
                        else -> {}
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = connectionState != ConnectionState.CONNECTING
            ) {
                Icon(
                    imageVector = when (connectionState) {
                        ConnectionState.CONNECTED -> Icons.Default.LinkOff
                        else -> Icons.Default.Link
                    },
                    contentDescription = null,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = when (connectionState) {
                        ConnectionState.DISCONNECTED -> "连接到 PC"
                        ConnectionState.CONNECTING -> "连接中..."
                        ConnectionState.CONNECTED -> "断开连接"
                        ConnectionState.ERROR -> "重新连接"
                    }
                )
            }
        }
    }
}

/**
 * 连接状态指示器
 */
@Composable
fun ConnectionStatusIndicator(
    connectionState: ConnectionState,
    connectedPeer: com.chainlesschain.android.remote.p2p.PeerInfo?
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        // 状态文本
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = when (connectionState) {
                    ConnectionState.DISCONNECTED -> "未连接"
                    ConnectionState.CONNECTING -> "正在连接..."
                    ConnectionState.CONNECTED -> connectedPeer?.peerId ?: "已连接"
                    ConnectionState.ERROR -> "连接错误"
                },
                style = MaterialTheme.typography.bodyLarge
            )

            if (connectionState == ConnectionState.CONNECTED && connectedPeer != null) {
                val dateFormat = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }
                Text(
                    text = "连接于 ${dateFormat.format(Date(connectedPeer.connectedAt))}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        // 状态指示灯
        Box(
            modifier = Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(
                    when (connectionState) {
                        ConnectionState.CONNECTED -> Color(0xFF4CAF50)
                        ConnectionState.CONNECTING -> Color(0xFFFF9800)
                        ConnectionState.ERROR -> Color(0xFFF44336)
                        ConnectionState.DISCONNECTED -> Color(0xFF9E9E9E)
                    }
                )
        )
    }
}

/**
 * 系统状态面板
 */
@Composable
fun SystemStatusPanel(
    systemStatus: SystemStatus?,
    systemInfo: com.chainlesschain.android.remote.commands.SystemInfo?,
    lastRefreshTime: Long
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 标题
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        Icons.Default.Monitor,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.tertiary
                    )
                    Text(
                        text = "系统状态",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                }

                // 最后更新时间
                if (lastRefreshTime > 0) {
                    val dateFormat = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }
                    Text(
                        text = dateFormat.format(Date(lastRefreshTime)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f)
                    )
                }
            }

            Divider()

            if (systemStatus != null) {
                // CPU 状态
                StatusItem(
                    icon = Icons.Default.Memory,
                    label = "CPU",
                    value = "${systemStatus.cpu.usage} (${systemStatus.cpu.cores} 核)",
                    subtitle = systemStatus.cpu.model
                )

                // 内存状态
                StatusItem(
                    icon = Icons.Default.Storage,
                    label = "内存",
                    value = systemStatus.memory.usagePercent,
                    subtitle = "已用 ${formatBytes(systemStatus.memory.used)} / 总计 ${formatBytes(systemStatus.memory.total)}"
                )

                // 系统信息
                systemInfo?.let { info ->
                    StatusItem(
                        icon = Icons.Default.Info,
                        label = "系统",
                        value = "${info.os.platform} ${info.os.arch}",
                        subtitle = info.hostname
                    )
                }
            } else {
                Text(
                    text = "暂无数据",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.5f)
                )
            }
        }
    }
}

/**
 * 状态项
 */
@Composable
fun StatusItem(
    icon: ImageVector,
    label: String,
    value: String,
    subtitle: String? = null
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.tertiary,
            modifier = Modifier.size(24.dp)
        )

        Column(modifier = Modifier.weight(1f)) {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f)
                )
                Text(
                    text = value,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            subtitle?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.5f)
                )
            }
        }
    }
}

/**
 * 命令快捷方式区域
 */
@Composable
fun CommandShortcutsSection(
    title: String,
    icon: ImageVector,
    enabled: Boolean,
    commands: List<CommandShortcut>
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 标题
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            Divider()

            // 命令按钮
            commands.forEach { command ->
                CommandButton(
                    command = command,
                    enabled = enabled
                )
            }
        }
    }
}

/**
 * 命令快捷方式按钮
 */
@Composable
fun CommandButton(
    command: CommandShortcut,
    enabled: Boolean
) {
    FilledTonalButton(
        onClick = command.onClick,
        modifier = Modifier.fillMaxWidth(),
        enabled = enabled,
        contentPadding = PaddingValues(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = command.icon,
                contentDescription = null,
                modifier = Modifier.size(24.dp)
            )

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = command.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = command.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = LocalContentColor.current.copy(alpha = 0.7f)
                )
            }

            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null
            )
        }
    }
}

/**
 * 发送通知对话框
 */
@Composable
fun SendNotificationDialog(
    onDismiss: () -> Unit,
    onSend: (title: String, body: String) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("发送通知到 PC") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("标题") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("内容") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSend(title, body) },
                enabled = title.isNotBlank() && body.isNotBlank()
            ) {
                Text("发送")
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
 * 命令快捷方式数据类
 */
data class CommandShortcut(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
    val onClick: () -> Unit
)

/**
 * 格式化字节大小
 */
fun formatBytes(bytes: Long): String {
    val kb = bytes / 1024.0
    val mb = kb / 1024.0
    val gb = mb / 1024.0

    return when {
        gb >= 1 -> String.format("%.2f GB", gb)
        mb >= 1 -> String.format("%.2f MB", mb)
        kb >= 1 -> String.format("%.2f KB", kb)
        else -> "$bytes B"
    }
}
