package com.chainlesschain.android.presentation.screens

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.ui.AttachedFileData
import com.chainlesschain.android.feature.project.ui.FilePickerDialog
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * AI对话增强UI
 * 参考: iOS AIChatView.swift 和现代聊天应用设计
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EnhancedAIChatScreen(
    conversationId: String,
    conversationTitle: String = "AI对话",
    onNavigateBack: () -> Unit = {}
) {
    var inputText by remember { mutableStateOf("") }
    var isTyping by remember { mutableStateOf(false) }
    var showFilePicker by remember { mutableStateOf(false) }
    var pendingAttachments by remember { mutableStateOf<List<AttachedFileData>>(emptyList()) }
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val keyboardController = LocalSoftwareKeyboardController.current

    // 模拟对话消息
    val messages = remember {
        mutableStateListOf(
            ChatMessage(
                id = "1",
                content = "你好！我是你的AI助手，有什么可以帮助你的吗？",
                isUser = false,
                timestamp = LocalDateTime.now().minusMinutes(5)
            ),
            ChatMessage(
                id = "2",
                content = "帮我分析一下这个项目的架构",
                isUser = true,
                timestamp = LocalDateTime.now().minusMinutes(4)
            ),
            ChatMessage(
                id = "3",
                content = "我已经分析了你的项目架构，这是一个典型的MVVM架构设计...",
                isUser = false,
                timestamp = LocalDateTime.now().minusMinutes(3),
                codeBlock = """
                    class ViewModel {
                        private val repository = Repository()
                        val data = LiveData<List<Item>>()
                    }
                """.trimIndent()
            )
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(conversationTitle)
                        if (isTyping) {
                            Text(
                                text = "AI正在输入...",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { /* TODO: 清空对话 */ }) {
                        Icon(Icons.Default.DeleteSweep, contentDescription = "清空")
                    }
                    IconButton(onClick = { /* TODO: 设置 */ }) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
                    }
                }
            )
        },
        bottomBar = {
            Column {
                // 附件预览区
                if (pendingAttachments.isNotEmpty()) {
                    AttachmentPreviewBar(
                        attachments = pendingAttachments,
                        onRemoveAttachment = { fileId ->
                            pendingAttachments = pendingAttachments.filter { it.id != fileId }
                        }
                    )
                }

                // 输入栏
                ChatInputBar(
                    inputText = inputText,
                    onInputChange = { inputText = it },
                    onAttachFile = {
                        showFilePicker = true
                    },
                    onSend = {
                        if (inputText.isNotBlank() || pendingAttachments.isNotEmpty()) {
                            // 添加用户消息（包含附件）
                            messages.add(
                                ChatMessage(
                                    id = System.currentTimeMillis().toString(),
                                    content = inputText.ifBlank { "[附件]" },
                                    isUser = true,
                                    timestamp = LocalDateTime.now(),
                                    attachedFiles = pendingAttachments.toList()
                                )
                            )

                            // 清空输入和附件
                            inputText = ""
                            pendingAttachments = emptyList()
                            keyboardController?.hide()

                            // 模拟AI响应
                            isTyping = true
                            coroutineScope.launch {
                                kotlinx.coroutines.delay(1500)
                                messages.add(
                                    ChatMessage(
                                        id = System.currentTimeMillis().toString(),
                                        content = "我已经收到了你的文件，正在分析...",
                                        isUser = false,
                                        timestamp = LocalDateTime.now()
                                    )
                                )
                                isTyping = false

                                // 滚动到底部
                                coroutineScope.launch {
                                    listState.animateScrollToItem(messages.size - 1)
                                }
                            }

                            // 滚动到底部
                            coroutineScope.launch {
                                listState.animateScrollToItem(messages.size - 1)
                            }
                        }
                    }
                )
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(messages) { message ->
                    ChatMessageBubble(message)
                }

                // 正在输入指示器
                if (isTyping) {
                    item {
                        TypingIndicator()
                    }
                }
            }

            // 快捷操作按钮
            QuickActionFAB(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp)
                    .padding(bottom = 80.dp)
            )
        }
    }

    // 文件选择对话框
    if (showFilePicker) {
        FilePickerDialog(
            onDismiss = { showFilePicker = false },
            onFilesSelected = { selectedFiles ->
                pendingAttachments = pendingAttachments + selectedFiles
            }
        )
    }
}

/**
 * 聊天消息数据类
 */
data class ChatMessage(
    val id: String,
    val content: String,
    val isUser: Boolean,
    val timestamp: LocalDateTime,
    val codeBlock: String? = null,
    val imageUrl: String? = null,
    val attachedFiles: List<AttachedFileData> = emptyList()
)

/**
 * AttachedFileData扩展函数 - 获取可读的文件大小
 */
fun AttachedFileData.getReadableSize(): String {
    val units = arrayOf("B", "KB", "MB", "GB")
    var currentSize = size.toDouble()
    var unitIndex = 0

    while (currentSize >= 1024 && unitIndex < units.size - 1) {
        currentSize /= 1024
        unitIndex++
    }

    return "%.2f %s".format(currentSize, units[unitIndex])
}

/**
 * 聊天消息气泡
 */
@Composable
fun ChatMessageBubble(message: ChatMessage) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.isUser) Arrangement.End else Arrangement.Start
    ) {
        if (!message.isUser) {
            // AI头像
            Surface(
                modifier = Modifier.size(32.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.SmartToy,
                        contentDescription = "AI",
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }

            Spacer(modifier = Modifier.width(8.dp))
        }

        Column(
            modifier = Modifier.widthIn(max = 280.dp),
            horizontalAlignment = if (message.isUser) Alignment.End else Alignment.Start
        ) {
            // 消息气泡
            Surface(
                shape = RoundedCornerShape(
                    topStart = if (message.isUser) 16.dp else 4.dp,
                    topEnd = if (message.isUser) 4.dp else 16.dp,
                    bottomStart = 16.dp,
                    bottomEnd = 16.dp
                ),
                color = if (message.isUser) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                },
                shadowElevation = 1.dp
            ) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // 消息内容
                    Text(
                        text = message.content,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (message.isUser) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )

                    // 代码块
                    message.codeBlock?.let { code ->
                        CodeBlock(code)
                    }

                    // TODO: 附件 - AttachmentBubble needs to be implemented
                    // if (message.attachedFiles.isNotEmpty()) {
                    //     Column(
                    //         verticalArrangement = Arrangement.spacedBy(4.dp)
                    //     ) {
                    //         message.attachedFiles.forEach { file ->
                    //             AttachmentBubble(
                    //                 file = file,
                    //                 isUserMessage = message.isUser
                    //             )
                    //         }
                    //     }
                    // }
                }
            }

            // 时间戳
            Text(
                text = message.timestamp.format(DateTimeFormatter.ofPattern("HH:mm")),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
            )
        }

        if (message.isUser) {
            Spacer(modifier = Modifier.width(8.dp))

            // 用户头像
            Surface(
                modifier = Modifier.size(32.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.tertiaryContainer
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Person,
                        contentDescription = "用户",
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.onTertiaryContainer
                    )
                }
            }
        }
    }
}

/**
 * 代码块组件
 */
@Composable
fun CodeBlock(code: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFF1E1E1E),
        shape = RoundedCornerShape(8.dp)
    ) {
        Column {
            // 代码块头部
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Kotlin",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.7f)
                )

                IconButton(
                    onClick = { /* TODO: 复制代码 */ },
                    modifier = Modifier.size(20.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ContentCopy,
                        contentDescription = "复制",
                        tint = Color.White.copy(alpha = 0.7f),
                        modifier = Modifier.size(16.dp)
                    )
                }
            }

            Divider(color = Color.White.copy(alpha = 0.1f))

            // 代码内容
            Text(
                text = code,
                modifier = Modifier.padding(12.dp),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                ),
                color = Color(0xFF9CDCFE)
            )
        }
    }
}

/**
 * 输入框
 */
@Composable
fun ChatInputBar(
    inputText: String,
    onInputChange: (String) -> Unit,
    onSend: () -> Unit,
    onAttachFile: () -> Unit = {}
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        tonalElevation = 3.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 附件按钮
            IconButton(
                onClick = onAttachFile,
                modifier = Modifier.size(40.dp)
            ) {
                Icon(Icons.Default.AttachFile, contentDescription = "附件")
            }

            // 输入框
            OutlinedTextField(
                value = inputText,
                onValueChange = onInputChange,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 40.dp, max = 120.dp),
                placeholder = { Text("输入消息...") },
                shape = RoundedCornerShape(20.dp),
                keyboardOptions = KeyboardOptions(
                    imeAction = ImeAction.Send
                ),
                keyboardActions = KeyboardActions(
                    onSend = { onSend() }
                ),
                maxLines = 5
            )

            // 发送按钮
            FloatingActionButton(
                onClick = onSend,
                modifier = Modifier.size(40.dp),
                containerColor = MaterialTheme.colorScheme.primary
            ) {
                Icon(
                    imageVector = Icons.Default.Send,
                    contentDescription = "发送",
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

/**
 * 正在输入指示器
 */
@Composable
fun TypingIndicator() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Surface(
            modifier = Modifier.size(32.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Default.SmartToy,
                    contentDescription = "AI",
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        Spacer(modifier = Modifier.width(8.dp))

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceVariant
        ) {
            Row(
                modifier = Modifier.padding(16.dp, 12.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                repeat(3) { index ->
                    val infiniteTransition = rememberInfiniteTransition(label = "dot-$index")
                    val alpha by infiniteTransition.animateFloat(
                        initialValue = 0.3f,
                        targetValue = 1f,
                        animationSpec = infiniteRepeatable(
                            animation = tween(600),
                            repeatMode = RepeatMode.Reverse,
                            initialStartOffset = StartOffset(index * 200)
                        ),
                        label = "alpha-$index"
                    )

                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = alpha))
                    )
                }
            }
        }
    }
}

/**
 * 快捷操作FAB
 */
@Composable
fun QuickActionFAB(modifier: Modifier = Modifier) {
    var expanded by remember { mutableStateOf(false) }

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically()
        ) {
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                QuickActionButton(
                    icon = Icons.Default.Image,
                    text = "图片",
                    onClick = { /* TODO */ }
                )
                QuickActionButton(
                    icon = Icons.Default.Code,
                    text = "代码",
                    onClick = { /* TODO */ }
                )
                QuickActionButton(
                    icon = Icons.Default.Description,
                    text = "文档",
                    onClick = { /* TODO */ }
                )
            }
        }

        FloatingActionButton(
            onClick = { expanded = !expanded },
            containerColor = MaterialTheme.colorScheme.tertiaryContainer
        ) {
            Icon(
                imageVector = if (expanded) Icons.Default.Close else Icons.Default.Add,
                contentDescription = if (expanded) "关闭" else "打开"
            )
        }
    }
}

@Composable
private fun QuickActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    onClick: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier
                .background(
                    MaterialTheme.colorScheme.surface,
                    RoundedCornerShape(8.dp)
                )
                .padding(8.dp, 4.dp)
        )

        SmallFloatingActionButton(
            onClick = onClick,
            containerColor = MaterialTheme.colorScheme.secondaryContainer
        ) {
            Icon(icon, contentDescription = text)
        }
    }
}

/**
 * 附件预览栏 - 显示待发送的附件
 */
@Composable
fun AttachmentPreviewBar(
    attachments: List<AttachedFileData>,
    onRemoveAttachment: (String) -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        tonalElevation = 2.dp,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "附件 (${attachments.size})",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 附件列表 - 水平滚动
            androidx.compose.foundation.lazy.LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(attachments) { file ->
                    AttachmentPreviewItem(
                        file = file,
                        onRemove = { onRemoveAttachment(file.id) }
                    )
                }
            }
        }
    }
}

/**
 * 附件预览项 - 单个附件卡片（带删除按钮）
 */
@Composable
fun AttachmentPreviewItem(
    file: AttachedFileData,
    onRemove: () -> Unit
) {
    Surface(
        modifier = Modifier
            .width(120.dp)
            .height(100.dp),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Box {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                // 文件图标
                Icon(
                    imageVector = when (file.category.uppercase()) {
                        "IMAGE" -> Icons.Default.Image
                        "VIDEO" -> Icons.Default.VideoLibrary
                        "AUDIO" -> Icons.Default.AudioFile
                        "DOCUMENT" -> Icons.Default.Description
                        else -> Icons.Default.InsertDriveFile
                    },
                    contentDescription = file.category,
                    modifier = Modifier.size(32.dp),
                    tint = MaterialTheme.colorScheme.primary
                )

                Spacer(modifier = Modifier.height(4.dp))

                // 文件名（截断）
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    modifier = Modifier.fillMaxWidth()
                )

                // 文件大小
                Text(
                    text = file.getReadableSize(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 删除按钮
            IconButton(
                onClick = onRemove,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(24.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "移除",
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

/**
 * 附件气泡 - 在消息中显示附件
 */
@Composable
fun AttachmentBubble(
    file: AttachedFileData,
    isUserMessage: Boolean
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = if (isUserMessage) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        } else {
            MaterialTheme.colorScheme.surface.copy(alpha = 0.5f)
        },
        tonalElevation = 0.5.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 文件图标
            Surface(
                modifier = Modifier.size(40.dp),
                shape = RoundedCornerShape(6.dp),
                color = if (isUserMessage) {
                    MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.15f)
                } else {
                    MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                }
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = when (file.category.uppercase()) {
                            "IMAGE" -> Icons.Default.Image
                            "VIDEO" -> Icons.Default.VideoLibrary
                            "AUDIO" -> Icons.Default.AudioFile
                            "DOCUMENT" -> Icons.Default.Description
                            else -> Icons.Default.InsertDriveFile
                        },
                        contentDescription = file.category,
                        modifier = Modifier.size(24.dp),
                        tint = if (isUserMessage) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.primary
                        }
                    )
                }
            }

            // 文件信息
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontWeight = FontWeight.Medium
                    ),
                    color = if (isUserMessage) {
                        MaterialTheme.colorScheme.onPrimary
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    maxLines = 1
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = file.getReadableSize(),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (isUserMessage) {
                            MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )

                    Text(
                        text = "•",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (isUserMessage) {
                            MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.5f)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        }
                    )

                    Text(
                        text = file.category,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (isUserMessage) {
                            MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }
            }

            // 下载/查看图标
            Icon(
                imageVector = Icons.Default.FileDownload,
                contentDescription = "下载",
                modifier = Modifier.size(20.dp),
                tint = if (isUserMessage) {
                    MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                } else {
                    MaterialTheme.colorScheme.primary
                }
            )
        }
    }
}
