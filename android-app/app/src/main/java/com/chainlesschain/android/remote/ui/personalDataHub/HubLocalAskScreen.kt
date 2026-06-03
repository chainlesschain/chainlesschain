package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * A3.8 — 第 5 个 tab "本机提问" inside PersonalDataHubScreen.
 *
 * 与 tab 0 "提问" (HubAskScreen) 的区别：
 *  - tab 0 提问  → HubAskScreen  → DC RPC 到对端桌面 hub（远程）
 *  - tab 4 本机提问 → 本屏        → in-APK cc + Kotlin LLM server（本机）
 *
 * 共享 HubLocalViewModel 同实例 (hiltViewModel() 在同一 NavBackStackEntry
 * 下 scope 一致)：本屏 ask 与 HubLocalScreen 内的 HubAskCard 写同一个
 * AskCardState，用户在两屏切换不丢答案。
 *
 * v0.1 内容 = HubAskCard + 一张引导卡（"在 '本机数据' tab 同步更多 adapter
 * 让 AI 答得更准"），让用户理解 ask 与 sync 的链路。A3.2 server wire 后真
 * 出答案，A3.9 真机 E2E 飞机模式验。
 */
@Composable
fun HubLocalAskScreen(
    viewModel: HubLocalViewModel = hiltViewModel(),
    // 2026-05-24 — 首页 ChatInputBar 「查看详情」跳过来时携带的预填问题。
    // 非空且与当前 ask state 不同时一次性自动 submit；用 consumed 防止 nav 回退后再触发。
    askPrefill: String? = null,
) {
    val state by viewModel.state.collectAsState()
    var consumedPrefill by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(askPrefill) {
        val q = askPrefill?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        if (q == consumedPrefill) return@LaunchedEffect
        consumedPrefill = q
        viewModel.onAskQuestionChanged(q)
        viewModel.askQuestion()
    }

    Scaffold { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item("header") {
                Column {
                    Text(
                        "本机提问",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "用大白话问任意问题，AI 在本机回答并给出引用。飞机模式可用，不上云。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            item("ask-card") {
                HubAskCard(
                    state = state.ask,
                    onQuestionChanged = { viewModel.onAskQuestionChanged(it) },
                    onSubmit = { viewModel.askQuestion() },
                    onCitationClick = { eventId ->
                        // 推文 §"点一下看原文" 真接通 — 走 cc hub event-detail
                        viewModel.requestCitationDetail(eventId)
                    },
                    onDismissAnswer = { viewModel.clearAskAnswer() },
                    // §2.1 A3.4 — share model status with tab 4 so user gets
                    // the same download/Ready banner in both ask surfaces.
                    modelStatus = state.modelStatus,
                    onDownloadModel = { viewModel.downloadModel() },
                    onDeleteModel = { viewModel.deleteModel() },
                    onRouteSelected = { route -> viewModel.setAskRoute(route) },
                    onSelectModel = { key -> viewModel.selectModel(key) },
                )
            }

            item("hint") {
                HintCard(
                    title = "想让答案更准？",
                    body = "切到 '本机数据' tab 同步更多 adapter（邮箱 / 支付 / 出行 / " +
                        "AI 助手等），AI 引用面就越广。所有数据只在本机加密金库，不联网。",
                )
            }

            item("offline-note") {
                HintCard(
                    title = "飞机模式可用",
                    body = "端侧 LLM (Qwen2.5-1.5B-Q4_K_M, ~1GB) 加载后完全离线运行。" +
                        "首问需 1-3 秒首 token，后续 8-15 tokens/s。",
                )
            }
        }
    }

    CitationDetailSheet(
        state = state.citationDetail,
        onDismiss = { viewModel.dismissCitationDetail() },
    )
}

@Composable
private fun HintCard(title: String, body: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                body,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
