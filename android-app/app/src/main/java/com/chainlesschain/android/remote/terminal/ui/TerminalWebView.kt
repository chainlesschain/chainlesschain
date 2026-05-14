package com.chainlesschain.android.remote.terminal.ui

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import timber.log.Timber

/**
 * WebView + xterm.js renderer for the remote-terminal screen.
 *
 * Loads `file:///android_asset/terminal/xterm-shell.html`. The HTML
 * communicates with this Kotlin shell via a JavascriptInterface named
 * `TerminalBridge`. Kotlin pushes stdout into the WebView by calling
 * `evaluateJavascript("window.cc.onStdout(...)")` — string args are
 * encoded via [escapeJsString] to survive multi-line / control-char data.
 *
 * Lifecycle:
 *   1. Compose creates an instance via `AndroidView { TerminalWebView(ctx) }`
 *   2. Compose passes callbacks (onUserInput / onResize / onReady) via [bind]
 *   3. Caller can `pushStdout(data)` / `pushExit(...)` after onReady fires
 *   4. Compose's DisposableEffect calls [release] on tear-down
 */
@SuppressLint("SetJavaScriptEnabled")
class TerminalWebView(context: Context) : WebView(context) {

    interface Callbacks {
        fun onUserInput(data: String)
        fun onResize(cols: Int, rows: Int)
        fun onReady(cols: Int, rows: Int)
    }

    private var callbacks: Callbacks? = null
    private var jsReady = false
    // Outbox for stdout pushed before xterm-shell finishes initializing.
    private val preReadyOutbox = ArrayDeque<String>()

    init {
        settings.javaScriptEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.domStorageEnabled = true
        settings.useWideViewPort = false
        settings.loadWithOverviewMode = false
        // Disable zoom — terminal text scaling is xterm's job.
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false

        webViewClient = WebViewClient()
        addJavascriptInterface(Bridge(), "TerminalBridge")
    }

    fun bind(callbacks: Callbacks) {
        this.callbacks = callbacks
    }

    /** Load the bundled HTML — call once after [bind]. */
    fun loadShell() {
        loadUrl("file:///android_asset/terminal/xterm-shell.html")
    }

    fun pushStdout(data: String) {
        if (!jsReady) {
            preReadyOutbox.add(data)
            return
        }
        evaluateJavascript("window.cc && window.cc.onStdout('${escapeJsString(data)}');", null)
    }

    fun pushExit(exitCode: Int?, signal: String?) {
        val payload = StringBuilder("{")
        payload.append("exitCode:")
        payload.append(exitCode ?: "null")
        if (signal != null) {
            payload.append(",signal:'").append(escapeJsString(signal)).append("'")
        } else {
            payload.append(",signal:null")
        }
        payload.append("}")
        evaluateJavascript("window.cc && window.cc.onExit($payload);", null)
    }

    fun writeBanner(text: String) {
        evaluateJavascript("window.cc && window.cc.writeln('${escapeJsString(text)}');", null)
    }

    fun sendKey(seq: String) {
        // Drive xterm.onData by injecting into TerminalBridge.onUserInput
        // — saves a round-trip and keeps modifier/cursor key semantics
        // exactly the same as in-pane typing.
        callbacks?.onUserInput(seq)
    }

    fun release() {
        try {
            stopLoading()
            removeJavascriptInterface("TerminalBridge")
            loadUrl("about:blank")
            destroy()
        } catch (e: Exception) {
            Timber.w(e, "[TerminalWebView] release failed")
        }
    }

    private inner class Bridge {
        @JavascriptInterface
        fun onUserInput(data: String) {
            callbacks?.onUserInput(data)
        }

        @JavascriptInterface
        fun onResize(cols: Int, rows: Int) {
            callbacks?.onResize(cols, rows)
        }

        @JavascriptInterface
        fun onReady(cols: Int, rows: Int) {
            jsReady = true
            // Drain anything that arrived before xterm-shell finished init.
            post {
                while (preReadyOutbox.isNotEmpty()) {
                    val pending = preReadyOutbox.removeFirst()
                    evaluateJavascript(
                        "window.cc && window.cc.onStdout('${escapeJsString(pending)}');",
                        null,
                    )
                }
            }
            callbacks?.onReady(cols, rows)
        }
    }

    companion object {
        /**
         * Encode an arbitrary UTF-8 string so it survives interpolation
         * inside single-quoted JS literal: escape backslashes, single
         * quotes, line terminators, and the rare control characters that
         * break some WebView builds. Multi-byte CJK / emoji pass through
         * unchanged — WebView's evaluateJavascript is UTF-16 aware.
         */
        fun escapeJsString(s: String): String {
            val sb = StringBuilder(s.length + 16)
            for (c in s) {
                when (c) {
                    '\\' -> sb.append("\\\\")
                    '\'' -> sb.append("\\'")
                    '\n' -> sb.append("\\n")
                    '\r' -> sb.append("\\r")
                    ' ' -> sb.append("\\u2028")
                    ' ' -> sb.append("\\u2029")
                    else -> sb.append(c)
                }
            }
            return sb.toString()
        }
    }
}
