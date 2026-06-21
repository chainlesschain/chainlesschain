package com.chainlesschain.android.presentation.screens.pdh

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.core.ui.components.MarkdownText
import com.chainlesschain.android.pdh.PdhAgentSession.FeedbackKind
import com.chainlesschain.android.pdh.PdhAssetBackup
import com.chainlesschain.android.pdh.PdhOnboarding
import com.chainlesschain.android.pdh.PdhPrivacyTier
import com.chainlesschain.android.pdh.PdhResultView
import com.chainlesschain.android.pdh.PdhTransparency
import com.chainlesschain.android.pdh.TxnRisk
import com.chainlesschain.android.presentation.screens.pdh.PdhChatViewModel.Role
import com.chainlesschain.android.presentation.screens.pdh.PdhChatViewModel.TrustCard

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
    var searchOpen by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    // Auto-scroll to the newest line — but NOT while searching (the user is
    // browsing matches, not following the live turn).
    LaunchedEffect(state.messages.size, state.streamingText, state.pendingCards.size, state.searchQuery) {
        if (state.searchQuery.isNotBlank()) return@LaunchedEffect
        val total = state.visibleMessages.size +
            (if (state.streamingText.isNotEmpty()) 1 else 0) +
            state.pendingCards.size +
            (if (state.hasOlder) 1 else 0)
        if (total > 0) listState.animateScrollToItem(total - 1)
    }

    // §3.5.18: the transparency panel renders at the top → scroll to it when opened.
    LaunchedEffect(state.transparency != null) {
        if (state.transparency != null) listState.animateScrollToItem(0)
    }

    // §3.6 human-in-loop: collect_system_data reads contacts (and files), which
    // need runtime grants. Surface a one-tap request when missing — MIUI blocks
    // adb `pm grant` but the runtime dialog still works.
    val context = LocalContext.current
    val dataPermissions = remember { dataCollectionPermissions() }
    var missingPerms by remember { mutableStateOf(missingPermissions(context, dataPermissions)) }
    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { missingPerms = missingPermissions(context, dataPermissions) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("个人助手", style = MaterialTheme.typography.titleMedium) },
                actions = {
                    // §3.5.16: 目标设备选择器 —— 指挥本机或你的其他自有设备。
                    DeviceSelector(
                        targetDevice = state.targetDevice,
                        paired = state.pairedDevices,
                        onSelect = { viewModel.setTargetDevice(it) },
                    )
                    // §3.5.18: 透明度入口 —— 看数据去过哪 / AI 替你办过什么。
                    TextButton(onClick = { viewModel.openTransparency() }) { Text("透明度") }
                    // 记录搜索开关:开→显示搜索框,关→清空关键词恢复正常视图。
                    IconButton(onClick = {
                        searchOpen = !searchOpen
                        if (!searchOpen) viewModel.setSearch("")
                    }) {
                        Icon(
                            imageVector = if (searchOpen) Icons.Default.Close else Icons.Default.Search,
                            contentDescription = if (searchOpen) "关闭搜索" else "搜索记录",
                        )
                    }
                    // §3.5.10 接线3: data-flow badge — 这次 AI 在哪跑、数据是否离开手机。
                    state.privacyBadge?.let { PrivacyBadge(it) }
                },
            )
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

            if (missingPerms.isNotEmpty()) {
                PermissionBanner(
                    onGrant = { permLauncher.launch(missingPerms.toTypedArray()) },
                )
            }

            // 记录搜索框:命中关键词只显示匹配行(§ 用户要求的记录查询)。
            if (searchOpen) {
                OutlinedTextField(
                    value = state.searchQuery,
                    onValueChange = { viewModel.setSearch(it) },
                    placeholder = { Text("搜索对话记录…") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                )
            }

            val searching = state.searchQuery.isNotBlank()
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // §3.5.19 首跑 onboarding 三步(空态引导,取代"已就绪"文案)。
                state.onboarding?.let { ob ->
                    item { OnboardingPanel(ob = ob, viewModel = viewModel) }
                }
                // §3.5.20 重活预算提醒(成本/时机 +「现在就跑」覆盖)。
                state.budgetNotice?.let { notice ->
                    item { BudgetNoticeCard(notice = notice, viewModel = viewModel) }
                }
                // §3.5.10 接线5 上云同意卡(采集数据 × 云端 → 显式同意才放行)。
                state.cloudConsent?.let {
                    item { ConsentCard(viewModel = viewModel) }
                }
                // §3.5.18 透明度审计视图(数据去过哪 / AI 替你办过什么 / AI 画像)。
                state.transparency?.let { t ->
                    item { TransparencyPanel(t = t, viewModel = viewModel) }
                }
                // 翻页:顶部「加载更早」展开更老的记录(非搜索态)。
                if (state.hasOlder) {
                    item {
                        TextButton(
                            onClick = { viewModel.loadMore() },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("加载更早的 ${state.messages.size - state.displayLimit} 条记录…")
                        }
                    }
                }
                itemsIndexed(state.visibleMessages, key = { _, m -> m.id }) { _, msg ->
                    when (msg.role) {
                        // §3.5.11: 被读取的数据用独立「引用」容器,绝不套 AI 气泡样式。
                        Role.DATA -> DataQuoteCard(msg, onToggle = { viewModel.toggleCollapse(msg.id) })
                        // §3.5.12: 可信结构化结果用视图卡(区别于不可信数据)。
                        Role.VIEW -> ResultViewCard(msg, onToggle = { viewModel.toggleCollapse(msg.id) })
                        // §3.5.13: 已落库的 AI 回应带反馈页脚(👍/👎/纠正)。
                        Role.ASSISTANT -> AssistantMessage(
                            msg = msg,
                            onThumbUp = { viewModel.thumbUp(msg.id) },
                            onThumbDown = { viewModel.thumbDown(msg.id) },
                            onCorrect = { viewModel.submitCorrection(msg.id, it) },
                        )
                        else -> MessageRow(role = msg.role, text = msg.text)
                    }
                }
                if (searching && state.visibleMessages.isEmpty()) {
                    item {
                        Text(
                            "没有匹配「${state.searchQuery}」的记录",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
                // 实时回合 UI(流式/思考/信任卡)只在非搜索态显示。
                if (!searching) {
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
                    // §3.5.9 内联信任卡(引导/预览/审批/计划)。
                    items(state.pendingCards, key = { it.id }) { card ->
                        TrustCardItem(card = card, viewModel = viewModel, context = context)
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

/**
 * §3.5.16 顶栏目标设备选择器:在本机或你的其他自有设备上执行。Phase 2 真正连远端
 * bridge 的传输是 §10/Phase 8;无已配对设备时如实显示"需配对"(诚实,不假装可用)。
 */
@Composable
private fun DeviceSelector(targetDevice: String, paired: List<String>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { expanded = true }) { Text("⇄ $targetDevice") }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text(PdhChatViewModel.SELF_DEVICE) },
                onClick = { onSelect(PdhChatViewModel.SELF_DEVICE); expanded = false },
            )
            if (paired.isEmpty()) {
                DropdownMenuItem(
                    text = {
                        Text(
                            "未发现其他已配对设备(跨设备需配对)",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    },
                    onClick = {},
                    enabled = false,
                )
            } else {
                paired.forEach { d ->
                    DropdownMenuItem(text = { Text(d) }, onClick = { onSelect(d); expanded = false })
                }
            }
        }
    }
}

/**
 * §3.5.10 接线3 — 顶栏数据流向徽章:常显这次 AI 在哪跑、数据是否离开手机。
 * 透明度优先(§3.5.5/§13.3):如实展示档位,不隐藏。
 */
@Composable
private fun PrivacyBadge(badge: PdhPrivacyTier.TierBadge) {
    Column(
        horizontalAlignment = Alignment.End,
        modifier = Modifier.padding(end = 12.dp),
    ) {
        Text(text = badge.label, style = MaterialTheme.typography.labelMedium)
        Text(
            text = badge.dataFlow,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * §3.5.19 首跑 onboarding 三步(身份 → 选源 → 一键采集),取代空态"已就绪"文案。
 * 低门槛 = 普惠:默认免 root 源先出价值、高级源折叠、每步显式同意(不偷采)。
 */
@Composable
private fun OnboardingPanel(ob: PdhChatViewModel.Onboarding, viewModel: PdhChatViewModel) {
    CardSurface(color = MaterialTheme.colorScheme.secondaryContainer) {
        Text("欢迎 · 把散落的数据汇回你自己", style = MaterialTheme.typography.titleMedium)
        when (ob.step) {
            PdhOnboarding.Step.IDENTITY -> {
                Text("① 你的数据身份", style = MaterialTheme.typography.titleSmall)
                Text(
                    "用一个数据身份根(DID)标识你的个人数据库——密钥只归你自己,数据不属于任何平台。",
                    style = MaterialTheme.typography.bodySmall,
                )
                OnboardingButtons(
                    onSkip = { viewModel.onboardingSkip() },
                    primaryText = "继续",
                    primaryEnabled = true,
                    onPrimary = { viewModel.onboardingNext() },
                )
            }
            PdhOnboarding.Step.SOURCES -> {
                Text("② 选择数据来源", style = MaterialTheme.typography.titleSmall)
                Text(
                    "先连免 root 的来源,马上能看到价值;高级来源可选。",
                    style = MaterialTheme.typography.bodySmall,
                )
                PdhOnboarding.DEFAULT_SOURCES.forEach { src ->
                    SourceCheckRow(src, src in ob.selectedSources) { viewModel.onboardingToggleSource(src) }
                }
                TextButton(onClick = { viewModel.onboardingToggleAdvanced() }) {
                    Text(if (ob.showAdvanced) "收起高级来源" else "高级来源(需 root / 登录)")
                }
                if (ob.showAdvanced) {
                    PdhOnboarding.ADVANCED_SOURCES.forEach { src ->
                        SourceCheckRow(src, src in ob.selectedSources) {
                            viewModel.onboardingToggleSource(src)
                        }
                    }
                }
                OnboardingButtons(
                    onSkip = { viewModel.onboardingSkip() },
                    primaryText = "继续",
                    primaryEnabled = ob.selectedSources.isNotEmpty(),
                    onPrimary = { viewModel.onboardingNext() },
                )
            }
            PdhOnboarding.Step.COLLECT -> {
                Text("③ 一键采集", style = MaterialTheme.typography.titleSmall)
                Text(
                    "将采集:" + ob.selectedSources.joinToString("、") { PdhOnboarding.sourceLabel(it) },
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    "采完给你一份数据全貌——这些都在你手机上,只属于你。",
                    style = MaterialTheme.typography.bodySmall,
                )
                OnboardingButtons(
                    onSkip = { viewModel.onboardingSkip() },
                    primaryText = "开始采集",
                    primaryEnabled = ob.selectedSources.isNotEmpty(),
                    onPrimary = { viewModel.onboardingStartCollect() },
                )
            }
        }
    }
}

/**
 * §3.5.20 重活预算提醒(advisory):大采集前的成本/时机提示 +「现在就跑」覆盖。
 * 诚实:Phase 2 不做自动排队引擎(§13.2),故只提醒;立即跑或取消由人决定。
 */
@Composable
private fun BudgetNoticeCard(notice: PdhChatViewModel.BudgetNotice, viewModel: PdhChatViewModel) {
    val onColor = MaterialTheme.colorScheme.onTertiaryContainer
    CardSurface(color = MaterialTheme.colorScheme.tertiaryContainer) {
        Text("重活提醒", style = MaterialTheme.typography.titleSmall, color = onColor)
        Text(notice.message, style = MaterialTheme.typography.bodyMedium, color = onColor)
        notice.costWarning?.let {
            Text("⚠ $it", style = MaterialTheme.typography.bodySmall, color = onColor)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { viewModel.dismissBudgetNotice() }) { Text("取消") }
            Button(
                onClick = { viewModel.runCollectNow() },
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("现在就跑") }
        }
    }
}

/**
 * §3.5.10 接线5 上云同意卡:本轮涉及采集数据且 AI 在云端 → 显式同意才放行。
 * 诚实(§7.1/§13.4):只送问题 + RAG 摘要、不送原始私信/账单;取消则不出端。
 */
@Composable
private fun ConsentCard(viewModel: PdhChatViewModel) {
    var dontAskAgain by remember { mutableStateOf(false) }
    val onColor = MaterialTheme.colorScheme.onTertiaryContainer
    CardSurface(color = MaterialTheme.colorScheme.tertiaryContainer) {
        Text("上云确认", style = MaterialTheme.typography.titleSmall, color = onColor)
        Text(
            "本轮涉及采集数据,且 AI 在云端。将把【你的问题 + RAG 事实摘要】发往云端模型,不送原始私信/账单。",
            style = MaterialTheme.typography.bodyMedium,
            color = onColor,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = dontAskAgain, onCheckedChange = { dontAskAgain = it })
            Text("本类不再问", style = MaterialTheme.typography.bodySmall, color = onColor)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { viewModel.denyCloudConsent() }) { Text("取消") }
            Button(
                onClick = { viewModel.grantCloudConsent(dontAskAgain) },
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("同意") }
        }
    }
}

/**
 * §3.5.14 资产备份卡(高风险,可逆):列出将备份的资产范围 + E2E/不上云保证。
 * 真同步引擎(libp2p 增量 + DID 解密)是 §8.3/Phase 7;本卡只做范围可见 + 审批。
 */
@Composable
private fun BackupCard(card: TrustCard.Backup, viewModel: PdhChatViewModel) {
    val onColor = MaterialTheme.colorScheme.onTertiaryContainer
    CardSurface(color = MaterialTheme.colorScheme.tertiaryContainer) {
        Text("资产备份(高风险)", style = MaterialTheme.typography.titleSmall, color = onColor)
        if (card.summary.isNotBlank()) {
            Text(card.summary, style = MaterialTheme.typography.bodySmall, color = onColor)
        }
        Text(
            "将端到端加密备份以下资产到你的自有设备:",
            style = MaterialTheme.typography.bodyMedium,
            color = onColor,
        )
        card.assets.forEach { a ->
            val count = if (a.itemCount > 0) " · ${a.itemCount} 项" else ""
            Text("· ${a.label}$count", style = MaterialTheme.typography.bodySmall, color = onColor)
        }
        Text(
            "🔒 端到端加密,只在你自有设备间,绝不上云。",
            style = MaterialTheme.typography.bodySmall,
            color = onColor,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { viewModel.resolveCard(card.id, false) }) { Text("取消") }
            Button(
                onClick = { viewModel.resolveCard(card.id, true) },
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("确认备份") }
        }
    }
}

/**
 * §3.5.14 资产恢复卡(更高风险):覆盖/合并本地资产 → 强确认(确认词)+ 凭 DID 认领;
 * 冲突合并预览是 §8.3/§13.5/Phase 7,本卡只做强确认 + 不静默覆盖的提示。
 */
@Composable
private fun RestoreCard(card: TrustCard.Restore, viewModel: PdhChatViewModel) {
    val onColor = MaterialTheme.colorScheme.onErrorContainer
    var confirmWord by remember(card.id) { mutableStateOf("") }
    val ok = confirmWord.trim() == TXN_CONFIRM_WORD
    CardSurface(color = MaterialTheme.colorScheme.errorContainer) {
        Text("资产恢复(更高风险)", style = MaterialTheme.typography.titleSmall, color = onColor)
        if (card.summary.isNotBlank()) {
            Text(card.summary, style = MaterialTheme.typography.bodySmall, color = onColor)
        }
        Text(
            "将用备份覆盖/合并本地资产。凭你的 DID 认领并解密属于你的资产;冲突会让你确认,绝不静默覆盖。",
            style = MaterialTheme.typography.bodyMedium,
            color = onColor,
        )
        OutlinedTextField(
            value = confirmWord,
            onValueChange = { confirmWord = it },
            singleLine = true,
            label = { Text("输入「$TXN_CONFIRM_WORD」以继续") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { viewModel.resolveCard(card.id, false) }) { Text("取消") }
            Button(
                onClick = { viewModel.resolveCard(card.id, true) },
                enabled = ok,
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("确认恢复") }
        }
    }
}

/**
 * §3.5.18 透明度审计视图(读侧):三段——AI 画像(可纠)/ 数据出境 / AI 替你办过的事。
 * 诚实(§13.3/§13.4):0 也如实显示,绝不隐藏出境/操作。完整下钻/关系图是 §9/Phase 6。
 */
@Composable
private fun TransparencyPanel(t: PdhChatViewModel.Transparency, viewModel: PdhChatViewModel) {
    val onColor = MaterialTheme.colorScheme.onSurfaceVariant
    CardSurface(color = MaterialTheme.colorScheme.surfaceVariant) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("透明度", style = MaterialTheme.typography.titleSmall, color = onColor)
            TextButton(onClick = { viewModel.closeTransparency() }) { Text("关闭") }
        }

        Text("AI 对你的理解", style = MaterialTheme.typography.labelLarge, color = onColor)
        Text(
            PdhTransparency.profileSummary(t.profile),
            style = MaterialTheme.typography.bodySmall,
            color = onColor,
        )

        Text("数据出境", style = MaterialTheme.typography.labelLarge, color = onColor)
        Text(
            PdhTransparency.egressSummary(t.egress),
            style = MaterialTheme.typography.bodySmall,
            color = onColor,
        )
        t.egress.take(8).forEach { e ->
            Text(
                "· ${e.category} → ${e.destination}(${e.tier})",
                style = MaterialTheme.typography.bodySmall,
                color = onColor,
            )
        }

        Text("AI 替你办过的事", style = MaterialTheme.typography.labelLarge, color = onColor)
        Text(
            PdhTransparency.actionSummary(t.actions),
            style = MaterialTheme.typography.bodySmall,
            color = onColor,
        )
        t.actions.take(8).forEach { a ->
            Text(
                "· ${a.action} → ${a.target}:${a.result}（${a.approvedBy}批）",
                style = MaterialTheme.typography.bodySmall,
                color = onColor,
            )
        }
    }
}

@Composable
private fun SourceCheckRow(source: String, checked: Boolean, onToggle: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Checkbox(checked = checked, onCheckedChange = { onToggle() })
        Text(PdhOnboarding.sourceLabel(source), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun OnboardingButtons(
    onSkip: () -> Unit,
    primaryText: String,
    primaryEnabled: Boolean,
    onPrimary: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        TextButton(onClick = onSkip) { Text("跳过") }
        Button(
            onClick = onPrimary,
            enabled = primaryEnabled,
            modifier = Modifier.padding(start = 8.dp),
        ) { Text(primaryText) }
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
        Role.DATA -> MaterialTheme.colorScheme.surface // unused: DATA → DataQuoteCard
        Role.VIEW -> MaterialTheme.colorScheme.surface // unused: VIEW → ResultViewCard
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

// §3.5.13 自学习纠正:已落库的 AI 回应 + 反馈页脚(👍/👎/纠正 → FeedbackSignal)。
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AssistantMessage(
    msg: PdhChatViewModel.ChatMessage,
    onThumbUp: () -> Unit,
    onThumbDown: () -> Unit,
    onCorrect: (String) -> Unit,
) {
    var correcting by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(12.dp),
            ) {
                MarkdownText(
                    markdown = msg.text,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    textColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        val given = msg.feedback
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onThumbUp, enabled = given == null) {
                Text(if (given == FeedbackKind.POSITIVE) "👍 已赞" else "👍")
            }
            TextButton(onClick = onThumbDown, enabled = given == null) {
                Text(if (given == FeedbackKind.NEGATIVE) "👎 已踩" else "👎")
            }
            TextButton(onClick = { correcting = !correcting }) {
                Text(if (given == FeedbackKind.CORRECTION) "已纠正" else "纠正")
            }
            if (given != null) {
                Text(
                    "已记录,以后按此调整",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                )
            }
        }
        if (correcting) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("纠正 AI 的理解…") },
                    maxLines = 3,
                )
                Button(
                    onClick = { onCorrect(text); text = ""; correcting = false },
                    enabled = text.isNotBlank(),
                ) { Text("提交") }
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

@Composable
private fun PermissionBanner(onGrant: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "采集联系人 / 本地文件需要权限，授予后可采集更完整的个人数据。",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            Button(onClick = onGrant) { Text("授予") }
        }
    }
}

// ── §3.5.12 对话内联结果视图:可信结构化结果的视图卡 ─────────────────────────

@Composable
private fun ResultViewCard(msg: PdhChatViewModel.ChatMessage, onToggle: () -> Unit) {
    val kindLabel = msg.viewKind?.let { PdhResultView.label(it) } ?: "结果"
    val lines = msg.text.split("\n")
    val collapsible = lines.size > 6 || msg.text.length > 400
    val shown = if (msg.collapsed && collapsible) lines.take(6).joinToString("\n") else msg.text
    Surface(
        // 可信视图卡:用填充式 tonal 卡,明显区别于 §3.5.11 的异色+边框"数据引用"。
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "📊 $kindLabel",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                shown + if (msg.collapsed && collapsible) "\n…" else "",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // §3.5.12 接线4:跳转完整浏览器 seam —— §9/Phase 6,暂置灰提示(诚实降级)。
                Text(
                    "→ 完整视图见数据浏览器(开发中)",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.6f),
                )
                if (collapsible) {
                    TextButton(onClick = onToggle) {
                        Text(if (msg.collapsed) "展开" else "收起")
                    }
                }
            }
        }
    }
}

// ── §3.5.11 不可信数据的视觉隔离:「数据引用」容器 ─────────────────────────

@Composable
private fun DataQuoteCard(msg: PdhChatViewModel.ChatMessage, onToggle: () -> Unit) {
    val lines = msg.text.split("\n")
    val collapsible = lines.size > 3 || msg.text.length > 240
    val shown = if (msg.collapsed && collapsible) lines.take(3).joinToString("\n") else msg.text
    Surface(
        // 异色 + 边框 + 等宽,与 AI 气泡(surfaceVariant 填充)截然不同 → 一眼是"数据"。
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)),
    ) {
        Column(
            modifier = Modifier.padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "🔖 来自 ${msg.source ?: "工具"} · 引用数据" +
                    if (msg.untrusted) "  ⚠ 被读取的内容,非 AI 判断" else "",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                // 等宽渲染,降低"像自然语言指令"的错觉;纯展示,无可点链接(不可执行)。
                text = shown + if (msg.collapsed && collapsible) "\n…" else "",
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (collapsible) {
                TextButton(onClick = onToggle) {
                    Text(if (msg.collapsed) "展开" else "收起")
                }
            }
        }
    }
}

// ── §3.5.9 三类信任卡(+ 计划卡)的内联渲染 ──────────────────────────────

@Composable
private fun TrustCardItem(card: TrustCard, viewModel: PdhChatViewModel, context: Context) {
    when (card) {
        is TrustCard.Guide -> GuideCard(
            card = card,
            onOpenApp = { link -> openDeepLink(context, link) },
            onDone = { viewModel.completeGuide(card.id) },
            onSkip = { viewModel.skipGuide(card.id) },
        )
        is TrustCard.Preview -> ApprovalCardView(
            title = "采集预览 · 即将入库",
            tool = card.tool,
            summary = card.summary,
            risk = card.risk,
            color = MaterialTheme.colorScheme.secondaryContainer,
            onColor = MaterialTheme.colorScheme.onSecondaryContainer,
            confirmLabel = "确认入库",
            denyLabel = "取消",
            onConfirm = { viewModel.resolveCard(card.id, true) },
            onDeny = { viewModel.resolveCard(card.id, false) },
        )
        is TrustCard.Approve -> ApprovalCardView(
            title = "需要确认 · 有副作用的操作",
            tool = card.tool,
            summary = card.summary,
            risk = card.risk,
            color = MaterialTheme.colorScheme.errorContainer,
            onColor = MaterialTheme.colorScheme.onErrorContainer,
            confirmLabel = "允许",
            denyLabel = "拒绝",
            onConfirm = { viewModel.resolveCard(card.id, true) },
            onDeny = { viewModel.resolveCard(card.id, false) },
        )
        is TrustCard.Transaction -> TransactionCard(card = card, viewModel = viewModel)
        is TrustCard.Backup -> BackupCard(card = card, viewModel = viewModel)
        is TrustCard.Restore -> RestoreCard(card = card, viewModel = viewModel)
        is TrustCard.Plan -> PlanCard(
            card = card,
            onApprove = { viewModel.resolvePlan("approve") },
            onReject = { viewModel.resolvePlan("reject") },
        )
    }
}

/** §3.5.17 最高风险事务须输入的确认词(防误触不可逆操作)。 */
private const val TXN_CONFIRM_WORD = "确认"

/**
 * §3.5.17 事务审批卡:不可逆真实世界副作用的"办事"最后一闸。分级样式 + dry-run 动作 +
 * 可撤销/不可逆提示 + 来源警示(§7.2 防 injection)+ 最高风险须输入确认词。
 * 回执/撤销窗口/执行器去重是 cc/FAMILY 集成层(§4/Phase 8),本卡只做审批前的精确确认。
 */
@Composable
private fun TransactionCard(card: TrustCard.Transaction, viewModel: PdhChatViewModel) {
    val container = when (card.risk) {
        TxnRisk.LOW -> MaterialTheme.colorScheme.secondaryContainer
        TxnRisk.MEDIUM -> MaterialTheme.colorScheme.tertiaryContainer
        TxnRisk.HIGH, TxnRisk.CRITICAL -> MaterialTheme.colorScheme.errorContainer
    }
    val onContainer = when (card.risk) {
        TxnRisk.LOW -> MaterialTheme.colorScheme.onSecondaryContainer
        TxnRisk.MEDIUM -> MaterialTheme.colorScheme.onTertiaryContainer
        TxnRisk.HIGH, TxnRisk.CRITICAL -> MaterialTheme.colorScheme.onErrorContainer
    }
    val riskLabel = when (card.risk) {
        TxnRisk.LOW -> "低风险"
        TxnRisk.MEDIUM -> "中风险"
        TxnRisk.HIGH -> "高风险"
        TxnRisk.CRITICAL -> "最高风险"
    }
    var confirmWord by remember(card.id) { mutableStateOf("") }
    val confirmOk = !card.needsConfirmWord || confirmWord.trim() == TXN_CONFIRM_WORD

    CardSurface(color = container) {
        Text("需要确认 · 事务($riskLabel)", style = MaterialTheme.typography.titleSmall, color = onContainer)
        // dry-run:展示将执行的确切动作(所见即所办)。
        Text(card.summary, style = MaterialTheme.typography.bodyMedium, color = onContainer)
        Text(
            if (card.reversible) "ℹ 此操作可在撤销窗口内撤回" else "⚠ 此操作不可撤销",
            style = MaterialTheme.typography.bodySmall,
            color = onContainer,
        )
        // §3.5.17 接线3:injection 最后一闸 —— 参数可能来自采集数据,请核对本意。
        if (card.sourceWarning) {
            Text(
                "⚠ 本轮处理过采集数据,请核对收件人/内容确是你的本意(防被采集内容操纵)。",
                style = MaterialTheme.typography.bodySmall,
                color = onContainer,
            )
        }
        if (card.needsConfirmWord) {
            OutlinedTextField(
                value = confirmWord,
                onValueChange = { confirmWord = it },
                singleLine = true,
                label = { Text("输入「$TXN_CONFIRM_WORD」以继续") },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { viewModel.resolveCard(card.id, false) }) { Text("拒绝") }
            Button(
                onClick = { viewModel.resolveCard(card.id, true) },
                enabled = confirmOk,
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("允许") }
        }
    }
}

@Composable
private fun CardSurface(color: Color, content: @Composable ColumnScope.() -> Unit) {
    Surface(color = color, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            content = content,
        )
    }
}

@Composable
private fun GuideCard(
    card: TrustCard.Guide,
    onOpenApp: (String) -> Unit,
    onDone: () -> Unit,
    onSkip: () -> Unit,
) {
    val onColor = MaterialTheme.colorScheme.onTertiaryContainer
    CardSurface(MaterialTheme.colorScheme.tertiaryContainer) {
        Text("需要你配合一步", style = MaterialTheme.typography.titleSmall, color = onColor)
        Text(card.instruction, style = MaterialTheme.typography.bodyMedium, color = onColor)
        card.reason?.let {
            Text("ⓘ $it", style = MaterialTheme.typography.bodySmall, color = onColor)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            card.deepLink?.let { link ->
                Button(onClick = { onOpenApp(link) }) { Text("打开 App") }
            }
            Button(onClick = onDone) { Text("我已完成") }
            TextButton(onClick = onSkip) { Text("跳过") }
        }
    }
}

@Composable
private fun ApprovalCardView(
    title: String,
    tool: String,
    summary: String,
    risk: String?,
    color: Color,
    onColor: Color,
    confirmLabel: String,
    denyLabel: String,
    onConfirm: () -> Unit,
    onDeny: () -> Unit,
) {
    CardSurface(color) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = onColor)
        if (summary.isNotBlank()) {
            Text(summary, style = MaterialTheme.typography.bodyMedium, color = onColor)
        }
        Text(
            "工具:$tool" + (risk?.takeIf { it.isNotBlank() }?.let { " · 风险:$it" } ?: ""),
            style = MaterialTheme.typography.bodySmall,
            color = onColor,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onConfirm) { Text(confirmLabel) }
            OutlinedButton(onClick = onDeny) { Text(denyLabel) }
        }
    }
}

@Composable
private fun PlanCard(card: TrustCard.Plan, onApprove: () -> Unit, onReject: () -> Unit) {
    val onColor = MaterialTheme.colorScheme.onSurfaceVariant
    CardSurface(MaterialTheme.colorScheme.surfaceVariant) {
        Text(
            "计划" + (card.phase.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
            style = MaterialTheme.typography.titleSmall,
            color = onColor,
        )
        card.items.forEachIndexed { i, t ->
            Text("${i + 1}. $t", style = MaterialTheme.typography.bodySmall, color = onColor)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onApprove) { Text("批准计划") }
            OutlinedButton(onClick = onReject) { Text("拒绝") }
        }
    }
}

/**
 * Open a 引导卡's target (§3.6 one-tap "打开 App"); degrade silently otherwise.
 * A bare package name (no "://") is launched via getLaunchIntentForPackage — the
 * robust way to bring the target app to the foreground so the user can log in;
 * a URI scheme falls back to ACTION_VIEW.
 */
private fun openDeepLink(context: Context, link: String) {
    try {
        val intent = if (!link.contains("://")) {
            context.packageManager.getLaunchIntentForPackage(link)
                ?: return // target app not installed → leave the text steps
        } else {
            android.content.Intent(
                android.content.Intent.ACTION_VIEW,
                android.net.Uri.parse(link),
            )
        }
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    } catch (_: Throwable) {
        // No matching app / malformed scheme → fall back to the text steps.
    }
}

/** Runtime permissions the data collectors benefit from (SDK-aware). */
private fun dataCollectionPermissions(): List<String> = buildList {
    add(Manifest.permission.READ_CONTACTS)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        add(Manifest.permission.READ_MEDIA_IMAGES)
        add(Manifest.permission.READ_MEDIA_VIDEO)
        add(Manifest.permission.READ_MEDIA_AUDIO)
    } else {
        @Suppress("DEPRECATION")
        add(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
}

/** Subset of [perms] not yet granted. */
private fun missingPermissions(context: Context, perms: List<String>): List<String> =
    perms.filter {
        ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
    }
