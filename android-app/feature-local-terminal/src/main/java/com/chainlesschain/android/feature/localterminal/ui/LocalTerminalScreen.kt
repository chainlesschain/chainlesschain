package com.chainlesschain.android.feature.localterminal.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF1E1E1E))
            // Phase 4 — status bar + nav bar would otherwise overlap our
            // banner and the bottom of the xterm grid. AndroidView WebView
            // doesn't honor Compose insets automatically; we pad the
            // wrapping Column instead.
            .padding(WindowInsets.systemBars.asPaddingValues())
    ) {
        StatusBanner(state)
        // Crucial: AndroidView with weight(1f).fillMaxWidth() so the WebView
        // receives a finite non-zero size at first layout pass. Wrapping in
        // a Box(fillMaxSize) inside a non-weighted Column gives the WebView
        // a 0×0 measure → xterm.js fit() bails → terminal renders as a thin
        // cursor stripe (Plan A.1 v5.0.3.53-fix11 lesson, now in LocalTerminal).
        AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth(),
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

        // Soft-keyboard escape-hatch toolbar. Android's on-screen IME has
        // no Ctrl key, so pty programs that need SIGINT (long-running `cc ui`,
        // `cat /dev/zero`, etc) become un-stoppable. This row sends the raw
        // escape sequences directly into stdin, bypassing the keyboard.
        KeyToolbar { bytes -> viewModel.writeStdin(bytes) }
    }
}

/** Common control / nav keys missing from the soft IME. Each button writes
 *  the literal escape sequence onto pty stdin. */
@Composable
private fun KeyToolbar(send: (ByteArray) -> Unit) {
    val scroll = rememberScrollState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF2A2A2A))
            .padding(horizontal = 4.dp, vertical = 4.dp)
            .horizontalScroll(scroll),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // Ctrl-C — by far the most-asked-for. Sends SIGINT to foreground pgrp.
        ToolKey(label = "^C") { send(byteArrayOf(0x03)) }
        // Ctrl-D — EOF / exit interactive shell.
        ToolKey(label = "^D") { send(byteArrayOf(0x04)) }
        // Ctrl-Z — suspend foreground job.
        ToolKey(label = "^Z") { send(byteArrayOf(0x1A)) }
        // Ctrl-L — clear screen (mksh re-prints prompt).
        ToolKey(label = "^L") { send(byteArrayOf(0x0C)) }
        ToolKey(label = "Esc") { send(byteArrayOf(0x1B)) }
        ToolKey(label = "Tab") { send(byteArrayOf(0x09)) }
        // CSI arrows: ESC [ A/B/C/D
        ToolKey(label = "↑") { send(byteArrayOf(0x1B, 0x5B, 0x41)) }
        ToolKey(label = "↓") { send(byteArrayOf(0x1B, 0x5B, 0x42)) }
        ToolKey(label = "←") { send(byteArrayOf(0x1B, 0x5B, 0x44)) }
        ToolKey(label = "→") { send(byteArrayOf(0x1B, 0x5B, 0x43)) }
        // Home / End — useful for long lines.
        ToolKey(label = "Home") { send(byteArrayOf(0x1B, 0x5B, 0x48)) }
        ToolKey(label = "End") { send(byteArrayOf(0x1B, 0x5B, 0x46)) }
        // PageUp / PageDown — scroll mksh history-search etc.
        ToolKey(label = "PgUp") { send(byteArrayOf(0x1B, 0x5B, 0x35, 0x7E)) }
        ToolKey(label = "PgDn") { send(byteArrayOf(0x1B, 0x5B, 0x36, 0x7E)) }
    }
}

@Composable
private fun ToolKey(label: String, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        shape = RoundedCornerShape(6.dp),
        modifier = Modifier.defaultMinSize(minWidth = 40.dp, minHeight = 34.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            horizontal = 8.dp,
            vertical = 2.dp,
        ),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = Color(0xFF3A3A3A),
            contentColor = Color(0xFFE0E0E0),
        ),
    ) {
        Text(
            text = label,
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
        )
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
