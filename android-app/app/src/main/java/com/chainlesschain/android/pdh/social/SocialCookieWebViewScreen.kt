package com.chainlesschain.android.pdh.social

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
 * 2026-05-25 真机回归：除微博外 5 家 (Bilibili / 抖音 / 小红书 / 头条 / 快手)
 * 一点登录就被推到「请用 X App 打开」拦截页 —— 各家服务端识别 Android Chrome
 * WebView 默认 UA 里的 `; wv)` 标记 + ` Version/4.0 ` 段拒不返登录页（拦截页
 * 没 JS 轮询，cookie 永远 Set-Cookie 不下来 → onPageFinished/isLoginSuccess
 * 永远不命中 → 用户体感"跳了 App 登了又回来还是空"）。
 *
 * 此 const 仿 Win 桌面 Chrome 119 — 让平台返"真正的扫码 + 一键登录页"含
 * polling 闭环。5 家共用同一串，差异在 isLoginSuccess。维护提示：Chrome
 * 主版本 ~6 周一次；若某家升级到必须最新版（罕见）手动 bump 即可。
 *
 * 微博 m.weibo.cn 不做这检测 → 不传此 UA, 保持默认（[sanitizeWebViewUserAgent]
 * 已防御纵深兜底）。
 */
const val DESKTOP_CHROME_USER_AGENT: String =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/119.0.0.0 Safari/537.36"

/**
 * 去掉 Android System WebView 默认 UA 里的两个"我是嵌入式 WebView"标记 —
 * `; wv)` 和 ` Version/4.0`。即使调用方不显式传 [DESKTOP_CHROME_USER_AGENT]
 * 也吃这层防御，避免某天平台只升级 wv 检测漏过桌面 UA 也不行的兜底场景。
 *
 * Idempotent：再调一次结果一样（marker 已剔除，replace no-op）。
 *
 * Example:
 *  - 输入 `"Mozilla/5.0 (Linux; Android 13; ...; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.66 Mobile Safari/537.36"`
 *  - 输出 `"Mozilla/5.0 (Linux; Android 13; ...) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.66 Mobile Safari/537.36"`
 */
internal fun sanitizeWebViewUserAgent(raw: String): String =
    raw.replace("; wv)", ")")
        .replace(Regex(" Version/[0-9.]+"), "")

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
    /**
     * 可选 WebView UA 整串覆盖。传 null = 用 [sanitizeWebViewUserAgent] 处理
     * 过的默认 Android WebView UA + " ChainlesschainAndroid/A8" 后缀；传非
     * null（典型 [DESKTOP_CHROME_USER_AGENT]）= 整串替换不加后缀。
     *
     * 5 个反 WebView 严格的平台 (Bilibili/抖音/小红书/头条/快手) 必须传桌面
     * UA 才能拿到带 JS 轮询的真登录页；微博 m.weibo.cn 不需要。
     */
    userAgent: String? = null,
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
            // Hint banner — tells user why this WebView appears.
            // 2026-05-24: 同手机场景账密 captcha 墙 / 跨手机扫码自己照不到自己。
            // 推 "本机一键登录" 路径 — 各平台 web 登录页底部"通过 X App 一键登录"
            // / "本机已登录，点此确认"按钮跳 `bilibili://` / `snssdk1128://` 等
            // scheme，刚加的 shouldOverrideUrlLoading 拦截后派发 Intent.ACTION_VIEW
            // 拉起原生 App。原生 App 向自家服务器确认授权，WebView 的 JS 轮询拿到
            // "已授权" → Set-Cookie header 下发 → 我们 CookieManager 接住。同手机
            // 流程不需要相机，跟扫码本质同路径（cookie 是服务器下发，不是 App 灌
            // 给我们）。微博走移动 web 账密软校验本身就过 — 详见 memory
            // `bilibili_post_onload_cookie_race.md` 字段校验链。
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text(
                    "请在下方页面登录 $displayName。登录成功后会自动返回。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "推荐：找下方「通过 $displayName App 一键登录」/「本机已登录，" +
                        "点此确认」按钮（在扫码二维码下方），点了会拉起本机已登录的 " +
                        "$displayName App 完成授权，比账密登录稳得多。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
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
                    userAgent = userAgent,
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
    userAgent: String? = null,
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
                    // 2026-05-25 UA 反检测三档：
                    //   1. 调用方传 [userAgent]（典型 [DESKTOP_CHROME_USER_AGENT]）
                    //      → 整串覆盖 — 不加 "ChainlesschainAndroid/A8" 后缀
                    //      （桌面 Chrome UA 该是干净串，加 marker 反而提示反爬）
                    //   2. 没传 → 默认 WebView UA 走 [sanitizeWebViewUserAgent]
                    //      剥 `; wv)` + ` Version/4.0` 防御纵深 + 加 A8 标识
                    //   3. 5 家严平台必走档 1；微博 m.weibo.cn 用档 2 即可
                    userAgentString = userAgent
                        ?: (sanitizeWebViewUserAgent(settings.userAgentString) +
                            " ChainlesschainAndroid/A8")
                }
                webViewClient = object : WebViewClient() {
                    /**
                     * 2026-05-24: 各平台 web 登录页弹"打开 App 授权/扫码"按钮
                     * 跳的是 `bilibili://` / `snssdk1128://` / `xhsdiscover://` /
                     * `snssdk143://` / `kwai://` 这类自定义 scheme，或
                     * `intent://...#Intent;scheme=...;package=...;end` URI。
                     * WebView 默认只认 http(s)/file/javascript，遇到这些会
                     * **静默 no-op** — 用户体感"按了没反应"。
                     *
                     * 这里把 http(s) 之外的全派发为 [Intent.ACTION_VIEW]，让
                     * Android 系统去匹配能处理该 scheme 的原生 App。
                     *
                     * 关于 cookie 共享：原生 App 完成授权后，cookie 落在它自己
                     * 的沙箱里，**不会** 回灌到我们的 [CookieManager]。所以即
                     * 便能开起原生 App，最终也得靠 web 端扫码/账密走完后续
                     * 流程才能拿到 cookie。本 override 主要消除"按了没反应"
                     * 的死路体感，并支持极少数有 universal-link 回灌的开放
                     * 平台流程（如微博"开放平台授权"）。
                     */
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ): Boolean {
                        val uri = request?.url ?: return false
                        val scheme = uri.scheme?.lowercase()
                        // 让 WebView 自己继续处理 http(s)/file/javascript/about/data。
                        if (scheme == null ||
                            scheme == "http" ||
                            scheme == "https" ||
                            scheme == "file" ||
                            scheme == "javascript" ||
                            scheme == "about" ||
                            scheme == "data"
                        ) {
                            return false
                        }
                        return dispatchExternalScheme(view?.context, uri)
                    }
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
 * 派发 WebView 里碰到的非 http(s) URI 给系统：`intent://` URI 走
 * [Intent.parseUri] 解析（自带 scheme/package/fallback），其它自定义
 * scheme（`bilibili://` / `snssdk1128://` / `xhsdiscover://` 等）走裸
 * `ACTION_VIEW`。一律 catch [ActivityNotFoundException] — 没装对应原生
 * App 时不能 crash 我们这个 Activity；URISyntaxException 兜底同理。
 *
 * 返回 true 表示 WebView 不要继续 loadUrl 这条 URI（无论原生 App 是否真
 * 起来都算"我们已尝试"）。返回 false 仅在解析完全失败时，让 WebView 走
 * 默认错误处理。
 *
 * @param context WebView 所属的 Activity context — Intent 需要它 startActivity；
 *                空 context 直接放弃（罕见，但 view?.context 理论上可为 null）。
 */
internal fun dispatchExternalScheme(context: Context?, uri: Uri): Boolean {
    if (context == null) return true  // Swallow — no way to dispatch.
    val rawUrl = uri.toString()
    val intent = try {
        if (rawUrl.startsWith("intent://", ignoreCase = true)) {
            // `intent://host/path#Intent;scheme=foo;package=com.bar;end`
            // 由 parseUri 自动拆 scheme / package / S.fallback_url
            Intent.parseUri(rawUrl, Intent.URI_INTENT_SCHEME)
        } else {
            Intent(Intent.ACTION_VIEW, uri)
        }
    } catch (t: Throwable) {
        // Malformed intent URI — log + give up. False lets WebView surface
        // its own "ERR_UNKNOWN_URL_SCHEME" error rather than swallowing
        // silently (which would be the worse UX).
        Timber.w(t, "SocialCookieWebView: failed to parse external URI: %s", rawUrl)
        return false
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
        context.startActivity(intent)
        Timber.i("SocialCookieWebView: dispatched external scheme: %s", rawUrl)
        true
    } catch (e: ActivityNotFoundException) {
        // 原生 App 未装。intent:// URI 的 fallback_url 自动由系统消费；
        // 普通 scheme 需要我们自己处理 — 但 v1 不试 fallback（多数平台
        // fallback 也是同个 web QR 页面，会循环）。日志告知开发，UI 端
        // 用户看不到任何提示（与原 silent no-op 相比改善：至少有日志）。
        Timber.i(
            "SocialCookieWebView: no app to handle scheme %s (uri=%s)",
            uri.scheme, rawUrl,
        )
        true
    } catch (t: Throwable) {
        // SecurityException (e.g. requires permission) / IllegalArgumentException
        // (malformed Intent extras) — same handling: swallow + log, don't crash.
        Timber.w(t, "SocialCookieWebView: startActivity threw for %s", rawUrl)
        true
    }
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
