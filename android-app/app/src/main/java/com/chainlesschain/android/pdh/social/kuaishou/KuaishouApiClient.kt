package com.chainlesschain.android.pdh.social.kuaishou

import com.chainlesschain.android.pdh.social.NullSignProvider
import com.chainlesschain.android.pdh.social.SignProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.IOException
import java.net.URLDecoder
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.2 — Kuaishou (快手) www.kuaishou.com client.
 *
 * **小 surface 因 NS_sig3**：快手 web 几乎所有读接口 (GraphQL queries
 * visionFeedRecommend / visionProfilePhotoList / visionSearchPhoto) 都需
 * NS_sig3 签名（kuaishou anti-bot SDK，签名复杂度比抖音 X-Bogus 更高 —
 * multi-stage hash chain + visitor_id timestamp salt），没有可靠的纯
 * Kotlin 实现。
 *
 * v0.2 唯一接通的路径：**cookie 自带 payload 解析**。快手 web cookie 含一个
 * `kuaishou.web.cp.api_ph` 字段，值是 URL-encoded JSON，登录时由 passport
 * 写入，含完整账号信息（user_id / user_name / headurl / kuaishou_id /
 * sex / city ...）。**纯解析无网络调用** — 比 Toutiao 的 ByteDance passport
 * endpoint 更稳（不会被反爬 412 / 状态码漂移），代价是 follower/following
 * 等动态计数没有（需 v0.3 GraphQL 签名接通才能拿）。
 *
 * v0.2 fetchProfile suspend 是为了未来 v0.3 HTTP 加签名时能 in-place 升级；
 * v0.2 实现实际是 sync 的 parseProfileFromCookie。
 *
 * v0.3+ 待接通（NS_sig3 路径，需 WebView JS 注入或 NS_sig3 端口）：
 *   - `/graphql` visionFeedRecommend       推荐流（WATCH）
 *   - `/graphql` visionProfilePhotoList    用户主页 + 收藏（COLLECT）
 *   - `/graphql` visionSearchPhoto         搜索历史（SEARCH）
 *   - `/graphql` currentUser{following,followed} 动态计数（PROFILE counts）
 */
@Singleton
class KuaishouApiClient @Inject constructor() {

    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Override the base URL for MockWebServer in tests (v0.3+ when network lands). */
    var baseUrl: HttpUrl = "https://www.kuaishou.com/".toHttpUrl()

    /**
     * v0.3 — pluggable [SignProvider] for `__NS_sig3` GraphQL signing.
     * Defaults to [NullSignProvider]; production wires [KuaishouSignBridge].
     */
    var signProvider: SignProvider = NullSignProvider

    data class WatchItem(
        val photoId: String,
        val caption: String,
        val authorName: String?,
        val authorId: String?,
        val viewedAt: Long,
        val duration: Long,
    )

    data class ProfilePhotoItem(
        val photoId: String,
        val caption: String,
        val postedAt: Long,
    )

    data class SearchItem(
        val keyword: String,
        val searchedAt: Long,
    )

    data class ProfileInfo(
        val uid: String,
        val nickname: String,
        val kuaishouId: String?,
        val avatarUrl: String?,
        val sex: String?,
        val city: String?,
        val constellation: String?,
        val description: String?,
    )

    @Volatile var lastErrorCode: Int = 0
        private set
    @Volatile var lastErrorMessage: String? = null
        private set

    /**
     * v0.1 entry: WebView 把 cookie 字符串递回来后调本方法抽 uid + 校验"已登录"。
     *
     * 返回 null = cookie 不含可识别 userId 字段（基本可断定未登录 / 仅游客态）。
     */
    fun extractUid(cookie: String?): String? {
        if (cookie.isNullOrBlank()) {
            setLastError(-1, "cookie 为空")
            return null
        }
        // 首选：userId=N (登录后稳定写入)
        val userId = Regex("(?:^|; ?)userId=(\\d+)").find(cookie)?.groupValues?.getOrNull(1)
        if (userId != null && userId.isNotBlank() && userId != "0") {
            clearLastError()
            return userId
        }
        // 次选：legacy kuaishou.web.cp.api_ph 偶尔携 user_id 字段，best-effort
        val cp = Regex("(?:^|; ?)kuaishou\\.web\\.cp\\.api_ph=([^;]+)")
            .find(cookie)?.groupValues?.getOrNull(1)
        if (!cp.isNullOrBlank()) {
            val embeddedUid = extractEmbeddedUid(cp)
            if (embeddedUid != null) {
                clearLastError()
                return embeddedUid
            }
        }
        // 没找到任何 uid 字段 — cookie 是"匿名"或"登录未完成"
        setLastError(-7, "cookie 缺 userId / kuaishou.web.cp.api_ph 嵌套 user_id — 登录未完成或仅游客态")
        Timber.w(
            "KuaishouApiClient.extractUid: no uid candidate found in cookie (length=%d)",
            cookie.length,
        )
        return null
    }

    /**
     * v0.2 fetchProfile — 解析 cookie 中的 `kuaishou.web.cp.api_ph` 字段拿到
     * nickname / avatar / kuaishou_id 等。无网络调用，但保持 suspend 让 v0.3
     * 接通 GraphQL 签名时可 in-place 升级。
     *
     * 返 null 的情况：cookie 不含 api_ph 或解码失败（多见于仅 userId 单字段
     * 登录态，例如部分跨端登录路径）。这种情况 [extractUid] 仍可拿到 uid，
     * 上层可继续走 placeholder 流程。
     */
    suspend fun fetchProfile(cookie: String): ProfileInfo? = withContext(Dispatchers.IO) {
        if (cookie.isBlank()) {
            setLastError(-1, "cookie 为空")
            return@withContext null
        }
        val cpRaw = Regex("(?:^|; ?)kuaishou\\.web\\.cp\\.api_ph=([^;]+)")
            .find(cookie)?.groupValues?.getOrNull(1)
        if (cpRaw.isNullOrBlank()) {
            setLastError(-8, "cookie 缺 kuaishou.web.cp.api_ph (profile 解析需要)")
            return@withContext null
        }
        val decoded = try {
            URLDecoder.decode(cpRaw, "UTF-8")
        } catch (_: IllegalArgumentException) {
            // Not URL-encoded — try as raw
            cpRaw
        }
        // api_ph 通常是 base64 或直接 JSON；先 trim 查 JSON 开头
        val jsonCandidate = decoded.trimStart()
        if (!jsonCandidate.startsWith("{")) {
            setLastError(-9, "kuaishou.web.cp.api_ph 解码后非 JSON (likely base64 — v0.3 加 fallback)")
            Timber.w(
                "KuaishouApiClient.fetchProfile: api_ph not JSON after URL-decode (length=%d, head=%s)",
                decoded.length, decoded.take(50),
            )
            return@withContext null
        }
        val obj = try {
            JSONObject(jsonCandidate)
        } catch (t: Throwable) {
            setLastError(-3, "parse: ${t.message ?: t.javaClass.simpleName}")
            return@withContext null
        }
        val uid = (obj.optStringOrNull("user_id")
            ?: obj.optStringOrNull("userId")
            ?: obj.optLong("user_id", 0L).takeIf { it > 0L }?.toString()
            ?: obj.optLong("userId", 0L).takeIf { it > 0L }?.toString())
            ?.takeIf { it != "0" }  // user_id=0 is preview/guest, treat as missing
        if (uid == null) {
            val keys = obj.keys().asSequence().toList().joinToString(",")
            setLastError(
                -7,
                "api_ph JSON 缺 user_id (keys=[$keys])",
            )
            Timber.w(
                "KuaishouApiClient.fetchProfile: api_ph JSON lacks user_id; keys=[%s] body=%s",
                keys, jsonCandidate.take(300),
            )
            return@withContext null
        }
        clearLastError()
        ProfileInfo(
            uid = uid,
            nickname = obj.optStringOrNull("user_name")
                ?: obj.optStringOrNull("userName")
                ?: obj.optStringOrNull("nickname")
                ?: "(unnamed)",
            kuaishouId = obj.optStringOrNull("kuaishou_id")
                ?: obj.optStringOrNull("kuaishouId"),
            avatarUrl = obj.optStringOrNull("headurl")
                ?: obj.optStringOrNull("headUrl")
                ?: obj.optStringOrNull("avatar"),
            sex = obj.optStringOrNull("sex")
                ?: obj.optStringOrNull("gender"),
            city = obj.optStringOrNull("city"),
            constellation = obj.optStringOrNull("constellation"),
            description = obj.optStringOrNull("description")
                ?: obj.optStringOrNull("signature"),
        )
    }

    /**
     * v0.3 — Watch history via GraphQL `visionFeedRecommend` (kuaishou's
     * recommended feed; same query the web client uses to populate the
     * home page). Each photo the user dwelled on is a KIND_WATCH event.
     */
    suspend fun fetchWatchHistory(cookie: String, limit: Int = 50): List<WatchItem> =
        withContext(Dispatchers.IO) {
            val variables = JSONObject().apply {
                put("pcursor", "")
                put("count", limit)
            }.toString()
            val body = buildGraphQLBody(KuaishouSignBridge.OP_FEED_RECOMMEND, variables)
            val data = postGraphQL(cookie, KuaishouSignBridge.OP_FEED_RECOMMEND, body)
                ?: return@withContext emptyList()
            val feeds = data.optJSONObject("visionFeedRecommend")?.optJSONArray("feeds")
                ?: return@withContext emptyList()
            extractPhotoList(feeds, limit) { item, photoId, caption, ts ->
                WatchItem(
                    photoId = photoId,
                    caption = caption,
                    authorName = item.optJSONObject("author")?.optStringOrNull("name"),
                    authorId = item.optJSONObject("author")?.optStringOrNull("id"),
                    viewedAt = ts,
                    duration = item.optLong("duration"),
                )
            }
        }

    /**
     * v0.3 — User's own posted photos via `visionProfilePhotoList`. Acts as
     * a "what I've published" KIND_POST-equivalent (adapter normalizes as
     * KIND_COLLECT since Kuaishou doesn't track explicit "saved" client-side).
     */
    suspend fun fetchProfilePhotos(cookie: String, userId: String, limit: Int = 100): List<ProfilePhotoItem> =
        withContext(Dispatchers.IO) {
            val variables = JSONObject().apply {
                put("userId", userId)
                put("pcursor", "")
                put("count", limit)
                put("page", "profile")
            }.toString()
            val body = buildGraphQLBody(KuaishouSignBridge.OP_PROFILE_PHOTOS, variables)
            val data = postGraphQL(cookie, KuaishouSignBridge.OP_PROFILE_PHOTOS, body)
                ?: return@withContext emptyList()
            val feeds = data.optJSONObject("visionProfilePhotoList")?.optJSONArray("feeds")
                ?: return@withContext emptyList()
            extractPhotoList(feeds, limit) { _, photoId, caption, ts ->
                ProfilePhotoItem(
                    photoId = photoId,
                    caption = caption,
                    postedAt = ts,
                )
            }
        }

    /**
     * v0.3 — Recent search keywords via `visionSearchPhoto` (passing an
     * empty `keyword` argument the server returns the user's recent
     * search history if logged in). Best-effort: some accounts get an
     * empty `recentSearchList` and we degrade to empty.
     */
    suspend fun fetchSearchHistory(cookie: String, limit: Int = 50): List<SearchItem> =
        withContext(Dispatchers.IO) {
            val variables = JSONObject().apply {
                put("keyword", "")
                put("pcursor", "")
                put("page", "search")
            }.toString()
            val body = buildGraphQLBody(KuaishouSignBridge.OP_SEARCH_PHOTO, variables)
            val data = postGraphQL(cookie, KuaishouSignBridge.OP_SEARCH_PHOTO, body)
                ?: return@withContext emptyList()
            // Two possible shapes — `recentSearchList` on logged-in
            // accounts; `suggestKeywords` on cold sessions. Try both.
            val recent = data.optJSONObject("visionSearchPhoto")?.optJSONArray("recentSearchList")
                ?: data.optJSONObject("visionSearchPhoto")?.optJSONArray("history")
                ?: return@withContext emptyList()
            val out = ArrayList<SearchItem>(minOf(limit, recent.length()))
            for (i in 0 until minOf(limit, recent.length())) {
                val raw = recent.opt(i) ?: continue
                val keyword: String
                val ts: Long
                when (raw) {
                    is JSONObject -> {
                        keyword = raw.optStringOrNull("keyword")
                            ?: raw.optStringOrNull("query")
                            ?: continue
                        ts = (raw.optLong("time").takeIf { it > 0 }
                            ?: raw.optLong("searchTime")) * 1000L
                    }
                    is String -> {
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

    private fun buildGraphQLBody(operationName: String, variablesJson: String): String {
        // We send a minimal POST body — Kuaishou's GraphQL endpoint is
        // permissive about the `query` field being elided when the server
        // already has the operation by name (registered queries). Empty
        // query keeps the request small + avoids re-shipping the schema.
        return JSONObject().apply {
            put("operationName", operationName)
            put("variables", JSONObject(variablesJson))
            put("query", "")
        }.toString()
    }

    private suspend fun postGraphQL(cookie: String, operationName: String, body: String): JSONObject? =
        withContext(Dispatchers.IO) {
            val rawUrl = baseUrl.newBuilder().addPathSegments("graphql").build()
            val purpose = "$operationName|$body"
            val signed = signProvider.signUrl(rawUrl, purpose)
            if (signed == null) {
                setLastError(-99, "__NS_sig3 unavailable (bridge not warm or rotated)")
                return@withContext null
            }
            val headers = signProvider.signedHeaders(rawUrl, purpose)
            doPostJson(signed, cookie, body, headers)?.optJSONObject("data")
        }

    private fun <T : Any> extractPhotoList(
        feeds: JSONArray,
        limit: Int,
        build: (JSONObject, String, String, Long) -> T?,
    ): List<T> {
        val out = ArrayList<T>(minOf(limit, feeds.length()))
        for (i in 0 until minOf(limit, feeds.length())) {
            val item = feeds.optJSONObject(i) ?: continue
            // Kuaishou GraphQL nests the photo under `photo` on feed-recommend
            // and on profile-photo. Try nested first then flat fallback.
            val photo = item.optJSONObject("photo") ?: item
            val photoId = photo.optStringOrNull("id") ?: continue
            val caption = photo.optStringOrNull("caption") ?: "(no caption)"
            val ts = (photo.optLong("timestamp").takeIf { it > 0 }
                ?: photo.optLong("createTime")) * 1000L
            val built = build(item, photoId, caption, ts) ?: continue
            out.add(built)
        }
        return out
    }

    private fun doPostJson(
        url: HttpUrl,
        cookie: String,
        body: String,
        extraHeaders: Map<String, String> = emptyMap(),
    ): JSONObject? {
        val mediaType = "application/json".toMediaTypeOrNull()
        val builder = Request.Builder()
            .url(url)
            .post(body.toRequestBody(mediaType))
            .header("Cookie", cookie)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .header("Referer", "https://www.kuaishou.com/")
            .header("Origin", "https://www.kuaishou.com")
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .header("Content-Type", "application/json")
        for ((k, v) in extraHeaders) {
            builder.header(k, v)
        }
        val req = builder.build()
        return try {
            httpClient.newCall(req).execute().use { resp ->
                val rawBody = resp.body?.string()
                if (rawBody == null) {
                    setLastError(-1, "empty body")
                    return null
                }
                if (!resp.isSuccessful) {
                    Timber.w(
                        "KuaishouApiClient: %s -> HTTP %d body=%s",
                        url.encodedPath, resp.code, rawBody.take(200),
                    )
                    setLastError(resp.code, "HTTP ${resp.code}")
                    return null
                }
                val trimmed = rawBody.trimStart()
                if (!trimmed.startsWith("{")) {
                    Timber.w(
                        "KuaishouApiClient: %s -> non-JSON body (likely anti-bot)",
                        url.encodedPath,
                    )
                    setLastError(-4, "non-json (cookie expired or anti-bot triggered)")
                    return null
                }
                val obj = JSONObject(rawBody)
                // GraphQL errors come back as `{errors: [...]}` with HTTP 200.
                val errors = obj.optJSONArray("errors")
                if (errors != null && errors.length() > 0) {
                    val first = errors.optJSONObject(0)
                    val msg = first?.optString("message") ?: "graphql error"
                    Timber.w("KuaishouApiClient: GraphQL error %s", msg)
                    setLastError(-5, "graphql: $msg")
                    return null
                }
                clearLastError()
                obj
            }
        } catch (e: IOException) {
            Timber.w(e, "KuaishouApiClient: IO error on %s", url.encodedPath)
            setLastError(-2, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: Exception) {
            Timber.w(e, "KuaishouApiClient: parse error on %s", url.encodedPath)
            setLastError(-3, "parse: ${e.message ?: e.javaClass.simpleName}")
            null
        }
    }

    /** Extract numeric uid from URL-encoded api_ph cookie payload (best-effort). */
    private fun extractEmbeddedUid(cpRaw: String): String? {
        val decoded = try {
            URLDecoder.decode(cpRaw, "UTF-8")
        } catch (_: IllegalArgumentException) {
            cpRaw
        }
        // 优先嵌套 JSON 字段
        val embeddedUid = Regex("\"?user_id\"?\\s*:\\s*\"?(\\d+)\"?").find(decoded)?.groupValues?.getOrNull(1)
            ?: Regex("\"?uid\"?\\s*:\\s*\"?(\\d+)\"?").find(decoded)?.groupValues?.getOrNull(1)
            ?: Regex("\"?userId\"?\\s*:\\s*\"?(\\d+)\"?").find(decoded)?.groupValues?.getOrNull(1)
        if (embeddedUid != null && embeddedUid.isNotBlank() && embeddedUid != "0") {
            return embeddedUid
        }
        return null
    }

    /**
     * v0.3 placeholder — 实际 HTTP fetch helper（与 Toutiao/Douyin 对称）。
     * 当前未被 fetchProfile 用，但保留 wire-ready 让 v0.3 1-line 启用。
     */
    @Suppress("Unused")
    private fun doGetJson(url: HttpUrl, cookie: String): JSONObject? {
        val req = Request.Builder()
            .url(url)
            .header("Cookie", cookie)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .header("Referer", "https://www.kuaishou.com/")
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
                    Timber.w(
                        "KuaishouApiClient: %s -> HTTP %d body=%s",
                        url.encodedPath, resp.code, body.take(200),
                    )
                    setLastError(resp.code, "HTTP ${resp.code}")
                    return null
                }
                val trimmed = body.trimStart()
                if (!trimmed.startsWith("{")) {
                    Timber.w(
                        "KuaishouApiClient: %s -> non-JSON body (likely login redirect or anti-bot)",
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
            Timber.w(e, "KuaishouApiClient: IO error on %s", url.encodedPath)
            setLastError(-2, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: Exception) {
            Timber.w(e, "KuaishouApiClient: parse error on %s", url.encodedPath)
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

private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val v = optString(key)
    return v.takeIf { it.isNotEmpty() }
}
