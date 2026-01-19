package com.chainlesschain.android.feature.ai.presentation

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

/**
 * AI聊天界面
 *
 * 支持流式响应打字机效果
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    conversationId: String,
    onNavigateBack: () -> Unit,
    onSettings: () -> Unit,
    viewModel: ConversationViewModel = hiltViewModel()
) {
    val messages by viewModel.messages.collectAsState()
    val streamingContent by viewModel.streamingContent.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val conversation by viewModel.currentConversation.collectAsState()

    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()

    // 加载对话
    LaunchedEffect(conversationId) {
        viewModel.loadConversation(conversationId)
    }

    // 自动滚动到底部
    LaunchedEffect(messages.size, streamingContent) {
        if (messages.isNotEmpty() || streamingContent.isNotEmpty()) {
            coroutineScope.launch {
                listState.animateScrollToItem(messages.size)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(conversation?.title ?: "对话")
                        Text(
                            text = conversation?.model ?: "",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
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
            // 消息列表
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                state = listState,
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(messages, key = { it.id }) { message ->
                    MessageBubble(message = message)
                }

                // 流式响应中的AI消息
                if (streamingContent.isNotEmpty()) {
                    item {
                        StreamingMessageBubble(content = streamingContent)
                    }
                }

                // 加载指示器
                if (uiState.isSending && streamingContent.isEmpty()) {
                    item {
                        Box(
                            modifier = Modifier.fillMaxWidth(),
                            contentAlignment = Alignment.CenterStart
                        ) {
                            TypingIndicator()
                        }
                    }
                }
            }

            Divider()

            // 输入框
            ChatInput(
                value = inputText,
                onValueChange = { inputText = it },
                onSend = {
                    if (inputText.isNotBlank()) {
                        viewModel.sendMessage(inputText, enableRAG = true)
                        inputText = ""
                    }
                },
                enabled = !uiState.isSending
            )
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
    }
}

/**
 * 消息气泡
 */
@Composable
fun MessageBubble(message: Message) {
    val isUser = message.role == MessageRole.USER

    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = if (isUser) Alignment.CenterEnd else Alignment.CenterStart
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isUser) 16.dp else 4.dp,
                bottomEnd = if (isUser) 4.dp else 16.dp
            ),
            color = if (isUser) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            },
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp)
            ) {
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isUser) {
                        MaterialTheme.colorScheme.onPrimary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = formatTime(message.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isUser) {
                        MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                    }
                )
            }
        }
    }
}

/**
 * 流式响应消息气泡（打字机效果）
 */
@Composable
fun StreamingMessageBubble(content: String) {
    // 光标闪烁动画
    val infiniteTransition = rememberInfiniteTransition(label = "cursor")
    val cursorAlpha by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(500, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "cursor_alpha"
    )

    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.CenterStart
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = 4.dp,
                bottomEnd = 16.dp
            ),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                Text(
                    text = content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace
                )

                // 闪烁光标
                Text(
                    text = "▋",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.alpha(cursorAlpha)
                )
            }
        }
    }
}

/**
 * 输入中指示器（三个跳动的点）
 */
@Composable
fun TypingIndicator() {
    val dotSize = 8.dp
    val dotSpacing = 4.dp

    Row(
        horizontalArrangement = Arrangement.spacedBy(dotSpacing),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(12.dp)
    ) {
        repeat(3) { index ->
            val infiniteTransition = rememberInfiniteTransition(label = "dot_$index")
            val offsetY by infiniteTransition.animateFloat(
                initialValue = 0f,
                targetValue = -10f,
                animationSpec = infiniteRepeatable(
                    animation = tween(600, easing = FastOutSlowInEasing, delayMillis = index * 200),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "dot_offset_$index"
            )

            Box(
                modifier = Modifier
                    .size(dotSize)
                    .offset(y = offsetY.dp)
                    .background(
                        color = MaterialTheme.colorScheme.primary,
                        shape = MaterialTheme.shapes.small
                    )
            )
        }
    }
}

/**
 * 聊天输入框
 */
@Composable
fun ChatInput(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    enabled: Boolean = true
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.weight(1f),
            placeholder = { Text("输入消息...") },
            enabled = enabled,
            maxLines = 4
        )

        FilledIconButton(
            onClick = onSend,
            enabled = enabled && value.isNotBlank()
        ) {
            Icon(Icons.Default.Send, contentDescription = "发送")
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
