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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.R
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
    defaultPeerId: String? = null,
    defaultDid: String? = null,
    onNavigateToAIChat: () -> Unit = {},
    onNavigateToRAGSearch: () -> Unit = {},
    onNavigateToAgentControl: () -> Unit = {},
    onNavigateToScreenshot: () -> Unit = {},
    onNavigateToSystemMonitor: () -> Unit = {},
    onNavigateToCommandHistory: () -> Unit = {},
    onNavigateToRemoteDesktop: () -> Unit = {},
    onNavigateToFileTransfer: (String) -> Unit = {},
    onNavigateToClipboardSync: () -> Unit = {},
    onNavigateToNotificationCenter: () -> Unit = {},
    onNavigateToWorkflow: () -> Unit = {},
    onNavigateToConnectionStatus: () -> Unit = {},
    // Phase 17A: New navigation callbacks
    onNavigateToPowerControl: () -> Unit = {},
    onNavigateToProcessManager: () -> Unit = {},
    onNavigateToMediaControl: () -> Unit = {},
    onNavigateToInputControl: () -> Unit = {},
    onNavigateToStorageInfo: () -> Unit = {},
    onNavigateToNetworkInfo: () -> Unit = {},
    onNavigateToApplicationManager: () -> Unit = {},
    onNavigateToSecurityInfo: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val connectedPeer by viewModel.connectedPeer.collectAsState()

    val context = LocalContext.current
    var showNotificationDialog by remember { mutableStateOf(false) }

    // Auto-connect when navigating from DeviceScanScreen with valid peerId
    LaunchedEffect(defaultPeerId) {
        timber.log.Timber.i("========================================")
        timber.log.Timber.i("[RemoteControl] LaunchedEffect 触发")
        timber.log.Timber.i("[RemoteControl] defaultPeerId: '$defaultPeerId'")
        timber.log.Timber.i("[RemoteControl] defaultDid: '$defaultDid'")
        timber.log.Timber.i("[RemoteControl] connectionState: $connectionState")
        timber.log.Timber.i("========================================")

        val peerId = defaultPeerId?.trim().orEmpty()
        if (peerId.isNotBlank() && (connectionState == ConnectionState.DISCONNECTED || connectionState == ConnectionState.ERROR)) {
            val did = defaultDid?.trim().takeUnless { it.isNullOrBlank() } ?: "did:key:$peerId"
            timber.log.Timber.i("[RemoteControl] ✓ 条件满足，开始自动连接")
            timber.log.Timber.i("[RemoteControl] peerId=$peerId, did=$did")
            viewModel.connectToPC(peerId, did)
        } else {
            timber.log.Timber.w("[RemoteControl] ✗ 条件不满足，不自动连接")
            timber.log.Timber.w("[RemoteControl]   peerId.isNotBlank(): ${peerId.isNotBlank()}")
            timber.log.Timber.w("[RemoteControl]   connectionState == DISCONNECTED: ${connectionState == ConnectionState.DISCONNECTED}")
            timber.log.Timber.w("[RemoteControl]   connectionState == ERROR: ${connectionState == ConnectionState.ERROR}")
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.remote_title)) },
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
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.common_refresh))
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
                        val peerId = defaultPeerId?.trim().orEmpty()
                        if (peerId.isBlank()) {
                            viewModel.setError(context.getString(R.string.remote_please_select_device))
                            return@DeviceConnectionPanel
                        }
                        val did = defaultDid?.trim().takeUnless { it.isNullOrBlank() } ?: "did:key:$peerId"
                        viewModel.connectToPC(
                            pcPeerId = peerId,
                            pcDID = did
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

            item {
                RecentActionsPanel(
                    actions = uiState.recentActions
                )
            }

            // 3. AI 命令快捷入口
            item {
                CommandShortcutsSection(
                    title = stringResource(R.string.remote_section_ai_commands),
                    icon = Icons.Default.Psychology,
                    enabled = connectionState == ConnectionState.CONNECTED,
                    commands = listOf(
                        CommandShortcut(
                            title = stringResource(R.string.remote_ai_chat),
                            subtitle = stringResource(R.string.remote_ai_chat_desc),
                            icon = Icons.Default.Chat,
                            onClick = onNavigateToAIChat
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_rag_search),
                            subtitle = stringResource(R.string.remote_rag_search_desc),
                            icon = Icons.Default.Search,
                            onClick = onNavigateToRAGSearch
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_agent_control),
                            subtitle = stringResource(R.string.remote_agent_control_desc),
                            icon = Icons.Default.SmartToy,
                            onClick = onNavigateToAgentControl
                        )
                    )
                )
            }

            // 4. 系统命令快捷入口
            item {
                CommandShortcutsSection(
                    title = stringResource(R.string.remote_section_system_commands),
                    icon = Icons.Default.Computer,
                    enabled = connectionState == ConnectionState.CONNECTED,
                    commands = listOf(
                        CommandShortcut(
                            title = stringResource(R.string.remote_system_monitor),
                            subtitle = stringResource(R.string.remote_system_monitor_desc),
                            icon = Icons.Default.Monitor,
                            onClick = onNavigateToSystemMonitor
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_desktop),
                            subtitle = stringResource(R.string.remote_desktop_desc),
                            icon = Icons.Default.DesktopWindows,
                            onClick = onNavigateToRemoteDesktop
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_file_transfer),
                            subtitle = stringResource(R.string.remote_file_transfer_desc),
                            icon = Icons.Default.Folder,
                            onClick = {
                                val did = connectedPeer?.did
                                    ?: defaultDid?.trim().orEmpty()
                                if (did.isBlank()) {
                                    viewModel.setError(context.getString(R.string.remote_file_transfer_connect_first))
                                } else {
                                    onNavigateToFileTransfer(did)
                                }
                            }
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_screenshot),
                            subtitle = stringResource(R.string.remote_screenshot_desc),
                            icon = Icons.Default.Screenshot,
                            onClick = onNavigateToScreenshot
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_send_notification),
                            subtitle = stringResource(R.string.remote_send_notification_desc),
                            icon = Icons.Default.Notifications,
                            onClick = { showNotificationDialog = true }
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_command_history),
                            subtitle = stringResource(R.string.remote_command_history_desc),
                            icon = Icons.Default.History,
                            onClick = onNavigateToCommandHistory
                        )
                    )
                )
            }

            // 5. 同步与工作流
            item {
                CommandShortcutsSection(
                    title = stringResource(R.string.remote_section_sync_workflow),
                    icon = Icons.Default.Sync,
                    enabled = connectionState == ConnectionState.CONNECTED,
                    commands = listOf(
                        CommandShortcut(
                            title = stringResource(R.string.remote_clipboard_sync),
                            subtitle = stringResource(R.string.remote_clipboard_sync_desc),
                            icon = Icons.Default.ContentPaste,
                            onClick = onNavigateToClipboardSync
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_notification_center),
                            subtitle = stringResource(R.string.remote_notification_center_desc),
                            icon = Icons.Default.NotificationsActive,
                            onClick = onNavigateToNotificationCenter
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_workflow_automation),
                            subtitle = stringResource(R.string.remote_workflow_automation_desc),
                            icon = Icons.Default.PlayCircle,
                            onClick = onNavigateToWorkflow
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_connection_status),
                            subtitle = stringResource(R.string.remote_connection_status_desc),
                            icon = Icons.Default.SignalCellularAlt,
                            onClick = onNavigateToConnectionStatus
                        )
                    )
                )
            }

            // 6. 设备控制 (Phase 17A)
            item {
                CommandShortcutsSection(
                    title = stringResource(R.string.remote_section_device_control),
                    icon = Icons.Default.SettingsRemote,
                    enabled = connectionState == ConnectionState.CONNECTED,
                    commands = listOf(
                        CommandShortcut(
                            title = stringResource(R.string.remote_power_control),
                            subtitle = stringResource(R.string.remote_power_control_desc),
                            icon = Icons.Default.PowerSettingsNew,
                            onClick = onNavigateToPowerControl
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_process_management),
                            subtitle = stringResource(R.string.remote_process_management_desc),
                            icon = Icons.Default.Memory,
                            onClick = onNavigateToProcessManager
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_media_control),
                            subtitle = stringResource(R.string.remote_media_control_desc),
                            icon = Icons.Default.VolumeUp,
                            onClick = onNavigateToMediaControl
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_input_control),
                            subtitle = stringResource(R.string.remote_input_control_desc),
                            icon = Icons.Default.Keyboard,
                            onClick = onNavigateToInputControl
                        )
                    )
                )
            }

            // 7. 系统信息 (Phase 17A)
            item {
                CommandShortcutsSection(
                    title = stringResource(R.string.remote_section_system_info),
                    icon = Icons.Default.Info,
                    enabled = connectionState == ConnectionState.CONNECTED,
                    commands = listOf(
                        CommandShortcut(
                            title = stringResource(R.string.remote_storage_info),
                            subtitle = stringResource(R.string.remote_storage_info_desc),
                            icon = Icons.Default.Storage,
                            onClick = onNavigateToStorageInfo
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_network_info),
                            subtitle = stringResource(R.string.remote_network_info_desc),
                            icon = Icons.Default.Wifi,
                            onClick = onNavigateToNetworkInfo
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_app_management),
                            subtitle = stringResource(R.string.remote_app_management_desc),
                            icon = Icons.Default.Apps,
                            onClick = onNavigateToApplicationManager
                        ),
                        CommandShortcut(
                            title = stringResource(R.string.remote_security_info),
                            subtitle = stringResource(R.string.remote_security_info_desc),
                            icon = Icons.Default.Security,
                            onClick = onNavigateToSecurityInfo
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
                        Text(stringResource(R.string.common_close))
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
                    text = stringResource(R.string.remote_pc_connection),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            HorizontalDivider()

            // 连接状态指示
            ConnectionStatusIndicator(connectionState, connectedPeer)

            // 连接/断开按钮
            Button(
                onClick = {
                    when (connectionState) {
                        ConnectionState.CONNECTED -> onDisconnect()
                        ConnectionState.DISCONNECTED, ConnectionState.ERROR -> onConnect()
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
                        ConnectionState.DISCONNECTED -> stringResource(R.string.remote_connect_to_pc)
                        ConnectionState.CONNECTING -> stringResource(R.string.remote_connecting)
                        ConnectionState.RECONNECTING -> stringResource(R.string.remote_reconnecting)
                        ConnectionState.CONNECTED -> stringResource(R.string.remote_disconnect)
                        ConnectionState.ERROR -> stringResource(R.string.remote_reconnect)
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
                    ConnectionState.DISCONNECTED -> stringResource(R.string.remote_not_connected)
                    ConnectionState.CONNECTING -> stringResource(R.string.remote_connecting)
                    ConnectionState.RECONNECTING -> stringResource(R.string.remote_reconnecting)
                    ConnectionState.CONNECTED -> connectedPeer?.peerId ?: stringResource(R.string.remote_status_connected)
                    ConnectionState.ERROR -> stringResource(R.string.remote_status_error)
                },
                style = MaterialTheme.typography.bodyLarge
            )

            if (connectionState == ConnectionState.CONNECTED && connectedPeer != null) {
                val dateFormat = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }
                Text(
                    text = stringResource(R.string.remote_connected_at, dateFormat.format(Date(connectedPeer.connectedAt))),
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
                        ConnectionState.RECONNECTING -> Color(0xFFFF9800)
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
                        text = stringResource(R.string.remote_system_status),
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

            HorizontalDivider()

            if (systemStatus != null) {
                // CPU 状态
                StatusItem(
                    icon = Icons.Default.Memory,
                    label = stringResource(R.string.remote_cpu),
                    value = stringResource(R.string.remote_cpu_usage, systemStatus.cpu.usage, systemStatus.cpu.cores),
                    subtitle = systemStatus.cpu.model
                )

                // 内存状态
                StatusItem(
                    icon = Icons.Default.Storage,
                    label = stringResource(R.string.remote_memory),
                    value = systemStatus.memory.usagePercent,
                    subtitle = stringResource(R.string.remote_memory_usage, formatBytes(systemStatus.memory.used), formatBytes(systemStatus.memory.total))
                )

                // 系统信息
                systemInfo?.let { info ->
                    StatusItem(
                        icon = Icons.Default.Info,
                        label = stringResource(R.string.remote_system),
                        value = "${info.os.platform} ${info.os.arch}",
                        subtitle = info.hostname
                    )
                }
            } else {
                Text(
                    text = stringResource(R.string.remote_no_data),
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

            HorizontalDivider()

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
        title = { Text(stringResource(R.string.remote_send_notification_to_pc)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text(stringResource(R.string.remote_notification_title)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text(stringResource(R.string.remote_notification_content)) },
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
                Text(stringResource(R.string.common_send))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.common_cancel))
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

@Composable
fun RecentActionsPanel(actions: List<String>) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(Icons.Default.History, contentDescription = null)
                Text(stringResource(R.string.remote_recent_actions), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            HorizontalDivider()
            if (actions.isEmpty()) {
                Text(stringResource(R.string.remote_no_action_history), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                actions.forEach { action ->
                    Text("• $action", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
