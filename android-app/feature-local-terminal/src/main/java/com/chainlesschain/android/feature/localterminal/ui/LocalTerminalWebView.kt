package com.chainlesschain.android.feature.localterminal.ui

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
 * WebView + xterm.js renderer for the **local** terminal screen.
 *
 * Port of `:app/.../remote/terminal/ui/TerminalWebView.kt` adapted for the
 * `feature-local-terminal` module. Differs only in:
 *
 *  - JavascriptInterface name `LocalTerminalBridge` (vs `TerminalBridge`)
 *    so the two WebView wrappers coexist if both are loaded in the same
 *    process (e.g. Phase 4 puts a Local tab next to the Remote tab).
 *  - Uses the assets/terminal/ bundle vendored under this module's own
 *    src/main/assets (independent from :app's copy; keep in sync manually
 *    when xterm.js is updated — see Phase 3 design note in the doc).
 *  - Tagged "LocalTerminalWebView" in Timber so device logs are easy to
 *    triage when both panels are running.
 *
 * Kotlin → JS : window.cc.onStdout(data)
 * JS → Kotlin : LocalTerminalBridge.onUserInput(data) /
 *               LocalTerminalBridge.onResize(cols, rows) /
 *               LocalTerminalBridge.onReady(cols, rows)
 */
@SuppressLint("SetJavaScriptEnabled")
class LocalTerminalWebView(context: Context) : WebView(context) {

    interface Callbacks {
        fun onUserInput(data: String)
        fun onResize(cols: Int, rows: Int)
        fun onReady(cols: Int, rows: Int)
    }

    private var callbacks: Callbacks? = null
    private var jsReady = false
    private val preReadyOutbox = ArrayDeque<String>()

    init {
        // MATCH_PARENT × MATCH_PARENT — wrap_content deadlocks against
        // html.body{height:100%} (parent height = 0 ⇨ wrap_content = 0).
        // Plan A.1 fix11 lesson; same constraint applies here.
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
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false

        setBackgroundColor(android.graphics.Color.parseColor("#1e1e1e"))
        webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                Timber.i("[LocalTerminalWebView] onPageStarted url=%s", url)
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                Timber.i(
                    "[LocalTerminalWebView] onPageFinished url=%s jsReady=%s outbox=%d",
                    url, jsReady, preReadyOutbox.size,
                )
            }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                Timber.w(
                    "[LocalTerminalWebView] onReceivedError url=%s code=%d desc=%s",
                    request?.url, error?.errorCode ?: -1, error?.description,
                )
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage?): Boolean {
                Timber.d(
                    "[LocalTerminalWebView][console] %s:%d %s",
                    msg?.sourceId() ?: "?", msg?.lineNumber() ?: -1, msg?.message() ?: "",
                )
                return true
            }
        }
        addJavascriptInterface(Bridge(), "LocalTerminalBridge")
    }

    fun bind(callbacks: Callbacks) {
        this.callbacks = callbacks
    }

    /** Load the bundled HTML — call once after [bind]. The HTML calls
     *  `LocalTerminalBridge.onReady` once xterm has initialised.
     *
     *  Asset path is `local-terminal/` (not `terminal/`) so that AGP's
     *  asset merger doesn't let `:app`'s legacy `assets/terminal/xterm-shell.html`
     *  (which uses the `TerminalBridge` JavascriptInterface name) override
     *  our `LocalTerminalBridge`-bound copy. Phase 4 real-device trap. */
    fun loadShell() {
        Timber.i("[LocalTerminalWebView] loadShell → file:///android_asset/local-terminal/xterm-shell.html")
        loadUrl("file:///android_asset/local-terminal/xterm-shell.html")
    }

    /** Push stdout bytes (decoded as UTF-8) into the terminal renderer. */
    fun pushStdout(data: String) {
        if (!jsReady) {
            preReadyOutbox.add(data)
            return
        }
        evaluateJavascript("window.cc && window.cc.onStdout('${escapeJsString(data)}');", null)
    }

    fun pushExit(exitCode: Int?, signal: String?) {
        val payload = StringBuilder("{")
        payload.append("exitCode:").append(exitCode ?: "null")
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

    /** Drive xterm.onData by injecting into LocalTerminalBridge.onUserInput
     *  — keeps modifier/cursor key semantics identical between in-pane
     *  typing and external IME-driven keypresses. */
    fun sendKey(seq: String) {
        callbacks?.onUserInput(seq)
    }

    fun release() {
        try {
            stopLoading()
            removeJavascriptInterface("LocalTerminalBridge")
            loadUrl("about:blank")
            destroy()
        } catch (e: Exception) {
            Timber.w(e, "[LocalTerminalWebView] release failed")
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
            Timber.i(
                "[LocalTerminalWebView] ✓ xterm onReady cols=%d rows=%d (draining %d outbox)",
                cols, rows, preReadyOutbox.size,
            )
            jsReady = true
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
         * Encode an arbitrary string so it survives interpolation inside a
         * single-quoted JS literal. Escapes backslash / single-quote / line
         * terminators / U+2028 / U+2029 (JS string-literal forbidden).
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
