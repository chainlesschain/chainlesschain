package com.chainlesschain.android.feature.localterminal.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Phase 3.2 — Compose surface for the local terminal.
 *
 * Pipeline:
 *
 *   PTY master (LocalPtyClient.stdoutFlow)
 *       └─ LaunchedEffect collects each chunk → LocalTerminalWebView.pushStdout
 *          ↓
 *       xterm.js render
 *          ↑
 *   xterm.js onData → LocalTerminalBridge.onUserInput → vm.writeStdin
 *
 *   xterm.js ResizeObserver → LocalTerminalBridge.onResize → vm.resize
 *
 * State stays in the ViewModel + WebView; the Composable hoists no terminal
 * state so the underlying mksh session survives config changes (rotation).
 */
@Composable
fun LocalTerminalScreen(
    viewModel: LocalSessionViewModel,
    modifier: Modifier = Modifier,
) {
    // Trigger bootstrap + start mksh exactly once per VM instance.
    LaunchedEffect(viewModel) { viewModel.boot() }

    val state by viewModel.state.collectAsState()

    // Holder for the WebView instance the AndroidView factory creates.
    // Captured here so the stdout-subscription LaunchedEffect can route
    // chunks into it. mutableStateOf returns a snapshot-aware container,
    // safe for cross-coroutine read.
    val webViewHolder = remember { mutableStateOf<LocalTerminalWebView?>(null) }

    // Subscribe to stdout — when the WebView is created, start forwarding.
    LaunchedEffect(viewModel) {
        viewModel.stdoutFlow.collect { chunk ->
            webViewHolder.value?.pushStdout(String(chunk, Charsets.UTF_8))
        }
    }
    LaunchedEffect(viewModel) {
        viewModel.exitFlow.collect { code ->
            webViewHolder.value?.pushExit(exitCode = code, signal = null)
        }
    }

    Column(modifier = modifier.fillMaxSize().background(Color(0xFF1E1E1E))) {
        StatusBanner(state)
        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    LocalTerminalWebView(ctx).apply {
                        bind(object : LocalTerminalWebView.Callbacks {
                            override fun onUserInput(data: String) {
                                viewModel.writeStdin(data.toByteArray(Charsets.UTF_8))
                            }
                            override fun onResize(cols: Int, rows: Int) {
                                viewModel.resize(cols = cols, rows = rows)
                            }
                            override fun onReady(cols: Int, rows: Int) {
                                viewModel.resize(cols = cols, rows = rows)
                            }
                        })
                        loadShell()
                        webViewHolder.value = this
                    }
                },
            )
        }
    }
}

@Composable
private fun StatusBanner(state: LocalSessionViewModel.SessionState) {
    val color = when (state.status) {
        LocalSessionViewModel.Status.RUNNING -> Color(0xFF66BB6A)
        LocalSessionViewModel.Status.EXITED -> Color(0xFFFFA726)
        LocalSessionViewModel.Status.ERROR -> Color(0xFFEF5350)
        LocalSessionViewModel.Status.INITIALIZING -> Color(0xFFB0BEC5)
    }
    val text = when (state.status) {
        LocalSessionViewModel.Status.INITIALIZING ->
            "Bootstrapping… ${state.banner}"
        LocalSessionViewModel.Status.RUNNING -> "mksh running"
        LocalSessionViewModel.Status.EXITED ->
            "Session exited (code=${state.exitCode ?: "?"})"
        LocalSessionViewModel.Status.ERROR ->
            "Error: ${state.errorMessage ?: "unknown"}"
    }
    Text(
        text = text,
        color = color,
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
    )
}
