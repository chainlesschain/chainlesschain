package com.chainlesschain.android.pdh.social

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import timber.log.Timber

/**
 * Real-device 2026-05-23 (Xiaomi 24115RA8EC): Bilibili buvid3 + bili_jct are
 * written by post-onload JS — onPageFinished beats them. Defer cookie grab
 * so JS has its execution window. Shared by all 4 social adapters
 * (Weibo / Douyin / Xiaohongshu also set cookies from JS — no platform is
 * worse off for the delay).
 *
 * Started at 2000ms; real-device 2026-05-23 22:30 same device still hit
 * MissingField(buvid3) → bumped to 5000ms. The buvid3 setter chains an
 * XHR (/x/frontend/finger/spi or similar) after window.onload, so 2s
 * regularly loses the race on 5G + slow render path. 5s costs ~3s extra
 * idle on the login screen but is dominated by the user's actual login
 * keystrokes anyway.
 */
private const val COOKIE_CAPTURE_DELAY_MS = 5000L

/**
 * A8 v0.1 — generic in-app WebView used by all 4 social adapters
 * (Bilibili / Weibo / Douyin / Xiaohongshu) for cookie capture.
 *
 * The flow:
 *  1. User taps "登录" on a social adapter card in HubLocalScreen.
 *  2. This screen overlays the host, loads [loginUrl] in a WebView.
 *  3. User logs in via the platform's own credentials (we do NOT see the
 *     password — we just observe the cookie jar after auth completes).
 *  4. [WebViewClient.onPageFinished] checks [isLoginSuccess] against the
 *     post-login URL; on match we flush the CookieManager (force-write any
 *     pending in-memory cookies to backing store) and extract via
 *     [CookieManager.getCookie] (cookieDomain).
 *  5. Caller stores the cookie + UID (parsed from URL or cookie itself,
 *     platform-specific — handled in [onLoginComplete]).
 *
 * Why not fire `onLoginComplete` per platform from inside this Composable?
 * The "success URL" pattern is platform-specific (Bilibili lands on
 * https://www.bilibili.com after login; Xiaohongshu on https://www.xiaohongshu.com
 * etc.) so the caller passes [isLoginSuccess]. The cookie domain too varies
 * (e.g. ".bilibili.com" vs ".xiaohongshu.com"). Keep this screen platform-agnostic.
 *
 * Security note: cookies stored by WebView's CookieManager are global to
 * the app. After the user logs out of Bilibili in our app, we should call
 * `CookieManager.removeAllCookies()` — but that would also clear cookies
 * for other features that use WebView. For now we scope cleanup to the
 * specific domain via setCookie("...; Max-Age=0"). See
 * [SocialCookieWebViewHelpers.clearCookiesForDomain].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SocialCookieWebViewScreen(
    loginUrl: String,
    cookieDomain: String,
    displayName: String,
    isLoginSuccess: (currentUrl: String) -> Boolean,
    onLoginComplete: (cookie: String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var loadingProgress by remember { mutableFloatStateOf(0f) }
    var hasSubmittedSuccess by remember { mutableStateOf(false) }

    // Honour system back gesture as a "cancel" — matches Android UX standards.
    BackHandler { onCancel() }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text(displayName) },
                navigationIcon = {
                    TextButton(onClick = onCancel) { Text("取消") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            // Hint banner — tells user why this WebView appears
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "请在下方页面用您自己的账号登录 $displayName。" +
                        "登录成功后会自动返回。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // Progress bar (indeterminate when 0f or 1f, otherwise determinate)
            if (loadingProgress > 0f && loadingProgress < 1f) {
                LinearProgressIndicator(
                    progress = { loadingProgress.coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Box(modifier = Modifier.fillMaxSize()) {
                CookieWebViewHost(
                    loginUrl = loginUrl,
                    cookieDomain = cookieDomain,
                    isLoginSuccess = isLoginSuccess,
                    onProgress = { loadingProgress = it },
                    onLoginCookie = { cookie ->
                        if (!hasSubmittedSuccess) {
                            hasSubmittedSuccess = true
                            onLoginComplete(cookie)
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
                if (loadingProgress in 0.01f..0.99f) {
                    // Tiny overlay spinner when initial load is slow.
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(12.dp),
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.height(20.dp),
                            strokeWidth = 2.dp,
                        )
                    }
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun CookieWebViewHost(
    loginUrl: String,
    cookieDomain: String,
    isLoginSuccess: (String) -> Boolean,
    onProgress: (Float) -> Unit,
    onLoginCookie: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Hold the WebView ref so DisposableEffect can stop/destroy it
    // deterministically (Android keeps a reference inside the system WebView
    // factory and leaks the Activity context if we forget to destroy()).
    val webViewState = remember { mutableStateOf<WebView?>(null) }

    DisposableEffect(Unit) {
        onDispose {
            try {
                webViewState.value?.apply {
                    stopLoading()
                    // Clear references before destroy to avoid:
                    //   ViewRootImpl: WebView.destroy() called while still attached
                    (parent as? ViewGroup)?.removeView(this)
                    destroy()
                }
            } catch (t: Throwable) {
                Timber.w(t, "SocialCookieWebViewScreen: WebView dispose threw")
            }
            webViewState.value = null
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                webViewState.value = this
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    databaseEnabled = true
                    userAgentString = settings.userAgentString +
                        " ChainlesschainAndroid/A8"
                }
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String) {
                        super.onPageFinished(view, url)
                        onProgress(1f)
                        // Login-success detection runs on every page-load, not
                        // just the initial one — platforms may redirect through
                        // multiple intermediate pages (e.g. captcha → 2FA → home).
                        if (isLoginSuccess(url)) {
                            // Real-device 2026-05-23 Xiaomi 24115RA8EC:
                            // Bilibili sets two anti-spider keys (buvid3 +
                            // bili_jct) from JS that runs *after* window.onload.
                            // Reading the cookie jar in onPageFinished beats
                            // that write → cookie missing these fields → API
                            // returns silent `{code:0, data:{list:[]}}` instead
                            // of -412/-101, so the user sees "登录成功" then "4
                            // API empty" on next sync. Defer the grab COOKIE_
                            // CAPTURE_DELAY_MS to give JS its execution window.
                            //
                            // Lifecycle: view.postDelayed survives a quick
                            // Cancel because the lambda holds `this` (WebView).
                            // After onDispose's destroy(), getCookie() reads
                            // from CookieManager's in-process cache so still
                            // benign; hasSubmittedSuccess guard upstream
                            // de-dups if it does fire post-cancel.
                            view.postDelayed({
                                CookieManager.getInstance().flush()
                                val cookie = CookieManager.getInstance().getCookie(cookieDomain) ?: ""
                                if (cookie.isNotEmpty()) {
                                    Timber.i(
                                        "SocialCookieWebView: login success url=%s cookieLen=%d",
                                        url, cookie.length
                                    )
                                    onLoginCookie(cookie)
                                } else {
                                    Timber.w(
                                        "SocialCookieWebView: success URL hit but cookie empty (domain=%s)",
                                        cookieDomain
                                    )
                                }
                            }, COOKIE_CAPTURE_DELAY_MS)
                        }
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onReceivedError(
                        view: WebView?,
                        errorCode: Int,
                        description: String?,
                        failingUrl: String?
                    ) {
                        Timber.w("SocialCookieWebView: error %d on %s: %s", errorCode, failingUrl, description)
                    }
                }
                webChromeClient = object : android.webkit.WebChromeClient() {
                    override fun onProgressChanged(view: WebView?, newProgress: Int) {
                        super.onProgressChanged(view, newProgress)
                        onProgress(newProgress / 100f)
                    }
                }
                loadUrl(loginUrl)
            }
        },
    )
}

/**
 * Platform-agnostic helpers around CookieManager that all 4 collectors share.
 */
object SocialCookieWebViewHelpers {
    /**
     * Clear cookies for a single domain by issuing setCookie with Max-Age=0.
     * Naive: only clears cookies whose names we already know. For a full
     * domain-wide clear we'd need CookieManager.removeAllCookies which is
     * global. v0.1 acceptable trade-off — sync still works after logout
     * because we'll re-walk login flow.
     */
    fun clearCookiesForDomain(domain: String, knownCookieNames: List<String>) {
        val cm = CookieManager.getInstance()
        knownCookieNames.forEach { name ->
            cm.setCookie(domain, "$name=; Max-Age=0; Path=/")
        }
        cm.flush()
    }

    /**
     * Extract a single cookie value from a Cookie header string.
     * Returns null if the cookie name is not present.
     */
    fun parseCookieValue(cookieHeader: String, name: String): String? {
        if (cookieHeader.isEmpty()) return null
        val prefix = "$name="
        return cookieHeader.split(";").asSequence()
            .map { it.trim() }
            .firstOrNull { it.startsWith(prefix) }
            ?.removePrefix(prefix)
    }
}
