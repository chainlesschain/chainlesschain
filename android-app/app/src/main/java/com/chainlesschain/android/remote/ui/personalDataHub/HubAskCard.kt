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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
    modelStatus: HubLocalViewModel.ModelStatusState = HubLocalViewModel.ModelStatusState(),
    onDownloadModel: () -> Unit = {},
    onDeleteModel: () -> Unit = {},
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

            // §2.1 A3.4 — 端侧 LLM 模型状态条。NotDownloaded / Downloading /
            // Verifying / Failed → 显眼提示；Ready → 紧凑 badge。UNKNOWN 不显
            // (init-time blink 防闪烁)。
            if (modelStatus.kind != HubLocalViewModel.ModelStatusState.Kind.UNKNOWN) {
                Spacer(modifier = Modifier.height(12.dp))
                ModelStatusBanner(
                    status = modelStatus,
                    onDownload = onDownloadModel,
                    onDelete = onDeleteModel,
                )
            }

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

/**
 * §2.1 A3.4 — surfaces [ModelManager] state inline above the question input.
 * 推文 §"无网也能用" 真接通的视觉入口：用户首启 → "下载模型 ~1GB" 按钮；下载中
 * → 进度条 + 已收字节；Ready → 紧凑 "模型已就绪" badge；Failed → 错误 + 重试。
 *
 * 设计原则：READY 状态时把横幅压到最小（仅一行 caption），避免占用问答区视觉
 * 空间；用户已下载好就不该被打扰。其它状态需要醒目，使用更高对比度容器色。
 */
@Composable
private fun ModelStatusBanner(
    status: HubLocalViewModel.ModelStatusState,
    onDownload: () -> Unit,
    onDelete: () -> Unit,
) {
    when (status.kind) {
        HubLocalViewModel.ModelStatusState.Kind.READY -> {
            // Ready: compact one-line caption so the question input stays
            // visually dominant on the most common path (model already
            // downloaded, user just wants to ask).
            Text(
                text = "🟢 端侧模型已就绪${status.modelName?.let { " · $it" } ?: ""}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        HubLocalViewModel.ModelStatusState.Kind.NOT_DOWNLOADED -> {
            Surface(
                color = MaterialTheme.colorScheme.tertiaryContainer,
                shape = RoundedCornerShape(8.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.fillMaxWidth(0.65f)) {
                        Text(
                            text = "端侧 AI 模型未下载",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "Qwen2.5-1.5B Q4 · ~1GB · 一次下载，永久离线可用",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                        )
                    }
                    Spacer(modifier = Modifier.fillMaxWidth(0.05f))
                    Button(onClick = onDownload) { Text("下载") }
                }
            }
        }
        HubLocalViewModel.ModelStatusState.Kind.DOWNLOADING -> {
            Surface(
                color = MaterialTheme.colorScheme.secondaryContainer,
                shape = RoundedCornerShape(8.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                ) {
                    val pct = (status.progressFraction * 100).toInt().coerceIn(0, 100)
                    val mb = status.receivedBytes / 1_000_000L
                    val totalMb = status.totalBytes / 1_000_000L
                    Text(
                        text = "下载端侧模型 · $pct% · ${mb}MB / ${totalMb}MB",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    if (status.totalBytes > 0L) {
                        LinearProgressIndicator(
                            progress = status.progressFraction.coerceIn(0f, 1f),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        }
        HubLocalViewModel.ModelStatusState.Kind.VERIFYING -> {
            Surface(
                color = MaterialTheme.colorScheme.secondaryContainer,
                shape = RoundedCornerShape(8.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                    )
                    Spacer(modifier = Modifier.fillMaxWidth(0.04f))
                    Text(
                        text = "校验 SHA256 中…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
            }
        }
        HubLocalViewModel.ModelStatusState.Kind.FAILED -> {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(8.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                ) {
                    Text(
                        text = "模型下载失败",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    val msg = status.errorMessage
                    if (!msg.isNullOrBlank()) {
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = msg,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row {
                        Button(onClick = onDownload) { Text("重试") }
                        Spacer(modifier = Modifier.fillMaxWidth(0.04f))
                        OutlinedButton(onClick = onDelete) { Text("清理残文件") }
                    }
                }
            }
        }
        HubLocalViewModel.ModelStatusState.Kind.UNKNOWN -> {
            // Caller already gates on UNKNOWN, but be defensive.
        }
    }
}
