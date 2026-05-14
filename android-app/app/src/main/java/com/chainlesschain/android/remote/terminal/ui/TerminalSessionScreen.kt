package com.chainlesschain.android.remote.terminal.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * 单 session 全屏 — WebView 渲染 xterm.js，下方 softkey toolbar
 * (Ctrl/Tab/Esc/方向键/Ctrl+C) 帮助移动键盘上敲 shell 控制字符。
 *
 * 后退按钮**不**关闭 session（PtyManager 会保留 24h 直到空闲 kill 或用户
 * 主动关闭），允许下次重连补帧。右上 X 按钮才是真正关闭 session。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalSessionScreen(
    onBack: () -> Unit,
    viewModel: TerminalSessionViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var webView by remember { mutableStateOf<TerminalWebView?>(null) }
    var ctrlSticky by remember { mutableStateOf(false) }

    // Subscribe to stdoutToUi / exitToUi and pipe into WebView.
    LaunchedEffect(viewModel) {
        viewModel.stdoutToUi.collect { data ->
            webView?.pushStdout(data)
        }
    }
    LaunchedEffect(viewModel) {
        viewModel.exitToUi.collect { evt ->
            webView?.pushExit(evt.exitCode, evt.signal)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("终端会话")
                        Text(
                            viewModel.sessionId.take(8) + "…  " + if (state.alive) "活跃" else "已退出",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = {
                        viewModel.closeSession()
                        onBack()
                    }) {
                        Icon(Icons.Default.Close, contentDescription = "关闭并退出")
                    }
                },
            )
        },
        bottomBar = {
            SoftKeyToolbar(
                ctrlSticky = ctrlSticky,
                onToggleCtrl = { ctrlSticky = !ctrlSticky },
                onSendKey = { seq ->
                    val payload = if (ctrlSticky) "" else seq
                    // Reset sticky after Ctrl+key combination.
                    if (ctrlSticky && seq.length == 1) {
                        val c = seq[0].uppercaseChar()
                        val code = (c.code - 'A'.code + 1).coerceAtLeast(0)
                        webView?.sendKey(code.toChar().toString())
                        ctrlSticky = false
                    } else {
                        webView?.sendKey(seq)
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            state.error?.let { err ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                ) {
                    Row(
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        modifier = Modifier.padding(12.dp),
                    ) {
                        Text(
                            err,
                            modifier = Modifier.weight(1f),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        TextButton(onClick = { viewModel.clearError() }) { Text("关闭") }
                    }
                }
            }

            // The actual xterm.js WebView.
            AndroidView(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                factory = {
                    TerminalWebView(context).apply {
                        bind(
                            object : TerminalWebView.Callbacks {
                                override fun onUserInput(data: String) = viewModel.sendInput(data)
                                override fun onResize(cols: Int, rows: Int) =
                                    viewModel.sendResize(cols, rows)
                                override fun onReady(cols: Int, rows: Int) {
                                    // First fit complete; tell desktop the true dims.
                                    viewModel.sendResize(cols, rows)
                                }
                            },
                        )
                        loadShell()
                        webView = this
                    }
                },
                onRelease = {
                    it.release()
                    webView = null
                },
            )
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            webView?.release()
            webView = null
        }
    }
}

@Composable
private fun SoftKeyToolbar(
    ctrlSticky: Boolean,
    onToggleCtrl: () -> Unit,
    onSendKey: (String) -> Unit,
) {
    Surface(
        tonalElevation = 2.dp,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SoftKey(
                label = "Ctrl",
                active = ctrlSticky,
                onClick = onToggleCtrl,
            )
            SoftKey(label = "Tab", onClick = { onSendKey("\t") })
            SoftKey(label = "Esc", onClick = { onSendKey("") })
            SoftKey(label = "↑", onClick = { onSendKey("[A") })
            SoftKey(label = "↓", onClick = { onSendKey("[B") })
            SoftKey(label = "←", onClick = { onSendKey("[D") })
            SoftKey(label = "→", onClick = { onSendKey("[C") })
            // Ctrl+C as a quick shortcut (independent of sticky Ctrl).
            SoftKey(label = "^C", onClick = { onSendKey("") })
            SoftKey(label = "^D", onClick = { onSendKey("") })
        }
    }
}

@Composable
private fun SoftKey(
    label: String,
    active: Boolean = false,
    onClick: () -> Unit,
) {
    val container =
        if (active) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.surface
    val content =
        if (active) MaterialTheme.colorScheme.onPrimary
        else MaterialTheme.colorScheme.onSurface
    FilterChip(
        selected = active,
        onClick = onClick,
        label = { Text(label, style = MaterialTheme.typography.bodySmall) },
        shape = RoundedCornerShape(4.dp),
        colors = FilterChipDefaults.filterChipColors(
            containerColor = container,
            labelColor = content,
            selectedContainerColor = container,
            selectedLabelColor = content,
        ),
    )
}
