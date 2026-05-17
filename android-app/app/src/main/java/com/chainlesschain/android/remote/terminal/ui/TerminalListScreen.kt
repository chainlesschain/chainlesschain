package com.chainlesschain.android.remote.terminal.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * 远程终端首屏 — 列出桌面端当前活跃 sessions，提供"+ 新会话"chip。点
 * 单 session 跳 [TerminalSessionScreen]。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalListScreen(
    pcPeerId: String,
    onBack: () -> Unit,
    onOpenSession: (sessionId: String) -> Unit,
    initialCwd: String? = null,
    viewModel: TerminalListViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val dcReady by viewModel.dataChannelReady.collectAsState()
    var showCreateDialog by remember { mutableStateOf(false) }
    var autoCreated by remember { mutableStateOf(false) }

    // Sub-phase 5-6 (2026-05-17): 项目详情页 Terminal icon 入口传 initialCwd
    // → 进 list 屏自动创建一个落 cwd 的 session，省点 "新会话 → 选 shell"。
    // 双 guard: dcReady (P2P 直连可走) 或 至少 list 加载完（fallback signaling）。
    // autoCreated 防 LaunchedEffect 重入。
    LaunchedEffect(initialCwd, state.loading) {
        if (!autoCreated && !initialCwd.isNullOrBlank() && !state.creating && !state.loading) {
            autoCreated = true
            viewModel.createSession(shell = "pwsh", cwd = initialCwd)
        }
    }

    // Plan A.1 v5.0.3.53-fix7: 监听 createSession 成功后填充的 lastCreatedId，
    // 立即 navigate 到 SessionScreen 让用户能看到新会话的 WebView。
    // 真机 E2E 发现：之前 Dialog 关掉但不跳转 → 用户停 List 屏看不到任何
    // 终端输出 → 误以为"打不开"。消费一次即清，避免重新进 List 时重复跳转。
    LaunchedEffect(state.lastCreatedId) {
        val newId = state.lastCreatedId
        if (!newId.isNullOrBlank()) {
            onOpenSession(newId)
            viewModel.consumeLastCreatedId()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("远程终端") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                text = { Text("新会话") },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                onClick = { showCreateDialog = true },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(16.dp)
                .fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "桌面: ${pcPeerId.take(16)}…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
                // Plan A.1 — 显示传输路径标识。dcReady=true 时是 P2P 直连，否则是
                // 信令转发（4 跳，间歇 NAT idle 风险）。颜色 hint: 绿=DC, 黄=relay。
                AssistChip(
                    onClick = {},
                    enabled = false,
                    label = {
                        Text(
                            if (dcReady) "P2P 直连" else "中继路径",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    },
                    colors = AssistChipDefaults.assistChipColors(
                        disabledContainerColor = if (dcReady) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            MaterialTheme.colorScheme.tertiaryContainer
                        },
                        disabledLabelColor = if (dcReady) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onTertiaryContainer
                        },
                    ),
                )
            }
            state.error?.let { err ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Text(err, modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }

            if (state.loading && state.sessions.isEmpty()) {
                CircularProgressIndicator()
            } else if (state.sessions.isEmpty()) {
                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(
                        "暂无活跃会话\n点击 '新会话' 创建第一个终端",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.sessions, key = { it.id }) { session ->
                        SessionRow(
                            session = session,
                            onClick = { onOpenSession(session.id) },
                            onClose = { viewModel.closeSession(session.id) },
                        )
                    }
                }
            }
        }
    }

    if (showCreateDialog) {
        CreateSessionDialog(
            onDismiss = { showCreateDialog = false },
            onCreate = { shell ->
                viewModel.createSession(shell)
                showCreateDialog = false
            },
        )
    }
}

@Composable
private fun SessionRow(
    session: com.chainlesschain.android.remote.terminal.TerminalRpcClient.SessionRow,
    onClick: () -> Unit,
    onClose: () -> Unit,
) {
    Card(onClick = onClick) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        session.shell,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Spacer(Modifier.width(8.dp))
                    AssistChip(
                        onClick = {},
                        label = { Text(if (session.alive) "活跃" else "已退出") },
                        enabled = false,
                    )
                }
                Text(
                    session.id.take(16) + "…  seq " + session.lastSeq,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                    fontFamily = FontFamily.Monospace,
                )
                session.cwd?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                }
            }
            IconButton(onClick = onClose) {
                Icon(Icons.Default.Close, contentDescription = "关闭")
            }
        }
    }
}

@Composable
private fun CreateSessionDialog(
    onDismiss: () -> Unit,
    onCreate: (shell: String) -> Unit,
) {
    val shells = listOf("pwsh", "cmd", "bash", "wsl")
    var selected by remember { mutableStateOf("pwsh") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建终端会话") },
        text = {
            Column {
                Text("选择 shell：", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                shells.forEach { shell ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        RadioButton(selected = shell == selected, onClick = { selected = shell })
                        Text(shell, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(selected) }) { Text("创建") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}
