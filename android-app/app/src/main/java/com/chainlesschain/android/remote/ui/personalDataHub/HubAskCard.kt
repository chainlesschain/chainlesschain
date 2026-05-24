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
import androidx.compose.material3.RadioButton
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
    onRouteSelected: (LlmRoute) -> Unit = {},
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

            // 2026-05-24 — 4-way LLM route selector. 跟 tab 0 HubAskScreen 同形态，
            // 但用 AskCardState 字段（不是 HubAskUiState）以避免双 VM 耦合。
            Spacer(modifier = Modifier.height(12.dp))
            HubAskCardRouteSelector(
                state = state,
                isLoading = state.isAsking,
                onRouteSelected = onRouteSelected,
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
            // downloaded, user just wants to ask). If native lib isn't loaded
            // yet (v0.2 dep not landed), the inference path still fails — say so
            // honestly so the user understands why "提问" returns an error.
            if (status.nativeEngineReady) {
                Text(
                    text = "🟢 端侧模型已就绪${status.modelName?.let { " · $it" } ?: ""}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            } else {
                Text(
                    text = "⏳ 模型已下载${status.modelName?.let { " · $it" } ?: ""} · 等 v0.2 推理引擎接通",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
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
                        // 推文 §"诚实说" 真接通：如果 native .so 还没 land (Win
                        // build 期 v0.2 之前)，承认"下载就绪 + 推理 v0.2"是当前
                        // 真实状态，不让用户白下 1GB 后被错误信息卡住。
                        Text(
                            text = if (status.nativeEngineReady)
                                "Qwen2.5-1.5B Q4 · ~1GB · 一次下载，永久离线可用"
                            else
                                "Qwen2.5-1.5B Q4 · ~1GB · 推理引擎将在 v0.2 启用 (可先下载备用)",
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

/**
 * 2026-05-24 — 4-way LLM route selector for HubAskCard (tab 3 本机数据 / tab 4 本机提问).
 * 镜像 HubAskScreen.HubAskRouteSelector 形态但绑 AskCardState 字段。
 *
 * 显示规则同 HubAskScreen:
 *  - 0 路可用 → errorContainer banner 引导用户去配置
 *  - 1 路可用 → 单行只读 label
 *  - ≥2 路可用 → 4 radio rows (不可用项 disabled 灰显)
 */
@Composable
private fun HubAskCardRouteSelector(
    state: HubLocalViewModel.AskCardState,
    isLoading: Boolean,
    onRouteSelected: (LlmRoute) -> Unit,
) {
    val availableCount = listOf(
        state.localDeviceAvailable,
        state.cloudAvailable,
        state.pcLocalAvailable,
        state.lanAvailable,
    ).count { it }

    when (availableCount) {
        0 -> {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(8.dp),
            ) {
                Text(
                    "暂无可用 LLM。到「设置 → AI 后端」配:云 API Key / 配对桌面 / 局域网 Ollama URL / 端侧模型，至少一项。",
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
        }
        1 -> {
            val (title, subtitle) = when {
                state.localDeviceAvailable -> "推理走端侧 LocalLlmServer + 本机 vault RAG" to
                    "MediaPipe · Qwen2.5-1.5B"
                state.cloudAvailable -> "推理走云 LLM（手机端，无 RAG）" to
                    (state.androidLlm?.let { "${it.provider.displayName} · ${it.model}" } ?: "—")
                state.pcLocalAvailable -> "推理走 PC 本机模型（桌面数据 + 桌面 Ollama）" to
                    (state.remoteHealth?.llm?.name ?: "桌面 Ollama")
                else -> "推理走局域网 LLM + 本机 vault RAG" to (state.lanLlmBaseUrl ?: "—")
            }
            HubAskCardSingleLabel(title = title, subtitle = subtitle)
        }
        else -> {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(8.dp),
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Text(
                        "推理路由",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(4.dp))
                    HubAskCardRouteOption(
                        selected = state.effectiveRoute == LlmRoute.LOCAL_DEVICE,
                        enabled = !isLoading && state.localDeviceAvailable,
                        title = "本地模型（端侧 + 本机 RAG）",
                        subtitle = if (state.localDeviceAvailable)
                            "on-device LocalLlmServer · Qwen2.5-1.5B · 飞机模式可用"
                        else
                            "端侧引擎未就绪 — 先下载模型",
                        onClick = { onRouteSelected(LlmRoute.LOCAL_DEVICE) },
                    )
                    HubAskCardRouteOption(
                        selected = state.effectiveRoute == LlmRoute.CLOUD_ANDROID,
                        enabled = !isLoading && state.cloudAvailable,
                        title = "云 LLM（手机端，无 RAG）",
                        subtitle = state.androidLlm?.let { "${it.provider.displayName} · ${it.model}" }
                            ?: "未配置 — 到「设置 → 大模型」加 API Key",
                        onClick = { onRouteSelected(LlmRoute.CLOUD_ANDROID) },
                    )
                    HubAskCardRouteOption(
                        selected = state.effectiveRoute == LlmRoute.PC_LOCAL,
                        enabled = !isLoading && state.pcLocalAvailable,
                        title = "PC 本机模型（桌面数据源）",
                        subtitle = if (state.pcLocalAvailable)
                            (state.remoteHealth?.llm?.name ?: "桌面 Ollama")
                        else
                            "未配对桌面或桌面未开本机模型",
                        onClick = { onRouteSelected(LlmRoute.PC_LOCAL) },
                    )
                    HubAskCardRouteOption(
                        selected = state.effectiveRoute == LlmRoute.LAN_OLLAMA,
                        enabled = !isLoading && state.lanAvailable,
                        title = "局域网 LLM（本机 RAG）",
                        subtitle = state.lanLlmBaseUrl
                            ?: "未配置 — 到「设置 → AI 后端」填 URL",
                        onClick = { onRouteSelected(LlmRoute.LAN_OLLAMA) },
                    )
                }
            }
        }
    }
}

@Composable
private fun HubAskCardRouteOption(
    selected: Boolean,
    enabled: Boolean,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(
            selected = selected,
            onClick = if (enabled) onClick else null,
            enabled = enabled,
        )
        Spacer(modifier = Modifier.size(8.dp))
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(
                subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun HubAskCardSingleLabel(title: String, subtitle: String) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(8.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(
                subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
