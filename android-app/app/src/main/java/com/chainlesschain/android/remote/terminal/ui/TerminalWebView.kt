package com.chainlesschain.android.remote.terminal.ui

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
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
        // Plan A.1 v5.0.3.53-fix11 真因 — Compose AndroidView 默认 WRAP_CONTENT。
        // WebView 用 wrap_content 高度时，会问 HTML body "你多高"，但 body
        // 是 height:100% → 依赖父级（WebView）高度 → 0 → wrap_content=0 →
        // 死锁，WebView 永远 0 高。fix10 logcat 实测 host size=407×0（width
        // 已分配，height 一直 0），xterm.fit() 永远 skip → 用户看到全黑。
        // 强制 MATCH_PARENT × MATCH_PARENT 让 AndroidView 容器（Column
        // weight=1f）决定高度，HTML body height:100% 才有意义。
        layoutParams = android.view.ViewGroup.LayoutParams(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
        )
        settings.javaScriptEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.domStorageEnabled = true
        settings.useWideViewPort = false
        settings.loadWithOverviewMode = false
        // Disable zoom — terminal text scaling is xterm's job.
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false

        // Plan A.1 v5.0.3.53-fix8 真机 E2E 诊断 — WebView 黑屏没 stdout 显示
        // 时把 xterm-shell.html 加载链路所有失败点（console.log、page-finished、
        // resource error）映射到 logcat，定位是 file:// 访问被 block / xterm.js
        // 没加载 / TerminalBridge.onReady 没调 还是其它。
        setBackgroundColor(android.graphics.Color.parseColor("#1e1e1e"))
        webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                Timber.i("[TerminalWebView] onPageStarted url=%s", url)
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                Timber.i("[TerminalWebView] onPageFinished url=%s jsReady=%s outbox=%d", url, jsReady, preReadyOutbox.size)
            }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                Timber.w("[TerminalWebView] onReceivedError url=%s code=%d desc=%s",
                    request?.url, error?.errorCode ?: -1, error?.description)
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage?): Boolean {
                Timber.d("[TerminalWebView][console] %s:%d %s",
                    msg?.sourceId() ?: "?", msg?.lineNumber() ?: -1, msg?.message() ?: "")
                return true
            }
        }
        addJavascriptInterface(Bridge(), "TerminalBridge")
    }

    fun bind(callbacks: Callbacks) {
        this.callbacks = callbacks
    }

    /** Load the bundled HTML — call once after [bind]. */
    fun loadShell() {
        Timber.i("[TerminalWebView] loadShell → file:///android_asset/terminal/xterm-shell.html")
        loadUrl("file:///android_asset/terminal/xterm-shell.html")
    }

    fun pushStdout(data: String) {
        if (!jsReady) {
            preReadyOutbox.add(data)
            Timber.d("[TerminalWebView] pushStdout outbox (jsReady=false) len=%d total-outbox=%d", data.length, preReadyOutbox.size)
            return
        }
        Timber.d("[TerminalWebView] pushStdout → JS evaluateJavascript len=%d", data.length)
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
            Timber.i("[TerminalWebView] ✓ xterm onReady cols=%d rows=%d, draining %d outbox", cols, rows, preReadyOutbox.size)
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
