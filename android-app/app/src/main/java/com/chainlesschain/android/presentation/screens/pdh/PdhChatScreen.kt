package com.chainlesschain.android.presentation.screens.pdh

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.core.ui.components.MarkdownText
import com.chainlesschain.android.presentation.screens.pdh.PdhChatViewModel.Role

/**
 * Phase 2 (module 101) — the single-input-box PDH Chat. One box to command the
 * on-device agent to collect / query / analyze your personal data.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdhChatScreen(
    onBack: () -> Unit = {},
    viewModel: PdhChatViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Auto-scroll to the newest line (messages + the streaming bubble).
    LaunchedEffect(state.messages.size, state.streamingText) {
        val total = state.messages.size + if (state.streamingText.isNotEmpty()) 1 else 0
        if (total > 0) listState.animateScrollToItem(total - 1)
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("个人数据助手") })
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            state.error?.let { err ->
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = err,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                itemsIndexed(state.messages) { _, msg ->
                    MessageRow(role = msg.role, text = msg.text)
                }
                if (state.streamingText.isNotEmpty()) {
                    item {
                        MessageRow(role = Role.ASSISTANT, text = state.streamingText)
                    }
                }
                if (state.isSending && state.streamingText.isEmpty()) {
                    item {
                        Row(
                            modifier = Modifier.padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                            Text("思考中…", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }

            InputBar(
                value = input,
                enabled = state.ready && !state.isSending,
                onValueChange = { input = it },
                onSend = {
                    if (input.isNotBlank()) {
                        viewModel.send(input)
                        input = ""
                    }
                },
            )
        }
    }
}

@Composable
private fun MessageRow(role: Role, text: String) {
    val isUser = role == Role.USER
    val align = if (isUser) Alignment.CenterEnd else Alignment.CenterStart
    val bubbleColor = when (role) {
        Role.USER -> MaterialTheme.colorScheme.primaryContainer
        Role.ASSISTANT -> MaterialTheme.colorScheme.surfaceVariant
        Role.TOOL -> MaterialTheme.colorScheme.tertiaryContainer
        Role.SYSTEM -> MaterialTheme.colorScheme.secondaryContainer
    }
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = align) {
        Surface(
            color = bubbleColor,
            shape = RoundedCornerShape(12.dp),
        ) {
            val pad = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
            if (role == Role.ASSISTANT) {
                // The agent replies in Markdown — render it instead of showing
                // raw `**`/`###`/`-` syntax.
                MarkdownText(
                    markdown = text,
                    modifier = pad,
                    textColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                Text(
                    text = text,
                    modifier = pad,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = if (role == Role.SYSTEM) TextAlign.Center else TextAlign.Start,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InputBar(
    value: String,
    enabled: Boolean,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    Surface(
        tonalElevation = 2.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("一句话指挥采集 / 查询 / 分析…") },
                enabled = enabled,
                maxLines = 4,
            )
            IconButton(onClick = onSend, enabled = enabled && value.isNotBlank()) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "发送")
            }
        }
    }
}
