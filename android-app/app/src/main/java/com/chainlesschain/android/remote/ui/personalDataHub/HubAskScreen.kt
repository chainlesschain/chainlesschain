package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Phase 14.1 — HubAskScreen
 *
 * 个人数据中台自然语言提问主屏。
 * - 顶部 HubHealthCard 显示 vault / llm / kg / rag 四件套状态
 * - 中部 OutlinedTextField 输入问题
 * - 提问按钮 → ask → 答案 + citation chip
 * - citation chip 点击 → ModalBottomSheet 拉事件详情
 * - 非本地 LLM 触发 AcceptNonLocalDialog 二次确认
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HubAskScreen(
    viewModel: HubAskViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Text(
                "个人数据中台",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "本地数据 + 本地 LLM 跨源问答",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(12.dp))

            HubHealthCard(health = state.health)
            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = state.question,
                onValueChange = viewModel::onQuestionChange,
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 5,
                label = { Text("提问（按时间、人物、行为跨源查）") },
                placeholder = { Text("例：上个月妈妈生日那周买了啥送哪儿？") },
                enabled = !state.isLoading
            )
            Spacer(Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp
                    )
                    Spacer(Modifier.size(8.dp))
                }
                TextButton(onClick = { viewModel.clear() }, enabled = !state.isLoading) {
                    Text("清空")
                }
                Spacer(Modifier.size(8.dp))
                Button(
                    onClick = { viewModel.submit() },
                    enabled = !state.isLoading && state.question.isNotBlank()
                ) {
                    Text(if (state.isLoading) "推理中…" else "提问")
                }
            }

            if (state.isLoading) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            state.errorMessage?.let { err ->
                Spacer(Modifier.height(12.dp))
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        err,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            // Phase 14.1 step 5 — ChatBubble rendering for ask flow (mirrors iOS Phase 5 AI Chat
            // ChatBubble pattern). User question bubble (right, primaryContainer) + assistant
            // answer bubble (left, secondaryContainer). While isLoading, a BlinkingCursor bubble
            // sits in the assistant slot to signal in-flight inference (single-shot today; ready
            // for token-by-token streaming wire-up in a follow-up Phase 14.5).
            val submittedQuestion = state.submittedQuestion
            val answer = state.answer
            val llmName = state.llmName
            val hasConversation = submittedQuestion != null || answer != null
            if (hasConversation) {
                Spacer(Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))

                if (submittedQuestion != null) {
                    HubChatBubble(role = HubChatRole.USER) {
                        Text(submittedQuestion, style = MaterialTheme.typography.bodyMedium)
                    }
                    Spacer(Modifier.height(8.dp))
                }

                if (state.isLoading) {
                    HubChatBubble(role = HubChatRole.ASSISTANT) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "推理中",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                            Spacer(Modifier.size(4.dp))
                            HubBlinkingCursor()
                        }
                    }
                } else if (answer != null) {
                    HubChatBubble(role = HubChatRole.ASSISTANT) {
                        Text(
                            answer,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                        if (llmName != null) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "推理模型：$llmName ${if (state.isLocal) "(本地)" else "(非本地)"}",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (state.isLocal)
                                    MaterialTheme.colorScheme.onSecondaryContainer
                                else
                                    MaterialTheme.colorScheme.tertiary
                            )
                        }
                        if (state.citations.isNotEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "引用 (${state.citations.size})",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                            Spacer(Modifier.height(4.dp))
                            state.citations.forEach { c ->
                                AssistChip(
                                    onClick = { viewModel.openCitation(c.eventId) },
                                    label = { Text(c.eventId.take(10) + "…") },
                                    colors = AssistChipDefaults.assistChipColors()
                                )
                                Spacer(Modifier.height(4.dp))
                            }
                        }
                    }
                }
            }
        }
    }

    if (state.showAcceptNonLocalDialog) {
        AcceptNonLocalDialog(
            onAccept = viewModel::acceptNonLocalAndRetry,
            onDismiss = viewModel::dismissAcceptNonLocalDialog
        )
    }

    val detail = state.activeCitationDetail
    if (detail != null) {
        ModalBottomSheet(
            onDismissRequest = viewModel::closeCitation,
            sheetState = sheetState
        ) {
            // Phase 14.3.3.b — shared with HubAuditScreen via HubEventDetailSheet.kt.
            HubEventDetailContent(detail)
        }
    }
}

// Phase 14.1 step 5 — ChatBubble helpers (mirror iOS Phase 5 ChatBubble pattern).
// Kept internal/private to this file: HubAskScreen is the only consumer until a follow-up
// surfaces another single-turn Q&A screen. If/when reused, lift to ui/personalDataHub/components.

internal enum class HubChatRole { USER, ASSISTANT }

@Composable
internal fun HubChatBubble(
    role: HubChatRole,
    content: @Composable () -> Unit
) {
    val isAssistant = role == HubChatRole.ASSISTANT
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isAssistant) Arrangement.Start else Arrangement.End
    ) {
        Card(
            modifier = Modifier.widthIn(max = 320.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (isAssistant)
                    MaterialTheme.colorScheme.secondaryContainer
                else
                    MaterialTheme.colorScheme.primaryContainer
            ),
            // 不对称圆角 = 经典 chat bubble "尾巴"指向说话者：助手左下小尾、用户右下小尾。
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isAssistant) 4.dp else 16.dp,
                bottomEnd = if (isAssistant) 16.dp else 4.dp
            )
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                content()
            }
        }
    }
}

@Composable
internal fun HubBlinkingCursor() {
    // 500ms 周期 reverse 闪烁 — 与 iOS Phase 5 同节奏，避免视觉过载。
    val infiniteTransition = rememberInfiniteTransition(label = "hub-cursor-blink")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(500, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "hub-cursor-alpha"
    )
    Text(
        "▎",
        modifier = Modifier.alpha(alpha),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.primary
    )
}
