@file:Suppress("FunctionNaming", "LongMethod", "CyclomaticComplexMethod")

package com.chainlesschain.android.presentation.screens.cc

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.tools.ChatStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CcChatScreen(
    initialProvider: LLMProvider? = null,
    viewModel: CcChatViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val listState = rememberLazyListState()

    LaunchedEffect(initialProvider) {
        initialProvider?.let { viewModel.setProvider(it) }
    }

    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.lastIndex)
        }
    }

    LaunchedEffect(uiState.error) {
        val err = uiState.error
        if (!err.isNullOrEmpty()) {
            snackbarHostState.showSnackbar(err)
            viewModel.clearError()
        }
    }

    Scaffold(
        topBar = {
            CcChatTopBar(
                provider = uiState.provider,
                modelName = uiState.modelName,
                toolAvailable = uiState.toolAvailable,
                onClear = viewModel::clear,
            )
        },
        bottomBar = {
            Column(modifier = Modifier.imePadding()) { // 键盘弹出时抬起输入框，避免被遮挡
                StatusStrip(status = uiState.status)
                CcChatInputBar(
                    enabled = uiState.inputEnabled,
                    onSend = viewModel::sendMessage,
                    onCancel = viewModel::cancel,
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { inner ->
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().padding(inner).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
        ) {
            items(uiState.messages, key = { it.id }) { msg ->
                when (msg) {
                    is CcChatMessage.User -> UserBubble(msg)
                    is CcChatMessage.Assistant -> AssistantBubble(msg)
                    is CcChatMessage.ToolCall -> ToolCallCard(
                        msg = msg,
                        onToggleExpand = { viewModel.toggleToolResultExpansion(msg.toolCallId) },
                        onCancel = viewModel::cancel,
                    )
                    is CcChatMessage.System -> SystemNote(msg.text)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CcChatTopBar(
    provider: LLMProvider,
    modelName: String,
    toolAvailable: Boolean,
    onClear: () -> Unit,
) {
    TopAppBar(
        title = {
            Column {
                Text("cc Chat", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = "${provider.displayName}  ·  $modelName",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        actions = {
            ToolAvailabilityChip(toolAvailable)
            Spacer(Modifier.size(8.dp))
            IconButton(onClick = onClear) {
                Icon(Icons.Filled.DeleteSweep, contentDescription = "清空")
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    )
}

@Composable
private fun ToolAvailabilityChip(available: Boolean) {
    AssistChip(
        onClick = {},
        enabled = false,
        label = {
            Text(
                if (available) "🔧 工具可用" else "⚠ 工具不可用",
                style = MaterialTheme.typography.labelSmall,
            )
        },
        colors = AssistChipDefaults.assistChipColors(
            disabledContainerColor = if (available) Color(0xFFC8E6C9) else Color(0xFFFFE0B2),
            disabledLabelColor = if (available) Color(0xFF1B5E20) else Color(0xFFE65100),
        ),
    )
}

@Composable
private fun StatusStrip(status: ChatStatus) {
    val (label, showProgress) = when (status) {
        ChatStatus.THINKING -> "正在思考..." to true
        ChatStatus.TOOL_CALLED -> "准备调用工具..." to true
        ChatStatus.TOOL_RUNNING -> "执行 cc 命令..." to true
        ChatStatus.TOOL_DONE -> "工具执行完毕，处理结果..." to true
        ChatStatus.FINALIZING -> "整理结果..." to true
        ChatStatus.COMPLETE -> "" to false
        ChatStatus.FAILED -> "❌ 失败" to false
        ChatStatus.CANCELLED -> "已取消" to false
    }
    if (label.isEmpty() && !showProgress) return
    Column(Modifier.fillMaxWidth()) {
        if (showProgress) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
        if (label.isNotEmpty()) {
            Text(
                text = label,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun UserBubble(msg: CcChatMessage.User) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Surface(
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp, bottomStart = 12.dp, bottomEnd = 2.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Text(
                text = msg.text,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun AssistantBubble(msg: CcChatMessage.Assistant) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            shape = RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp, bottomStart = 2.dp, bottomEnd = 12.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            val displayText = if (msg.isStreaming) "${msg.text}▍" else msg.text
            Text(
                text = displayText,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun SystemNote(text: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        Text(
            text = text,
            modifier = Modifier
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ToolCallCard(
    msg: CcChatMessage.ToolCall,
    onToggleExpand: () -> Unit,
    onCancel: () -> Unit,
) {
    val isPending = msg.state == CcChatMessage.ToolCall.State.PENDING
    val statusColor = when {
        isPending -> MaterialTheme.colorScheme.tertiaryContainer
        msg.exitCode == 0 -> Color(0xFFC8E6C9)
        else -> Color(0xFFFFCDD2)
    }
    Surface(
        color = statusColor,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = msg.invocationLine,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Medium,
                    ),
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (isPending) {
                    OutlinedButton(onClick = onCancel) {
                        Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.size(4.dp))
                        Text("取消", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            Spacer(Modifier.size(6.dp))
            if (isPending) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.size(4.dp))
                Text("执行中...",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "exitCode=${msg.exitCode ?: "?"}",
                        style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    )
                    Spacer(Modifier.size(8.dp))
                    msg.durationMs?.let {
                        Text(
                            text = "${it}ms",
                            style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    if (!msg.resultContent.isNullOrEmpty()) {
                        IconButton(onClick = onToggleExpand, modifier = Modifier.size(28.dp)) {
                            Icon(
                                imageVector = if (msg.expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                                contentDescription = if (msg.expanded) "折叠" else "展开",
                            )
                        }
                    }
                }
                msg.resultContent?.let { result ->
                    Spacer(Modifier.size(6.dp))
                    val preview = if (msg.expanded) result else result.lineSequence().take(6).joinToString("\n")
                    Surface(
                        color = MaterialTheme.colorScheme.surface,
                        shape = RoundedCornerShape(6.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = preview,
                            modifier = Modifier.padding(8.dp),
                            style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                        )
                    }
                    if (!msg.expanded && result.lineSequence().count() > 6) {
                        Text(
                            text = "... 共 ${result.lineSequence().count()} 行，点击展开",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CcChatInputBar(
    enabled: Boolean,
    onSend: (String) -> Unit,
    onCancel: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    HorizontalDivider()
    Row(
        modifier = Modifier.fillMaxWidth().padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.weight(1f),
            enabled = enabled,
            placeholder = { Text("用自然语言提问，例如：列下我最近的笔记") },
            maxLines = 4,
        )
        Spacer(Modifier.size(8.dp))
        if (enabled) {
            Button(
                onClick = {
                    if (text.isNotBlank()) { onSend(text.trim()); text = "" }
                },
                enabled = text.isNotBlank(),
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "发送")
            }
        } else {
            OutlinedButton(onClick = onCancel) {
                Icon(Icons.Filled.Close, contentDescription = "取消")
            }
        }
    }
}
