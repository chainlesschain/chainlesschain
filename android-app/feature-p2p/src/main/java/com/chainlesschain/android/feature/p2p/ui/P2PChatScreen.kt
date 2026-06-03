package com.chainlesschain.android.feature.p2p.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.MessageSendStatus
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.feature.p2p.R
import com.chainlesschain.android.feature.p2p.viewmodel.ConnectionStatus
import com.chainlesschain.android.feature.p2p.viewmodel.FileTransferViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.P2PChatViewModel
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

/**
 * P2P聊天界面
 *
 * 端到端加密的设备间聊天
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun P2PChatScreen(
    deviceId: String,
    deviceName: String,
    onNavigateBack: () -> Unit,
    onVerifyDevice: () -> Unit,
    onNavigateToFileTransfers: () -> Unit = {},
    viewModel: P2PChatViewModel = hiltViewModel(),
    fileTransferViewModel: FileTransferViewModel = hiltViewModel()
) {
    val messages by viewModel.messages.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val isVerified by viewModel.isDeviceVerified.collectAsState()
    val connectionStatus by viewModel.connectionStatus.collectAsState()

    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()

    // File picker launcher
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri?.let { fileTransferViewModel.sendFile(it, deviceId) }
    }

    // 加载聊天历史
    LaunchedEffect(deviceId) {
        viewModel.loadChat(deviceId)
        fileTransferViewModel.loadTransfers(deviceId)
    }

    // 自动滚动到底部
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            coroutineScope.launch {
                listState.animateScrollToItem(messages.size - 1)
            }
        }
    }

    // 标记消息为已读
    DisposableEffect(deviceId) {
        onDispose {
            viewModel.markAsRead()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(deviceName)
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // 连接状态指示器
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .background(
                                        color = when (connectionStatus) {
                                            ConnectionStatus.CONNECTED -> MaterialTheme.colorScheme.primary
                                            ConnectionStatus.CONNECTING -> MaterialTheme.colorScheme.tertiary
                                            ConnectionStatus.DISCONNECTED -> MaterialTheme.colorScheme.error
                                        },
                                        shape = MaterialTheme.shapes.small
                                    )
                            )
                            Text(
                                text = when (connectionStatus) {
                                    ConnectionStatus.CONNECTED -> stringResource(R.string.status_connected)
                                    ConnectionStatus.CONNECTING -> stringResource(R.string.status_connecting)
                                    ConnectionStatus.DISCONNECTED -> stringResource(R.string.status_disconnected)
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            if (isVerified) {
                                Icon(
                                    imageVector = Icons.Default.Verified,
                                    contentDescription = stringResource(R.string.verified),
                                    modifier = Modifier.size(16.dp),
                                    tint = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    // 重连按钮
                    if (connectionStatus == ConnectionStatus.DISCONNECTED) {
                        IconButton(onClick = { viewModel.reconnect() }) {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = stringResource(R.string.reconnect),
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                    // 验证按钮
                    if (!isVerified) {
                        IconButton(onClick = onVerifyDevice) {
                            Icon(
                                Icons.Default.Security,
                                contentDescription = stringResource(R.string.verify_device),
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                    // 更多选项
                    var showMenu by remember { mutableStateOf(false) }
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.more))
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.retry_failed_messages)) },
                            onClick = {
                                viewModel.retryFailedMessages()
                                showMenu = false
                            },
                            leadingIcon = {
                                Icon(Icons.Default.Replay, contentDescription = null)
                            }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.clear_chat_history)) },
                            onClick = {
                                viewModel.deleteAllMessages()
                                showMenu = false
                            },
                            leadingIcon = {
                                Icon(Icons.Default.DeleteForever, contentDescription = null)
                            }
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
            // 未验证警告
            if (!isVerified) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = stringResource(R.string.device_not_verified_warning),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Spacer(modifier = Modifier.weight(1f))
                        TextButton(onClick = onVerifyDevice) {
                            Text(stringResource(R.string.verify))
                        }
                    }
                }
            }

            // 加载指示器
            if (uiState.isLoading) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // 消息列表
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                state = listState,
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (messages.isEmpty() && !uiState.isLoading) {
                    item {
                        Box(
                            modifier = Modifier.fillParentMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Chat,
                                    contentDescription = null,
                                    modifier = Modifier.size(64.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                Text(
                                    text = stringResource(R.string.start_secure_chat),
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = stringResource(R.string.messages_e2ee),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                                )
                            }
                        }
                    }
                }

                items(messages, key = { it.id }) { message ->
                    P2PMessageBubble(
                        message = message,
                        isFromMe = message.isOutgoing
                    )
                }

                // 发送中指示器
                if (uiState.isSending) {
                    item {
                        Box(
                            modifier = Modifier.fillMaxWidth(),
                            contentAlignment = Alignment.CenterEnd
                        ) {
                            SendingIndicator()
                        }
                    }
                }
            }

            HorizontalDivider()

            // 输入框
            P2PChatInput(
                value = inputText,
                onValueChange = { inputText = it },
                onSend = {
                    if (inputText.isNotBlank()) {
                        viewModel.sendMessage(deviceId, inputText)
                        inputText = ""
                    }
                },
                onAttachment = {
                    filePickerLauncher.launch(arrayOf("*/*"))
                },
                enabled = !uiState.isSending && connectionStatus == ConnectionStatus.CONNECTED,
                showAttachment = true
            )
        }

        // 错误提示
        uiState.error?.let { error ->
            Snackbar(
                modifier = Modifier.padding(16.dp),
                action = {
                    TextButton(onClick = { viewModel.clearError() }) {
                        Text(stringResource(R.string.close))
                    }
                }
            ) {
                Text(error)
            }
        }
    }
}

/**
 * P2P消息气泡
 */
@Composable
fun P2PMessageBubble(
    message: P2PMessageEntity,
    isFromMe: Boolean
) {
    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = if (isFromMe) Alignment.CenterEnd else Alignment.CenterStart
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isFromMe) 16.dp else 4.dp,
                bottomEnd = if (isFromMe) 4.dp else 16.dp
            ),
            color = if (isFromMe) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp)
            ) {
                // 消息内容
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isFromMe) {
                        MaterialTheme.colorScheme.onPrimary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = formatTime(message.timestamp),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (isFromMe) {
                            MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                        }
                    )

                    // 发送状态图标
                    if (isFromMe) {
                        val (icon, description) = when (message.sendStatus) {
                            MessageSendStatus.PENDING -> Icons.Default.Schedule to stringResource(R.string.status_sending)
                            MessageSendStatus.SENT -> Icons.Default.Done to stringResource(R.string.status_sent)
                            MessageSendStatus.DELIVERED -> Icons.Default.DoneAll to stringResource(R.string.status_delivered)
                            MessageSendStatus.FAILED -> Icons.Default.Error to stringResource(R.string.status_send_failed)
                            else -> Icons.Default.Done to stringResource(R.string.status_sent)
                        }
                        Icon(
                            imageVector = icon,
                            contentDescription = description,
                            modifier = Modifier.size(14.dp),
                            tint = if (message.sendStatus == MessageSendStatus.FAILED) {
                                MaterialTheme.colorScheme.error
                            } else if (isFromMe) {
                                MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                            }
                        )
                    }

                    // E2EE加密图标
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = stringResource(R.string.e2ee_encrypted),
                        modifier = Modifier.size(12.dp),
                        tint = if (isFromMe) {
                            MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.5f)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        }
                    )
                }
            }
        }
    }
}

/**
 * 发送中指示器
 */
@Composable
fun SendingIndicator() {
    Surface(
        shape = RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp),
        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
        modifier = Modifier.widthIn(max = 100.dp)
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = stringResource(R.string.sending),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimary
            )
            CircularProgressIndicator(
                modifier = Modifier.size(12.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary
            )
        }
    }
}

/**
 * P2P聊天输入框
 */
@Composable
fun P2PChatInput(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onAttachment: () -> Unit = {},
    enabled: Boolean = true,
    showAttachment: Boolean = true
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Attachment button
        if (showAttachment) {
            IconButton(
                onClick = onAttachment,
                enabled = enabled
            ) {
                Icon(
                    Icons.Default.AttachFile,
                    contentDescription = stringResource(R.string.attachment),
                    tint = if (enabled) MaterialTheme.colorScheme.onSurfaceVariant
                           else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
            }
        }

        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.weight(1f),
            placeholder = {
                Text(
                    if (enabled) stringResource(R.string.input_message_placeholder) else stringResource(R.string.connect_first_placeholder)
                )
            },
            enabled = enabled,
            maxLines = 4,
            trailingIcon = {
                Icon(
                    Icons.Default.Lock,
                    contentDescription = stringResource(R.string.encrypted),
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        )

        FilledIconButton(
            onClick = onSend,
            enabled = enabled && value.isNotBlank()
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.send))
        }
    }
}

/**
 * 格式化时间（时:分）
 */
private fun formatTime(timestamp: Long): String {
    val sdf = SimpleDateFormat("HH:mm", Locale.getDefault())
    return sdf.format(Date(timestamp))
}
