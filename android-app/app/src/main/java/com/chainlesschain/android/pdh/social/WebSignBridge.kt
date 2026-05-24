package com.chainlesschain.android.pdh.social

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import timber.log.Timber

/**
 * §A8 v0.3 — Abstract base for "run the platform's own signing JS in a hidden
 * WebView" providers. Subclasses implement [homepageUrl], [cookieDomain] and
 * [buildSignScript] — base class handles WebView lifecycle, cookie injection,
 * `evaluateJavascript` ↔ suspend bridging, mutex-serialized JS execution.
 *
 * Lifecycle:
 *  - First [warmUp] call: creates a [WebView] on the Main thread, sets up a
 *    [WebViewClient] that completes [readySignal] on `onPageFinished`, injects
 *    every `name=value` pair from the captured cookie into [CookieManager]
 *    against [cookieDomain], then calls `webView.loadUrl(homepageUrl)`. We
 *    await `onPageFinished` + an extra [postLoadDelayMs] grace so the
 *    platform's anti-bot SDK (acrawler.js / mssdk.js / NS_sig3) has time to
 *    finish its async init (these SDKs typically chain XHRs + register
 *    setTimeout callbacks after `onPageFinished` to set fingerprint state).
 *  - Subsequent [signUrl] calls: serialize through [evalMutex], build the JS
 *    via [buildSignScript], call `evaluateJavascript`, await callback,
 *    unwrap the JSON-encoded string the WebView returns.
 *  - [shutdown]: post `destroy()` on Main thread, clear state.
 *
 * Why a hidden WebView and not direct OkHttp + Kotlin signing:
 *  - acrawler.js / mssdk.js / NS_sig3 all rotate their function names + algos
 *    every 4-8 weeks. A pure-Kotlin port would break monthly; running the
 *    platform's own JS means we ride whatever the live site uses today.
 *  - The JS reads navigator/window state that we'd otherwise have to fake
 *    (Battery API, AudioContext fingerprint, Canvas 2D draw). The WebView
 *    provides all of those for free.
 *
 * Concurrency: [evalMutex] serialises every JS eval through Main thread. The
 * collector runs fetchFeed/Comments/Search sequentially anyway (to avoid
 * tripping the anti-bot's per-host rate limit), so the serialization is not
 * a throughput regression — it's defence-in-depth against signing-state
 * races that the platform SDKs are not designed to handle.
 *
 * Memory: a hidden WebView holds ~30-50MB of JS heap. The collector calls
 * [shutdown] at end-of-snapshot. If the user re-syncs immediately, we pay
 * the warm-up cost again (~3-5s); cheaper than keeping the WebView alive
 * forever and leaking it across configuration changes.
 */
abstract class WebSignBridge(
    protected val context: Context,
) : SignProvider {

    /** Platform homepage to load so the signing SDK initializes. */
    protected abstract val homepageUrl: String

    /**
     * Cookie domain to inject the captured cookie under. Must match what
     * the platform sets in production (e.g. ".toutiao.com", not just
     * "toutiao.com" — leading dot enables cross-subdomain matching).
     */
    protected abstract val cookieDomain: String

    /**
     * Build the JS expression that returns the signed query string fragment
     * (e.g. "_signature=abc...") or `null` on failure. Subclasses are
     * expected to probe multiple candidate function names because the
     * platforms rotate the public global the signing JS attaches to.
     *
     * The JS MUST evaluate to a string or null — wrap in
     * `JSON.stringify(...)` if returning an object so the bridge can decode.
     */
    protected abstract fun buildSignScript(rawUrl: String, purpose: String): String

    /** Extra wait after `onPageFinished` for async SDK init. */
    protected open val postLoadDelayMs: Long = 2000L

    /** Per-call timeout for the entire signUrl operation (warm-up + eval). */
    protected open val signTimeoutMs: Long = 8000L

    @Volatile private var webView: WebView? = null
    @Volatile private var ready: Boolean = false
    @Volatile private var warmCookie: String? = null
    private val warmMutex = Mutex()
    private val evalMutex = Mutex()

    @SuppressLint("SetJavaScriptEnabled")
    override suspend fun warmUp(cookie: String): Boolean {
        if (ready && warmCookie == cookie) return true
        return warmMutex.withLock {
            if (ready && warmCookie == cookie) return@withLock true
            // If cookie changed (re-login), reset.
            if (ready && warmCookie != cookie) {
                withContext(Dispatchers.Main) { destroyWebView() }
                ready = false
            }
            val deferred = CompletableDeferred<Boolean>()
            withContext(Dispatchers.Main) {
                try {
                    val wv = WebView(context)
                    wv.settings.javaScriptEnabled = true
                    wv.settings.userAgentString = DESKTOP_CHROME_UA
                    wv.settings.domStorageEnabled = true
                    // Some platforms 412 if cache is missing — let the
                    // WebView's default disk cache absorb a single load.
                    wv.settings.cacheMode = WebSettings.LOAD_DEFAULT
                    // Inject cookies before load so the platform's gating
                    // JS sees a logged-in jar from the first request.
                    injectCookies(cookie)
                    wv.webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            // Don't complete here — wait extra grace for
                            // async SDK init. Coroutine below handles delay.
                            if (!deferred.isCompleted) {
                                deferred.complete(true)
                            }
                        }
                    }
                    webView = wv
                    wv.loadUrl(homepageUrl)
                } catch (t: Throwable) {
                    Timber.w(t, "WebSignBridge: warmUp WebView create failed")
                    deferred.complete(false)
                }
            }
            val loaded = withTimeoutOrNull(signTimeoutMs) { deferred.await() } ?: false
            if (!loaded) {
                Timber.w("WebSignBridge: warmUp timed out (%dms) on %s", signTimeoutMs, homepageUrl)
                withContext(Dispatchers.Main) { destroyWebView() }
                return@withLock false
            }
            // Grace period for async SDK init AFTER onPageFinished.
            kotlinx.coroutines.delay(postLoadDelayMs)
            ready = true
            warmCookie = cookie
            true
        }
    }

    override suspend fun signUrl(rawUrl: okhttp3.HttpUrl, purpose: String): okhttp3.HttpUrl? {
        if (!ready) {
            Timber.w("WebSignBridge.signUrl called before warmUp — call warmUp(cookie) first")
            return null
        }
        val signed = withTimeoutOrNull(signTimeoutMs) {
            evalMutex.withLock {
                evalSignFragment(rawUrl.toString(), purpose)
            }
        }
        if (signed.isNullOrBlank()) return null
        return appendSignFragment(rawUrl, signed)
    }

    private suspend fun evalSignFragment(rawUrl: String, purpose: String): String? =
        withContext(Dispatchers.Main) {
            val wv = webView ?: return@withContext null
            val script = buildSignScript(rawUrl, purpose)
            val result = CompletableDeferred<String?>()
            try {
                wv.evaluateJavascript(script) { value ->
                    result.complete(decodeJsResult(value))
                }
            } catch (t: Throwable) {
                Timber.w(t, "WebSignBridge: evaluateJavascript threw")
                result.complete(null)
            }
            try {
                result.await()
            } catch (_: TimeoutCancellationException) {
                null
            }
        }

    override fun shutdown() {
        // Post to Main thread because WebView.destroy() requires Main.
        webView?.post {
            destroyWebView()
        }
    }

    private fun destroyWebView() {
        webView?.let { wv ->
            try {
                wv.stopLoading()
                wv.clearHistory()
                @Suppress("ClickableViewAccessibility")
                wv.setOnTouchListener(null)
                wv.webViewClient = WebViewClient()
                wv.destroy()
            } catch (t: Throwable) {
                Timber.w(t, "WebSignBridge: destroy threw")
            }
        }
        webView = null
        ready = false
        warmCookie = null
    }

    private fun injectCookies(cookieHeader: String) {
        val cookieMgr = CookieManager.getInstance()
        cookieMgr.setAcceptCookie(true)
        // `Cookie:` header → semicolon-separated name=value pairs. Strip
        // attributes (Path/Domain/Expires/etc — the header form never has
        // them, but a stray attribute wouldn't be unreasonable from a
        // hand-edited cookie store).
        cookieHeader.split(';')
            .map { it.trim() }
            .filter { it.isNotEmpty() && it.contains('=') }
            .forEach { pair ->
                try {
                    cookieMgr.setCookie("https://$cleanCookieDomain/", "$pair; Domain=$cookieDomain; Path=/")
                } catch (t: Throwable) {
                    Timber.w(t, "WebSignBridge: setCookie failed for %s", pair.take(40))
                }
            }
        cookieMgr.flush()
    }

    private val cleanCookieDomain: String
        get() = cookieDomain.removePrefix(".")

    companion object {
        // Pure helpers moved to [WebSignBridgeHelpers] so JVM unit tests can
        // load them without `android.webkit.*` on the test classpath. Keep
        // these forwarders for callers that already chained through
        // `WebSignBridge.Companion.*`.
        internal const val DESKTOP_CHROME_UA = WebSignBridgeHelpers.DESKTOP_CHROME_UA
        internal fun decodeJsResult(value: String?): String? =
            WebSignBridgeHelpers.decodeJsResult(value)
        internal fun appendSignFragment(rawUrl: okhttp3.HttpUrl, fragment: String): okhttp3.HttpUrl =
            WebSignBridgeHelpers.appendSignFragment(rawUrl, fragment)
        internal fun buildProbeScript(candidates: List<String>, argsJson: String): String =
            WebSignBridgeHelpers.buildProbeScript(candidates, argsJson)
    }
}
