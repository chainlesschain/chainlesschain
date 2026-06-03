package com.chainlesschain.android.pdh.social.toutiao

import com.chainlesschain.android.pdh.social.NullSignProvider
import com.chainlesschain.android.pdh.social.SignProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.2 — Toutiao (今日头条) www.toutiao.com client.
 *
 * **小 surface 因 _signature**：头条 web 几乎所有 read 接口（/api/pc/list/feed
 * / /article/v2/tab_comments/ / /api/news/feed/v90/）都需 `_signature` 签名
 * （来自 acrawler.js / mssdk.js，与抖音的 X-Bogus 同 ByteDance 反爬 SDK family），
 * 没有可靠的纯 Kotlin 实现 — acrawler.js 经常 obfuscate rotate。
 *
 * v0.2 唯一接通的端点：
 *   - `/passport/account/info/v2/?aid=24` — 老式 ByteDance 统一 passport 接口
 *     （aid=24 是 Toutiao web client id；Douyin web 是 aid=2906），cookie + aid
 *     就行，**无 _signature**。返 `{ status_code: 0, data: { user_id,
 *     screen_name, mobile, avatar_url, ... } }`。与 Douyin /aweme/v1/passport/
 *     account/info/v2/ 同 shape，error-code 处理也对齐。
 *
 * v0.3+ 待接通（_signature 路径，需 WebView JS 注入或 acrawler 端口）：
 *   - `/api/news/feed/v90/?category=__all__` 推荐流（BROWSE）
 *   - `/article/v2/tab_comments/`             收藏夹（COLLECTION）
 *   - `/api/search/content/`                   历史搜索（SEARCH）
 *
 * v0.2 caveats:
 *   - 反爬 strong: 头条对没桌面 UA / 没 ttwid / 没 __ac_nonce 的请求会 412/403/HTML
 *     重定向。User-Agent 必须像桌面 Chrome；Referer 必须 www.toutiao.com。
 *   - 一些 cookie 字段（msToken / __ac_nonce）刷新很快（5-15min 一轮）。WebView
 *     抓的 cookie 进 EncryptedSharedPreferences 后若过期，passport/info/v2 会
 *     返 status_code != 0 + status_msg="token expired" — 引导重 login。
 */
@Singleton
class ToutiaoApiClient @Inject constructor() {

    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Override the base URL for MockWebServer in tests. */
    var baseUrl: HttpUrl = "https://www.toutiao.com/".toHttpUrl()

    /**
     * v0.3 — pluggable [SignProvider] for `_signature` (defaults to a
     * no-op so existing v0.2 callers / tests still pass). Production wires
     * [ToutiaoSignBridge]; JVM tests can inject a fake that returns a
     * deterministic signature without standing up a WebView.
     */
    var signProvider: SignProvider = NullSignProvider

    data class FeedItem(
        val itemId: String,
        val title: String,
        val category: String?,
        val author: String?,
        val publishedAt: Long,
        val readDuration: Int,
        val source: String?,
    )

    data class CollectionItem(
        val itemId: String,
        val title: String,
        val category: String?,
        val author: String?,
        val savedAt: Long,
    )

    data class SearchItem(
        val keyword: String,
        val searchedAt: Long,
    )

    data class ProfileInfo(
        val uid: String,
        val nickname: String,
        val avatarUrl: String?,
        val mobile: String?,
        val description: String?,
        val followingCount: Int,
        val followerCount: Int,
        val mediaId: String?,
    )

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
        // 优先：passport_uid (旧版登录后稳定，2025+ 已 deprecated)
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
        // legacy 数字 uid fallback
        val legacy = Regex("(?:^|; ?)(?:__ac_uid|tt_uid)=(\\d+)").find(cookie)?.groupValues?.getOrNull(1)
        if (legacy != null && legacy.isNotBlank() && legacy != "0") {
            clearLastError()
            return legacy
        }
        // 2026-05-27 真机 cookie 调查 (Xiaomi 24115RA8EC, www.toutiao.com 登录后)：
        // passport_uid / multi_sids / __ac_uid 三个都 absent。但 cookie 里有
        //   uid_tt        = 8164781bb85a86eb0159b97b74cd53d9   (toutiao 内 uid, 32-hex)
        //   sso_uid_tt    = 4ddce340d3eeee42ae840c1b2bc690a3   (SSO 统一 uid, 32-hex)
        //   tt_webid      = 7643974031003534911                  (web 访问者 numeric)
        // 头条 2025 改了登录态 cookie schema, passport_uid 不再下发到 web 端。
        // 优先 uid_tt (站内 ID), 其次 sso_uid_tt, 兜底 tt_webid。
        val uidTt = Regex("(?:^|; ?)uid_tt=([0-9a-fA-F]{16,64})").find(cookie)?.groupValues?.getOrNull(1)
        if (uidTt != null && uidTt.isNotBlank()) {
            clearLastError()
            return uidTt
        }
        val ssoUidTt = Regex("(?:^|; ?)sso_uid_tt=([0-9a-fA-F]{16,64})").find(cookie)?.groupValues?.getOrNull(1)
        if (ssoUidTt != null && ssoUidTt.isNotBlank()) {
            clearLastError()
            return ssoUidTt
        }
        val ttWebid = Regex("(?:^|; ?)tt_webid=(\\d{10,})").find(cookie)?.groupValues?.getOrNull(1)
        if (ttWebid != null && ttWebid.isNotBlank() && ttWebid != "0") {
            clearLastError()
            return ttWebid
        }
        // 没找到任何 uid 字段 — cookie 是"匿名"或"登录未完成"
        setLastError(-7, "cookie 缺 passport_uid/multi_sids/__ac_uid/uid_tt/sso_uid_tt/tt_webid — 登录未完成或仅游客态")
        Timber.w(
            "ToutiaoApiClient.extractUid: no uid candidate found in cookie (length=%d)",
            cookie.length,
        )
        return null
    }

    /**
     * 调 /passport/account/info/v2/?aid=24 拿 user_id + 基本资料 + 验登录态。
     * 返回 null = cookie 失效或登录未完成。aid=24 是头条 web 的 client id
     * （Douyin 是 aid=2906）。passport endpoint 返回 status_code=0 表示成功；
     * 非 0 表示失败（cookie 过期 / 限流）。
     */
    suspend fun fetchProfile(cookie: String): ProfileInfo? = withContext(Dispatchers.IO) {
        if (cookie.isBlank()) {  // audit F4
            setLastError(-8, "missing cookie")
            return@withContext null
        }
        val url = baseUrl.newBuilder()
            .addPathSegments("passport/account/info/v2/")
            .addQueryParameter("aid", "24")
            .build()
        val obj = doGetJson(url, cookie) ?: return@withContext null
        val statusCode = obj.optInt("status_code", Int.MIN_VALUE)
        if (statusCode == Int.MIN_VALUE) {
            val topKeys = obj.keys().asSequence().toList().joinToString(",")
            // body=%s dropped — passport JSON has mobile / user_id / screen_name (audit F2)
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 missing status_code; topKeys=[%s] bodyLen=%d",
                topKeys, obj.toString().length,
            )
            setLastError(-5, "passport/info/v2 missing status_code (keys=[$topKeys])")
            return@withContext null
        }
        if (statusCode != 0) {
            val msg = obj.optStringOrNull("status_msg")
                ?: obj.optStringOrNull("message")
                ?: obj.optStringOrNull("error_description")
                ?: "status_code=$statusCode"
            // body=%s dropped — passport PII (audit F2)
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 status_code=%d msg=%s bodyLen=%d",
                statusCode, msg, obj.toString().length,
            )
            setLastError(statusCode, msg)
            return@withContext null
        }
        val data = obj.optJSONObject("data")
        if (data == null) {
            // body=%s dropped — passport PII (audit F2)
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 status_code=0 but no `data` object; bodyLen=%d",
                obj.toString().length,
            )
            setLastError(-6, "status_code=0 but no `data` object")
            return@withContext null
        }
        val rawUid = data.optStringOrNull("user_id")
            ?: data.optLong("user_id_str", 0L).takeIf { it > 0L }?.toString()
            ?: data.optLong("user_id", 0L).takeIf { it > 0L }?.toString()
        if (rawUid == null) {
            val dataKeys = data.keys().asSequence().toList().joinToString(",")
            // body=%s dropped — passport PII (audit F2). dataKeys field-names only, safe.
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 ok but no user_id; dataKeys=[%s] bodyLen=%d",
                dataKeys, obj.toString().length,
            )
            setLastError(
                -7,
                "ok but data lacks user_id (cookie likely missing sessionid); dataKeys=[$dataKeys]",
            )
            return@withContext null
        }
        ProfileInfo(
            uid = rawUid,
            nickname = data.optStringOrNull("screen_name")
                ?: data.optStringOrNull("name")
                ?: data.optStringOrNull("nickname")
                ?: "(unnamed)",
            avatarUrl = data.optStringOrNull("avatar_url")
                ?: data.optStringOrNull("avatar_thumb"),
            mobile = data.optStringOrNull("mobile"),
            description = data.optStringOrNull("description")
                ?: data.optStringOrNull("signature"),
            // passport endpoint 不返 count 类字段；保留 0 占位，v0.3 _signature
            // path 走 /api/pc/feed/?category=pc_profile_v3 时补上。
            followingCount = data.optInt("following_count"),
            followerCount = data.optInt("followers_count"),
            mediaId = data.optStringOrNull("media_id")
                ?: data.optLong("media_id", 0L).takeIf { it > 0L }?.toString(),
        )
    }

    /**
     * v0.3 — Recommended feed (`/api/news/feed/v90/?category=__all__`). Each
     * item that the user dwelled on is a [FeedItem] read-history candidate.
     * Toutiao's recommended endpoint doesn't return an explicit "viewed at"
     * timestamp; we use `behot_time` (the publishing/promotion timestamp the
     * feed engine sorts by) as a stand-in. The collector treats these as
     * KIND_READ events but UI labels them "推荐流" to be honest about what
     * we have.
     */
    suspend fun fetchFeed(cookie: String, limit: Int = 50): List<FeedItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val rawUrl = baseUrl.newBuilder()
                .addPathSegments("api/news/feed/v90/")
                .addQueryParameter("category", "__all__")
                .addQueryParameter("aid", "24")
                .addQueryParameter("client_extra_params", "{}")
                .addQueryParameter("count", limit.toString())
                .build()
            val url = signProvider.signUrl(rawUrl, "feed")
            if (url == null) {
                setLastError(-99, "_signature unavailable (bridge not warm or rotated)")
                return@withContext emptyList()
            }
            val obj = doGetJson(url, cookie) ?: return@withContext emptyList()
            val data = obj.optJSONArray("data") ?: return@withContext emptyList()
            extractFeedItems(data, limit)
        }

    /**
     * v0.3 — Collected articles. `tab_comments` is misleadingly named: it's
     * the user's "my favorites" list in the Toutiao web app, returning
     * `data: [{ group_id, title, source, behot_time, ...}]`.
     */
    suspend fun fetchCollection(cookie: String, limit: Int = 200): List<CollectionItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val rawUrl = baseUrl.newBuilder()
                .addPathSegments("article/v2/tab_comments/")
                .addQueryParameter("aid", "24")
                .addQueryParameter("count", limit.toString())
                .build()
            val url = signProvider.signUrl(rawUrl, "comments")
            if (url == null) {
                setLastError(-99, "_signature unavailable (bridge not warm or rotated)")
                return@withContext emptyList()
            }
            val obj = doGetJson(url, cookie) ?: return@withContext emptyList()
            val data = obj.optJSONArray("data") ?: return@withContext emptyList()
            val out = ArrayList<CollectionItem>(minOf(limit, data.length()))
            for (i in 0 until minOf(limit, data.length())) {
                val item = data.optJSONObject(i) ?: continue
                val id = item.optStringOrNull("group_id")
                    ?: item.optStringOrNull("item_id")
                    ?: continue
                out.add(
                    CollectionItem(
                        itemId = id,
                        title = item.optStringOrNull("title") ?: "(no title)",
                        category = item.optStringOrNull("category"),
                        author = item.optJSONObject("user_info")?.optStringOrNull("name")
                            ?: item.optStringOrNull("source"),
                        savedAt = (item.optLong("behot_time").takeIf { it > 0 }
                            ?: item.optLong("create_time")) * 1000L,
                    ),
                )
            }
            out
        }

    /**
     * v0.3 — Search history. Toutiao web stores recent searches in
     * `/api/search/content/?keyword=<empty>` returns the user's recent
     * query list under `data.user_search_history` (when logged in).
     */
    suspend fun fetchSearchHistory(cookie: String, limit: Int = 100): List<SearchItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val rawUrl = baseUrl.newBuilder()
                .addPathSegments("api/search/content/")
                .addQueryParameter("aid", "24")
                .addQueryParameter("keyword", "")
                .addQueryParameter("count", limit.toString())
                .build()
            val url = signProvider.signUrl(rawUrl, "search")
            if (url == null) {
                setLastError(-99, "_signature unavailable (bridge not warm or rotated)")
                return@withContext emptyList()
            }
            val obj = doGetJson(url, cookie) ?: return@withContext emptyList()
            // Two response shapes observed: top-level `data.user_search_history`
            // OR nested `data.search_history`. Try both.
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val history = data.optJSONArray("user_search_history")
                ?: data.optJSONArray("search_history")
                ?: return@withContext emptyList()
            val out = ArrayList<SearchItem>(minOf(limit, history.length()))
            for (i in 0 until minOf(limit, history.length())) {
                val raw = history.opt(i) ?: continue
                val keyword: String
                val ts: Long
                when (raw) {
                    is JSONObject -> {
                        keyword = raw.optStringOrNull("keyword")
                            ?: raw.optStringOrNull("query")
                            ?: continue
                        ts = (raw.optLong("time").takeIf { it > 0 }
                            ?: raw.optLong("search_time")) * 1000L
                    }
                    is String -> {
                        // Older shape: bare string list, no timestamp. Use
                        // snapshot time minus index ordering so latest stays
                        // first in vault dedupe.
                        keyword = raw
                        ts = System.currentTimeMillis() - i * 1000L
                    }
                    else -> continue
                }
                if (keyword.isBlank()) continue
                out.add(SearchItem(keyword = keyword, searchedAt = ts))
            }
            out
        }

    private fun extractFeedItems(arr: JSONArray, limit: Int): List<FeedItem> {
        val out = ArrayList<FeedItem>(minOf(limit, arr.length()))
        for (i in 0 until minOf(limit, arr.length())) {
            val raw = arr.optJSONObject(i) ?: continue
            // Some feed cells have the real article nested under
            // `raw_data` (encoded JSON string); others are top-level.
            val item = decodeNestedRaw(raw) ?: raw
            val id = item.optStringOrNull("group_id")
                ?: item.optStringOrNull("item_id")
                ?: continue
            out.add(
                FeedItem(
                    itemId = id,
                    title = item.optStringOrNull("title") ?: "(no title)",
                    category = item.optStringOrNull("category")
                        ?: raw.optStringOrNull("category"),
                    author = item.optJSONObject("user_info")?.optStringOrNull("name")
                        ?: item.optStringOrNull("source"),
                    publishedAt = (item.optLong("behot_time").takeIf { it > 0 }
                        ?: item.optLong("publish_time")) * 1000L,
                    readDuration = item.optInt("read_duration", 0),
                    source = item.optStringOrNull("source"),
                ),
            )
        }
        return out
    }

    private fun decodeNestedRaw(cell: JSONObject): JSONObject? {
        val rawData = cell.optStringOrNull("raw_data") ?: return null
        return try {
            JSONObject(rawData)
        } catch (t: Throwable) {
            if (t is CancellationException) throw t  // audit F3 — propagate even if called from coroutine
            null
        }
    }

    private fun doGetJson(url: HttpUrl, cookie: String): JSONObject? {
        val req = Request.Builder()
            .url(url)
            .header("Cookie", cookie)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .header("Referer", "https://www.toutiao.com/")
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .build()
        return try {
            httpClient.newCall(req).execute().use { resp ->
                val body = resp.body?.string()
                if (body == null) {
                    setLastError(-1, "empty body")
                    return null
                }
                if (!resp.isSuccessful) {
                    // body=%s dropped — 401/403 redirect HTML may echo Set-Cookie (audit F2)
                    Timber.w(
                        "ToutiaoApiClient: %s -> HTTP %d bodyLen=%d",
                        url.encodedPath, resp.code, body.length,
                    )
                    setLastError(resp.code, "HTTP ${resp.code}")
                    return null
                }
                // 头条偶尔返 HTML 重定向（cookie 过期 / 反爬触发），先 trim 检测
                val trimmed = body.trimStart()
                if (!trimmed.startsWith("{")) {
                    Timber.w(
                        "ToutiaoApiClient: %s -> non-JSON body (likely login redirect or anti-bot)",
                        url.encodedPath,
                    )
                    setLastError(-4, "non-json (cookie expired or anti-bot triggered)")
                    return null
                }
                val obj = JSONObject(body)
                clearLastError()
                obj
            }
        } catch (e: IOException) {
            Timber.w(e, "ToutiaoApiClient: IO error on %s", url.encodedPath)
            setLastError(-2, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: Exception) {
            if (e is CancellationException) throw e  // audit F3
            Timber.w(e, "ToutiaoApiClient: parse error on %s", url.encodedPath)
            setLastError(-3, "parse: ${e.message ?: e.javaClass.simpleName}")
            null
        }
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

// org.json helpers — JSONObject's opt* return primitive defaults rather than
// null on miss, which makes "field exists vs field absent" indistinguishable.
private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val v = optString(key)
    return v.takeIf { it.isNotEmpty() }
}
