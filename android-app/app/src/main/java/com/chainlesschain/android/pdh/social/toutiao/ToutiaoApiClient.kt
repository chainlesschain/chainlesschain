package com.chainlesschain.android.pdh.social.toutiao

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v0.1 placeholder — Toutiao (今日头条) www.toutiao.com client.
 *
 * **Tiny surface deliberately**：头条 web 的所有 read 接口
 * （/api/pc/list/feed / /article/v2/tab_comments / /api/news/feed/v90/）都需
 * `_signature` 签名（来自 acrawler.js / mssdk.js, 与抖音的 a-bogus 同 family，
 * 都来自 ByteDance 反爬 SDK），没有可靠的纯 Kotlin 实现。
 *
 * v0.1 路径：**不调任何网络接口**，只从 WebView 抓回的 cookie 字符串里抽 uid。
 * 头条 web cookie 关键字段：
 *   - `passport_uid`         登录后才出现的数字用户 id（首选）
 *   - `multi_sids`           "uid:sid;uid:sid" 格式，首段 uid（次选）
 *   - `__ac_uid` / `tt_uid`  legacy fallback (老登录可能用)
 *   - `s_v_web_id` / `tt_webid` / `__ac_signature` 等是反爬指纹/匿名 id，**不能**
 *     当 uid 用（未登录用户也有这些）
 *
 * v0.2+ 待接通（_signature 路径）：
 *   - `/api/news/feed/v90/?category=__all__` 推荐流（BROWSE）
 *   - `/article/v2/tab_comments/`            收藏夹（COLLECTION）
 *   - `/api/search/content/`                  历史搜索（SEARCH）
 *
 * 没有 OkHttpClient 字段——v0.1 没网络调用。预留 httpClient / baseUrl 给 v0.2，
 * 与 [com.chainlesschain.android.pdh.social.douyin.DouyinApiClient] 对称。
 */
@Singleton
class ToutiaoApiClient @Inject constructor() {

    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Override the base URL for MockWebServer in tests (v0.2+ when network lands). */
    var baseUrl: HttpUrl = "https://www.toutiao.com/".toHttpUrl()

    @Volatile var lastErrorCode: Int = 0
        private set
    @Volatile var lastErrorMessage: String? = null
        private set

    /**
     * v0.1 entry: WebView 把 cookie 字符串递回来后调本方法抽 uid + 校验"已登录"。
     *
     * 返回 null = cookie 不含可识别的 uid 字段（基本可断定为未登录或登录未完成）。
     * 上层应 surface "登录未完成，请重试" 而非 silent 写空 store。
     */
    fun extractUid(cookie: String?): String? {
        if (cookie.isNullOrBlank()) {
            setLastError(-1, "cookie 为空")
            return null
        }
        // 优先：passport_uid (现行登录后稳定)
        val passportUid = Regex("(?:^|; ?)passport_uid=(\\d+)").find(cookie)?.groupValues?.getOrNull(1)
        if (passportUid != null && passportUid.isNotBlank() && passportUid != "0") {
            clearLastError()
            return passportUid
        }
        // 次选：multi_sids 第一段 uid。格式 "12345:abcd;67890:efgh"
        val multiSidsRaw = Regex("(?:^|; ?)multi_sids=([^;]+)").find(cookie)?.groupValues?.getOrNull(1)
        if (!multiSidsRaw.isNullOrBlank()) {
            val firstUid = multiSidsRaw.substringBefore(';').substringBefore(':').trim()
            if (firstUid.isNotBlank() && firstUid.all { it.isDigit() } && firstUid != "0") {
                clearLastError()
                return firstUid
            }
        }
        // legacy fallback
        val legacy = Regex("(?:^|; ?)(?:__ac_uid|tt_uid)=(\\d+)").find(cookie)?.groupValues?.getOrNull(1)
        if (legacy != null && legacy.isNotBlank() && legacy != "0") {
            clearLastError()
            return legacy
        }
        // 没找到任何 uid 字段 — cookie 是"匿名"或"登录未完成"
        setLastError(-7, "cookie 缺 passport_uid / multi_sids / __ac_uid — 登录未完成或仅游客态")
        Timber.w(
            "ToutiaoApiClient.extractUid: no uid candidate found in cookie (length=%d)",
            cookie.length,
        )
        return null
    }

    private fun setLastError(code: Int, message: String?) {
        lastErrorCode = code
        lastErrorMessage = message
    }

    private fun clearLastError() {
        lastErrorCode = 0
        lastErrorMessage = null
    }
}
