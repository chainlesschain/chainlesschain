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
 * 2026-05-25 (post `daabf6dfb` 真机回归修正)：5 家 (Bilibili / 抖音 / 小红书 /
 * 头条 / 快手) 平台原 UA 反检测命中点是 WebView 默认 UA 里 3 件套 —
 * `; wv)` + ` Version/4.0 ` + 我们自加的 ` ChainlesschainAndroid/A8` 后缀。
 * 剥光这 3 个 marker 后伪装成「真 Mobile Chrome on Android」即可拿到带
 * polling 闭环 + 「一键登录」按钮的 mobile 登录页。
 *
 * 上次走 [DESKTOP_CHROME_USER_AGENT] 整串覆盖的方向是反的 —— Desktop UA
 * 让平台返桌面登录流（桌面用户不装原生 App，本就不该有一键登录入口；
 * 抖音直接 modal-only 不 redirect → onPageFinished 不命中 → cookie 永远
 * 拿不到）。本 const 保留供 ad-hoc desktop-only API 抓取场景，**不用在
 * 5 平台登录上**。
 *
 * 维护提示：Chrome 主版本 ~6 周一次；若某家升级强制最新版（罕见）手动 bump。
 */
const val DESKTOP_CHROME_USER_AGENT: String =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/119.0.0.0 Safari/537.36"

/**
 * 5 家平台登录用的 Mobile Chrome on Android UA。区别于 WebView 默认 UA —
 * 没有 `; wv)` / ` Version/4.0` 标记 + 不带 ChainlesschainAndroid 后缀，
 * 平台服务端把我们看成"真 Mobile Chrome"，返带 polling 闭环 + 一键登录
 * 按钮的 mobile 登录页 (`m.bilibili.com` / `m.xiaohongshu.com` 等)。
 *
 * 微博 m.weibo.cn 无此反检测 → 仍传 null 走 [sanitizeWebViewUserAgent] 默认。
 */
const val MOBILE_CHROME_USER_AGENT: String =
    "Mozilla/5.0 (Linux; Android 13; Pixel 5) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/119.0.6045.66 Mobile Safari/537.36"

/**
 * 去掉 Android System WebView 默认 UA 里的两个"我是嵌入式 WebView"标记 —
 * `; wv)` 和 ` Version/4.0`。无 [userAgent] 整串覆盖时调用方仍吃这层
 * 防御纵深 (微博走这路径)。
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
     * 过的默认 Android WebView UA（不再 append "ChainlesschainAndroid/A8"
     * 后缀 —— 该后缀是 anti-bot 反检测的命中 marker，2026-05-25 真机回归
     * 后已剥）；传非 null（典型 [MOBILE_CHROME_USER_AGENT]）= 整串替换。
     *
     * 5 个反 WebView 严格的平台 (Bilibili/抖音/小红书/头条/快手) 必须传
     * [MOBILE_CHROME_USER_AGENT] 才能拿到带 JS 轮询 + 一键登录按钮的
     * mobile 登录页；微博 m.weibo.cn 不需要走该路径。
     */
    userAgent: String? = null,
    /**
     * 可选：cookie-presence based 登录成功检测，每 1.5s 轮询 CookieManager
     * 一次，返 true 触发与 [isLoginSuccess] 同 onLoginComplete 路径（同 dedup
     * 守卫）。
     *
     * 用于"登录后 URL 不变"的平台（典型：抖音 modal 登录 — 弹窗关闭后 URL
     * 仍是 `?showLogin=1`，[WebViewClient.onPageFinished] 不再触发）。检测
     * key 用平台 session cookie 出现（如抖音 `sessionid_ucp_v1`）。
     *
     * null = 不轮询，纯走 URL 路径。
     */
    isLoginSuccessByCookie: ((cookie: String) -> Boolean)? = null,
    /**
     * 可选：登录成功 + cookie 抓到后，**在 WebView 内**执行的 JS 脚本（典型
     * Bilibili 聚合 fetch 4 API + per-folder fav，结果通过 `BilibiliBridge.
     * onSyncData(json)` JavascriptInterface 回 Kotlin）。
     *
     * 为什么必须 in-WebView fetch：b 站桌面 web API 风控严，OkHttp 不论怎么
     * 配 cookie / UA / WBI 签名 / dm_img 指纹，TLS ClientHello 与 JS-set
     * cookie (`_uuid` / `buvid_fp` / `b_lsid` / `b_nut`) 缺失依然被识别为
     * 非浏览器 → 多端点静默空 + `/fav/resource/list` 硬 -400。WebView 是真
     * Chrome，TLS 指纹真，cookie 全 = 唯一稳路。
     *
     * 传 null（默认）= 跳过 prefetch，行为同今日。传非 null 时同步必须配
     * [onPrefetchComplete] 接收 JSON（或 null = JS 报错）。
     */
    prefetchJs: String? = null,
    /**
     * 配套 [prefetchJs]：JS 跑完后回调。`data` 非 null = JSON 字符串；null =
     * JS 抛错或 JavascriptInterface 没被叫到（5s 超时）。
     */
    onPrefetchComplete: ((cookie: String, data: String?) -> Unit)? = null,
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
            // 2026-05-25 真机迭代教训：
            //   - 一键登录 / 「使用 App 打开」 deep-link 拉起原生 App → App
            //     进程自己写 cookie 到自家沙箱（Android per-process 隔离），
            //     **不会**回灌到我们 WebView CookieManager。所以"App 起来登
            //     完 cookie 还是 0"。
            //   - Desktop UA (DESKTOP_CHROME_USER_AGENT) 让平台返带账密表单
            //     的桌面登录页。账密走完 cookie 直接写到我们 WebView，没跨
            //     进程问题。
            //   - 微博 m.weibo.cn 不严，走默认 sanitize 路径即可（不传 UA）。
            // 详 memory `pdh_social_webview_deeplink_cookie_capture.md` v2 段。
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
                    "推荐：用账号密码登录（手机号 + 密码 或 手机号 + 短信验证码）。" +
                        "⚠️ 不要点「一键登录」/「使用 App 打开」/「打开 App 授权」" +
                        "等会拉起 $displayName App 的按钮 — Android 隔离 App 和" +
                        "我们 WebView 的 cookie，从 App 登完返回这里也是空的。",
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
                    prefetchJs = prefetchJs,
                    onPrefetchComplete = onPrefetchComplete,
                    isLoginSuccessByCookie = isLoginSuccessByCookie,
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
    prefetchJs: String? = null,
    onPrefetchComplete: ((cookie: String, data: String?) -> Unit)? = null,
    isLoginSuccessByCookie: ((cookie: String) -> Boolean)? = null,
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

    // 2026-05-25 v2 — cookie 抓到后的统一 dispatch lambda：URL 路径 (onPageFinished)
    // 和 cookie 轮询路径 (pollRunnable) 都调本函数。prefetchJs 非 null 则走 in-WebView
    // JS fetch，否则旧 onLoginCookie 兜底。第 1 版只在 URL 路径加 prefetch → 抖音走
    // cookie 路径直接跳 OkHttp HTTP 404，得不偿失
    val dispatchCookieReady: (WebView, String) -> Unit = { view, cookie ->
        if (prefetchJs != null && onPrefetchComplete != null) {
            val responded = java.util.concurrent.atomic.AtomicBoolean(false)
            val sharedCb: (String?) -> Unit = { data ->
                if (responded.compareAndSet(false, true)) {
                    onPrefetchComplete(cookie, data)
                }
            }
            // broadcast 注册 — 每平台 bridge 一个单例，AtomicBoolean 守护去重
            com.chainlesschain.android.pdh.social.bilibili
                .BilibiliJsBridge.setPending(sharedCb)
            com.chainlesschain.android.pdh.social.douyin
                .DouyinJsBridge.setPending(sharedCb)
            view.evaluateJavascript(prefetchJs, null)
            view.postDelayed({
                if (responded.compareAndSet(false, true)) {
                    com.chainlesschain.android.pdh.social.bilibili
                        .BilibiliJsBridge.clearPending()
                    com.chainlesschain.android.pdh.social.douyin
                        .DouyinJsBridge.clearPending()
                    Timber.w("SocialCookieWebView: prefetch JS timeout (15s)")
                    onPrefetchComplete(cookie, null)
                }
            }, 15_000)
        } else {
            onLoginCookie(cookie)
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
                    // 2026-05-25 UA 反检测两档（post `daabf6dfb` 真机回归 — A8
                    // 后缀剥光，Desktop UA 不再用于登录）：
                    //   1. 调用方传 [userAgent]（典型 [MOBILE_CHROME_USER_AGENT]）
                    //      → 整串覆盖 — 5 家严平台走此档拿 mobile 登录页
                    //   2. 没传 → 默认 WebView UA 走 [sanitizeWebViewUserAgent]
                    //      剥 `; wv)` + ` Version/4.0` 防御纵深（微博 m.weibo.cn
                    //      不严，走此档）
                    //
                    // 已剥 " ChainlesschainAndroid/A8" 后缀 — 该 marker 是 anti-
                    // bot 反检测命中点（"自报家门"），跟 wv 标记同列，剥光让 5 家
                    // 平台拿到真 mobile 登录页含 polling 闭环。
                    userAgentString = userAgent
                        ?: sanitizeWebViewUserAgent(settings.userAgentString)
                }
                // 2026-05-25 真机：b 站 OkHttp 路径被风控（详 BilibiliJsBridge KDoc）。
                // 唯一稳路是登录后在 WebView 内 evaluateJavascript 跑 fetch。统一注
                // 入 `BilibiliBridge` JavascriptInterface（其它平台不用就 idle，无成本）
                addJavascriptInterface(
                    com.chainlesschain.android.pdh.social.bilibili.BilibiliJsBridge,
                    "BilibiliBridge",
                )
                addJavascriptInterface(
                    com.chainlesschain.android.pdh.social.douyin.DouyinJsBridge,
                    "DouyinBridge",
                )
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
                                if (cookie.isEmpty()) {
                                    Timber.w(
                                        "SocialCookieWebView: success URL hit but cookie empty (domain=%s)",
                                        cookieDomain
                                    )
                                    return@postDelayed
                                }
                                Timber.i(
                                    "SocialCookieWebView: login success url=%s cookieLen=%d",
                                    url, cookie.length
                                )
                                dispatchCookieReady(view, cookie)
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
                // 2026-05-25 — cookie-presence based 登录检测（D 路径）。抖音
                // 典型：登录是 modal 形式，弹窗关闭后 URL 不变（仍 `?showLogin=1`），
                // [onPageFinished] 不会因登录再触发；唯一靠谱信号是 CookieManager
                // 里出现平台 session cookie。1.5s 轮询 cookie；命中即调
                // onLoginCookie（外层 [SocialCookieWebViewScreen] 已有
                // hasSubmittedSuccess 守卫去重 URL/cookie 双触发）。
                //
                // 用 view.postDelayed 自递归 (而非 LaunchedEffect+coroutines)
                // 原因：LaunchedEffect 在 @Composable 内会让 JaCoCo offline
                // 仪表化 transform 静默 drop 整 top-level file 类（具体 trap
                // 未追根，但跑 1 轮 baseline + 1 轮加 LaunchedEffect 复现稳）；
                // Handler-based 轮询无 Compose runtime 集成、view dispose 时
                // 自然停（WebView.destroy() 清队列）。
                if (isLoginSuccessByCookie != null) {
                    val pollIntervalMs = 1500L
                    val webViewSelf = this
                    val pollRunnable = object : Runnable {
                        override fun run() {
                            try {
                                CookieManager.getInstance().flush()
                                val cookie = CookieManager.getInstance()
                                    .getCookie(cookieDomain) ?: ""
                                if (cookie.isNotEmpty() && isLoginSuccessByCookie(cookie)) {
                                    Timber.i(
                                        "SocialCookieWebView: cookie-presence login " +
                                            "success domain=%s cookieLen=%d",
                                        cookieDomain, cookie.length,
                                    )
                                    dispatchCookieReady(webViewSelf, cookie)
                                    return  // stop polling
                                }
                            } catch (t: Throwable) {
                                Timber.w(t, "SocialCookieWebView: cookie poll threw")
                            }
                            webViewSelf.postDelayed(this, pollIntervalMs)
                        }
                    }
                    postDelayed(pollRunnable, pollIntervalMs)
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
