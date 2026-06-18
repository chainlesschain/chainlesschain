package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * LLM测试对话界面
 *
 * 功能：
 * 1. 快速测试配置的LLM提供商
 * 2. 流式响应显示
 * 3. 项目文件引用功能测试
 * 4. 性能监控（响应时间、Token统计）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LLMTestChatScreen(
    onNavigateBack: () -> Unit,
    provider: LLMProvider = LLMProvider.DOUBAO,
    useLocalEngine: Boolean = false,
    viewModel: LLMTestChatViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 自动滚动到最新消息
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    // 显示错误信息
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // 初始化提供商 / 本机引擎模式
    LaunchedEffect(provider, useLocalEngine) {
        if (useLocalEngine) {
            viewModel.setLocalEngine()
        } else {
            viewModel.setProvider(provider)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        val titleLabel = if (uiState.useLocalEngine) {
                            stringResource(
                                R.string.llm_test_title_local,
                                uiState.localEngineDisplayName.ifEmpty { "Local" }
                            )
                        } else {
                            stringResource(R.string.llm_test_title, uiState.provider.displayName)
                        }
                        Text(
                            text = titleLabel,
                            // 用 titleSmall 比 default titleLarge 小一档，长 displayName (Qwen2.5
                            // 0.5B Instruct (q8)) 不再三行换行 + 被尾部 actions 遮挡
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        )
                        // 本机引擎模式题头已含 displayName，副标题完全重复 — 隐掉
                        if (!uiState.useLocalEngine && uiState.currentModel.isNotEmpty()) {
                            Text(
                                text = uiState.currentModel,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                maxLines = 1,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
                    }
                },
                actions = {
                    // 清空对话
                    IconButton(
                        onClick = { viewModel.clearMessages() },
                        enabled = uiState.messages.isNotEmpty()
                    ) {
                        Icon(Icons.Default.Delete, "清空对话")
                    }

                    // 性能统计
                    IconButton(onClick = { viewModel.toggleStats() }) {
                        Icon(Icons.Default.Analytics, "性能统计")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding() // 键盘弹出时抬起输入框，避免被遮挡
        ) {
            // 性能统计卡片
            if (uiState.showStats) {
                PerformanceStatsCard(
                    stats = uiState.performanceStats,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }

            // 消息列表
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (uiState.messages.isEmpty()) {
                    item {
                        EmptyStateView()
                    }
                }

                items(uiState.messages, key = { it.id }) { message ->
                    MessageBubbleTest(message = message)
                }

                // 正在输入指示器
                if (uiState.isLoading && uiState.streamingContent.isEmpty()) {
                    item {
                        TypingIndicatorTest()
                    }
                }

                // 流式响应
                if (uiState.streamingContent.isNotEmpty()) {
                    item {
                        StreamingMessageBubbleTest(content = uiState.streamingContent)
                    }
                }
            }

            HorizontalDivider()

            // 输入区域
            ChatInputArea(
                onSendMessage = { content, enableRAG ->
                    viewModel.sendMessage(content, enableRAG)
                },
                isLoading = uiState.isLoading,
                ragEnabled = uiState.ragEnabled,
                onToggleRAG = { viewModel.toggleRAG() },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

/**
 * 消息气泡（测试版）
 */
@Composable
fun MessageBubbleTest(message: Message) {
    val isUser = message.role == MessageRole.USER

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Card(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .padding(horizontal = 4.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (isUser)
                    MaterialTheme.colorScheme.primaryContainer
                else
                    MaterialTheme.colorScheme.secondaryContainer
            ),
            shape = RoundedCornerShape(
                topStart = if (isUser) 16.dp else 4.dp,
                topEnd = if (isUser) 4.dp else 16.dp,
                bottomStart = 16.dp,
                bottomEnd = 16.dp
            )
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isUser)
                        MaterialTheme.colorScheme.onPrimaryContainer
                    else
                        MaterialTheme.colorScheme.onSecondaryContainer
                )

                // Token统计
                message.tokenCount?.let { count ->
                    Text(
                        text = "$count tokens",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }
        }
    }
}

/**
 * 流式消息气泡
 */
@Composable
fun StreamingMessageBubbleTest(content: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Card(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .padding(horizontal = 4.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.tertiaryContainer
            )
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                Text(
                    text = content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.weight(1f, fill = false)
                )
                // 流式输入光标动画
                Text(
                    text = "▊",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

/**
 * 输入中指示器
 */
@Composable
fun TypingIndicatorTest() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Card(
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.secondaryContainer
            )
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                repeat(3) { index ->
                    val infiniteTransition = androidx.compose.animation.core.rememberInfiniteTransition(
                        label = "typing-dot-$index"
                    )
                    val alpha by infiniteTransition.animateFloat(
                        initialValue = 0.3f,
                        targetValue = 1f,
                        animationSpec = androidx.compose.animation.core.infiniteRepeatable(
                            animation = androidx.compose.animation.core.tween(
                                durationMillis = 400,
                                delayMillis = 200 * index
                            ),
                            repeatMode = androidx.compose.animation.core.RepeatMode.Reverse
                        ),
                        label = "typing-alpha-$index"
                    )

                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(RoundedCornerShape(50))
                            .background(
                                MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = alpha)
                            )
                    )
                }
            }
        }
    }
}

/**
 * 空状态视图
 */
@Composable
fun EmptyStateView() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Icon(
            imageVector = Icons.Default.ChatBubbleOutline,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "开始测试对话",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface
            )

            Text(
                text = "尝试发送消息测试LLM连接",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // 快速测试提示
        Card(
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant
            )
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "💡 测试建议",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )

                Text(
                    text = """
                        • 发送简单问题测试基础对话
                        • 启用RAG测试知识库检索
                        • 观察流式响应和Token统计
                        • 检查响应时间和性能
                    """.trimIndent(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 性能统计卡片
 */
@Composable
fun PerformanceStatsCard(
    stats: PerformanceStats,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceAround
        ) {
            StatItem(
                label = stringResource(R.string.llm_test_response_time),
                value = "${stats.lastResponseTime}ms"
            )
            StatItem(
                label = stringResource(R.string.llm_test_total_tokens),
                value = "${stats.totalTokens}"
            )
            StatItem(
                label = stringResource(R.string.llm_test_message_count),
                value = "${stats.messageCount}"
            )
            StatItem(
                label = stringResource(R.string.llm_test_success_rate),
                value = "${stats.successRate}%"
            )
        }
    }
}

@Composable
fun StatItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 聊天输入区域
 */
@Composable
fun ChatInputArea(
    onSendMessage: (String, Boolean) -> Unit,
    isLoading: Boolean,
    ragEnabled: Boolean,
    onToggleRAG: () -> Unit,
    modifier: Modifier = Modifier
) {
    var message by remember { mutableStateOf("") }

    Column(modifier = modifier) {
        // RAG开关
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.LibraryBooks,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = if (ragEnabled)
                        MaterialTheme.colorScheme.primary
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "知识库检索 (RAG)",
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            Switch(
                checked = ragEnabled,
                onCheckedChange = { onToggleRAG() }
            )
        }

        HorizontalDivider()

        // 输入框
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = message,
                onValueChange = { message = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text(stringResource(R.string.llm_test_input_hint)) },
                maxLines = 4,
                enabled = !isLoading
            )

            FilledIconButton(
                onClick = {
                    if (message.isNotBlank()) {
                        onSendMessage(message, ragEnabled)
                        message = ""
                    }
                },
                enabled = message.isNotBlank() && !isLoading
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, "发送")
            }
        }
    }
}

/**
 * 性能统计数据类
 */
data class PerformanceStats(
    val lastResponseTime: Long = 0,
    val totalTokens: Int = 0,
    val messageCount: Int = 0,
    val successRate: Int = 100
)
