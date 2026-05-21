package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
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
import androidx.compose.ui.graphics.Color
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

            state.answer?.let { answer ->
                Spacer(Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))
                Text(
                    "回答",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.height(6.dp))
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        answer,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                state.llmName?.let { name ->
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "推理模型：$name ${if (state.isLocal) "(本地)" else "(非本地)"}",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (state.isLocal) Color.Unspecified else MaterialTheme.colorScheme.tertiary
                    )
                }

                if (state.citations.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "引用 (${state.citations.size})",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.height(6.dp))
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
