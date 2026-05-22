package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * A3 — "提问" card. Surface for the推文 §"用大白话提问 / AI 必须给出处" promise.
 *
 * Renders inside HubLocalScreen's card list (D5 refactor wires it in).
 * Single-shot non-streaming Q&A — streaming via Ollama SSE is a v0.2 follow-up.
 *
 * Citation chips are clickable callbacks so the parent can deep-link into
 * the audit detail screen (an event id resolves to the original vault row,
 * which is the推文 promise "点一下就能看到原文").
 */
@Composable
fun HubAskCard(
    state: HubLocalViewModel.AskCardState,
    onQuestionChanged: (String) -> Unit,
    onSubmit: () -> Unit,
    onCitationClick: (eventId: String) -> Unit,
    onDismissAnswer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "提问本机数据",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(modifier = Modifier.fillMaxWidth(0.6f))
                if (state.llmName != null && state.answer != null) {
                    val tag = if (state.isLocal) "本地" else "云端"
                    Text(
                        text = "$tag · ${state.llmName}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "用大白话问任意问题，AI 在本机回答并给出引用。飞机模式下也能问。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(12.dp))
            OutlinedTextField(
                value = state.question,
                onValueChange = onQuestionChanged,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 64.dp),
                placeholder = { Text("例：上周谁给我打过电话？") },
                enabled = !state.isAsking,
                maxLines = 4,
            )

            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (state.answer != null || state.errorMessage != null) {
                    TextButton(onClick = onDismissAnswer) { Text("清空") }
                    Spacer(modifier = Modifier.fillMaxWidth(0.05f))
                }
                Button(
                    onClick = onSubmit,
                    enabled = !state.isAsking && state.question.isNotBlank(),
                ) {
                    if (state.isAsking) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                        )
                        Spacer(modifier = Modifier.fillMaxWidth(0.04f))
                        Text("生成中…")
                    } else {
                        Text("提问")
                    }
                }
            }

            // Error
            val err = state.errorMessage
            if (err != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = err,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            // Answer
            val answer = state.answer
            if (answer != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = answer,
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (state.citations.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "依据 ${state.citations.size} 条本机记录",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    state.citations.take(8).forEach { c ->
                        AssistChip(
                            onClick = { onCitationClick(c.eventId) },
                            label = {
                                val label = c.excerpt?.takeIf { it.isNotBlank() }?.let {
                                    if (it.length > 28) it.take(28) + "…" else it
                                } ?: c.eventId.take(10)
                                Text(label)
                            },
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                    }
                }
                if (state.durationMs > 0L) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "耗时 ${state.durationMs} ms",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
