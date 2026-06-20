package com.chainlesschain.android.presentation.screens.pdh

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.core.ui.components.MarkdownText
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
    val listState = rememberLazyListState()

    // Auto-scroll to the newest line (messages + streaming bubble + trust cards).
    LaunchedEffect(state.messages.size, state.streamingText, state.pendingCards.size) {
        val total = state.messages.size +
            (if (state.streamingText.isNotEmpty()) 1 else 0) +
            state.pendingCards.size
        if (total > 0) listState.animateScrollToItem(total - 1)
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

            if (missingPerms.isNotEmpty()) {
                PermissionBanner(
                    onGrant = { permLauncher.launch(missingPerms.toTypedArray()) },
                )
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
                // §3.5.9 内联信任卡(引导/预览/审批/计划)。
                items(state.pendingCards, key = { it.id }) { card ->
                    TrustCardItem(card = card, viewModel = viewModel, context = context)
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
        is TrustCard.Plan -> PlanCard(
            card = card,
            onApprove = { viewModel.resolvePlan("approve") },
            onReject = { viewModel.resolvePlan("reject") },
        )
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

/** Open a deepLink (Android intent) for a 引导卡; degrade silently if no app/bad scheme. */
private fun openDeepLink(context: Context, link: String) {
    try {
        val intent = android.content.Intent(
            android.content.Intent.ACTION_VIEW,
            android.net.Uri.parse(link),
        ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
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
