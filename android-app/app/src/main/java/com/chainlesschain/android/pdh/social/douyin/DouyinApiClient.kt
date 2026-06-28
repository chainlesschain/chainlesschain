package com.chainlesschain.android.pdh.social.douyin

import com.chainlesschain.android.pdh.social.NullSignProvider
import com.chainlesschain.android.pdh.social.SignProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import timber.log.Timber
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.2 — Douyin (抖音) www.douyin.com API client. **小 surface 因 X-Bogus**
 * — 抖音 web 几乎所有读接口（history/like/favourite/aweme/post/...）都需
 * X-Bogus + msToken 签名头，签名由 mssdk.js 客户端 JS 计算，没有可靠的纯
 * Kotlin 实现（mssdk.js 经常 obfuscate rotate）。
 *
 * v0.2 唯一接通的端点：
 *   - `/aweme/v1/passport/account/info/v2/?aid=2906` — 老式 passport 接口，
 *     cookie + aid 就行，**无 X-Bogus**。返 `{ data: { user_id, screen_name,
 *     mobile, avatar_url, sec_user_id, short_id, signature, ... } }`。
 *
 * v0.3+ 待接通（X-Bogus 路径，需 WebView JS 注入或者自己实现签名算法）：
 *   - `/aweme/v1/web/history/read/`             观看历史
 *   - `/aweme/v1/web/aweme/favorite/`           点赞过
 *   - `/aweme/v1/web/aweme/post/`               自己发布过的作品
 *   - `/aweme/v1/web/user/profile/other/`       用户主页详情
 *
 * v0.2 caveats:
 *   - 反爬 strong: 抖音对没浏览器 UA / 没 ttwid / 没 __ac_nonce 的请求频繁
 *     返 401 / 30x / HTML 重定向。User-Agent 必须像桌面 Chrome；Referer
 *     必须 www.douyin.com。
 *   - 一些 cookie 字段（msToken / __ac_nonce）刷新很快（5-15min 一轮）。WebView
 *     抓的 cookie 进 EncryptedSharedPreferences 后若过期，account/info/v2 会
 *     返 ok=0 + msg="token expired" — 引导重 login。
 */
@Singleton
class DouyinApiClient @Inject constructor() {

    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Override the base URL for MockWebServer in tests. */
    var baseUrl: HttpUrl = "https://www.douyin.com/".toHttpUrl()

    /**
     * v0.3 — pluggable [SignProvider] for `_signature` + `X-Bogus`. Defaults
     * to [NullSignProvider] so v0.2 callers (fetchProfile only, no signing
     * needed) keep working. Production wires [DouyinSignBridge]; JVM tests
     * inject a stub that returns deterministic values + header pair.
     */
    var signProvider: SignProvider = NullSignProvider

    data class HistoryItem(
        val awemeId: String,
        val description: String,
        val authorSecUid: String?,
        val authorNickname: String?,
        val watchedAt: Long,
        val duration: Long,
    )

    data class FavouriteItem(
        val awemeId: String,
        val description: String,
        val authorNickname: String?,
        val savedAt: Long,
    )

    data class LikeItem(
        val awemeId: String,
        val description: String,
        val authorNickname: String?,
        val likedAt: Long,
    )

    data class ProfileInfo(
        val secUid: String,
        val shortId: String?,
        val nickname: String,
        val signature: String?,
        val avatarUrl: String?,
        val followingCount: Int,
        val followerCount: Int,
        val awemeCount: Int,
        val favoritingCount: Int,
        val totalFavorited: Int,
    )

    /**
     * 调 /aweme/v1/passport/account/info/v2/ 拿 sec_user_id + 基本资料 + 验登
     * 录态。返回 null = cookie 失效或登录未完成。
     *
     * 注意：抖音的 passport endpoint 返回 ok=0 / status_code=0 表示成功；非 0
     * 表示失败（cookie 过期 / 限流）。
     */
    suspend fun fetchProfile(cookie: String): ProfileInfo? = withContext(Dispatchers.IO) {
        if (cookie.isBlank()) {  // audit F4
            setLastError(-8, "missing cookie")
            return@withContext null
        }
        val url = baseUrl.newBuilder()
            .addPathSegments("aweme/v1/passport/account/info/v2/")
            .addQueryParameter("aid", "2906")
            .build()
        val obj = doGetJson(url, cookie) ?: return@withContext null
        // Endpoint shape: { status_code: 0, data: { user_id, screen_name, ... } }
        val statusCode = obj.optInt("status_code", Int.MIN_VALUE)
        if (statusCode == Int.MIN_VALUE) {
            // No status_code field at all — likely endpoint shape changed.
            val topKeys = obj.keys().asSequence().toList().joinToString(",")
            // body=%s logging dropped — passport response contains mobile / screen_name
            // / sec_user_id / avatar_url PII (audit 2026-05-29 §S5 / F2).
            Timber.w(
                "DouyinApiClient: passport/info/v2 missing status_code; topKeys=[%s] bodyLen=%d",
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
            // body excerpt dropped — passport JSON contains PII (audit F2)
            Timber.w(
                "DouyinApiClient: passport/info/v2 status_code=%d msg=%s bodyLen=%d",
                statusCode, msg, obj.toString().length,
            )
            setLastError(statusCode, msg)
            return@withContext null
        }
        val data = obj.optJSONObject("data")
        if (data == null) {
            // body excerpt dropped — passport JSON contains PII (audit F2)
            Timber.w(
                "DouyinApiClient: passport/info/v2 status_code=0 but no `data` object; bodyLen=%d",
                obj.toString().length,
            )
            setLastError(-6, "status_code=0 but no `data` object")
            return@withContext null
        }
        val secUid = data.optStringOrNull("sec_user_id")
            ?: data.optStringOrNull("sec_uid")
        if (secUid == null) {
            // 没 sec_user_id → 视作未登录。最常见原因：cookie 缺 sessionid /
            // passport_csrf_token，passport endpoint 返 ok 但 data 是匿名 shape
            // (只剩 device 字段等)。Surface data 字段名让用户能定位。
            val dataKeys = data.keys().asSequence().toList().joinToString(",")
            // body excerpt dropped — passport JSON contains PII (audit F2)
            Timber.w(
                "DouyinApiClient: passport/info/v2 ok but no sec_user_id; dataKeys=[%s] bodyLen=%d",
                dataKeys, obj.toString().length,
            )
            setLastError(
                ERR_NO_SEC_UID,
                "ok but data lacks sec_user_id (cookie likely missing sessionid); dataKeys=[$dataKeys]",
            )
            return@withContext null
        }
        ProfileInfo(
            secUid = secUid,
            shortId = data.optStringOrNull("short_id")
                ?: data.optLong("user_id").takeIf { it > 0L }?.toString(),
            nickname = data.optStringOrNull("screen_name")
                ?: data.optStringOrNull("nickname")
                ?: "(unnamed)",
            signature = data.optStringOrNull("signature"),
            avatarUrl = data.optStringOrNull("avatar_url")
                ?: data.optStringOrNull("avatar_thumb"),
            // v2 endpoint 不返 count 类字段；保留 0 占位，v0.3 X-Bogus path
            // 走 /web/user/profile/other/ 时补上。
            followingCount = data.optInt("following_count"),
            followerCount = data.optInt("follower_count"),
            awemeCount = data.optInt("aweme_count"),
            favoritingCount = data.optInt("favoriting_count"),
            totalFavorited = data.optInt("total_favorited"),
        )
    }

    @Volatile var lastErrorCode: Int = 0
        private set
    @Volatile var lastErrorMessage: String? = null
        private set

    /**
     * v0.3 — Watch history (`/aweme/v1/web/history/read/`). Returns a list
     * of awemes the user dwelled on. `aweme_list` carries the metadata
     * (aweme_id / desc / author / create_time → watched_at heuristic).
     */
    suspend fun fetchHistory(cookie: String, limit: Int = 50): List<HistoryItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val rawUrl = baseUrl.newBuilder()
                .addPathSegments("aweme/v1/web/history/read/")
                .addQueryParameter("aid", "6383")
                .addQueryParameter("device_platform", "webapp")
                .addQueryParameter("count", limit.toString())
                .build()
            val signed = signProvider.signUrl(rawUrl, "history")
            if (signed == null) {
                setLastError(-99, "X-Bogus/_signature unavailable (bridge not warm or rotated)")
                return@withContext emptyList()
            }
            val headers = signProvider.signedHeaders(rawUrl, "history")
            val obj = doGetJson(signed, cookie, headers) ?: return@withContext emptyList()
            extractAwemeList(obj) { item, desc, author, ts ->
                HistoryItem(
                    awemeId = item.optStringOrNull("aweme_id") ?: return@extractAwemeList null,
                    description = desc,
                    authorSecUid = author?.optStringOrNull("sec_uid"),
                    authorNickname = author?.optStringOrNull("nickname"),
                    watchedAt = ts,
                    duration = item.optLong("duration"),
                )
            }
        }

    /**
     * v0.3 — Favourites/collected awemes (`/aweme/v1/web/aweme/favorite/`).
     */
    suspend fun fetchFavourites(cookie: String, limit: Int = 100): List<FavouriteItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val rawUrl = baseUrl.newBuilder()
                .addPathSegments("aweme/v1/web/aweme/favorite/")
                .addQueryParameter("aid", "6383")
                .addQueryParameter("device_platform", "webapp")
                .addQueryParameter("count", limit.toString())
                .build()
            val signed = signProvider.signUrl(rawUrl, "favourite")
            if (signed == null) {
                setLastError(-99, "X-Bogus/_signature unavailable (bridge not warm or rotated)")
                return@withContext emptyList()
            }
            val headers = signProvider.signedHeaders(rawUrl, "favourite")
            val obj = doGetJson(signed, cookie, headers) ?: return@withContext emptyList()
            extractAwemeList(obj) { item, desc, author, ts ->
                FavouriteItem(
                    awemeId = item.optStringOrNull("aweme_id") ?: return@extractAwemeList null,
                    description = desc,
                    authorNickname = author?.optStringOrNull("nickname"),
                    savedAt = ts,
                )
            }
        }

    /**
     * v0.3 — Liked awemes (`/aweme/v1/web/aweme/post/like/`). Note: this is
     * "videos the user has 点赞'd" — distinct from favourites which are
     * "videos the user has saved to favorites folder". Same response shape
     * (`aweme_list` of aweme objects).
     */
    suspend fun fetchLikes(cookie: String, limit: Int = 100): List<LikeItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val rawUrl = baseUrl.newBuilder()
                .addPathSegments("aweme/v1/web/aweme/post/like/")
                .addQueryParameter("aid", "6383")
                .addQueryParameter("device_platform", "webapp")
                .addQueryParameter("count", limit.toString())
                .build()
            val signed = signProvider.signUrl(rawUrl, "like")
            if (signed == null) {
                setLastError(-99, "X-Bogus/_signature unavailable (bridge not warm or rotated)")
                return@withContext emptyList()
            }
            val headers = signProvider.signedHeaders(rawUrl, "like")
            val obj = doGetJson(signed, cookie, headers) ?: return@withContext emptyList()
            extractAwemeList(obj) { item, desc, author, ts ->
                LikeItem(
                    awemeId = item.optStringOrNull("aweme_id") ?: return@extractAwemeList null,
                    description = desc,
                    authorNickname = author?.optStringOrNull("nickname"),
                    likedAt = ts,
                )
            }
        }

    private fun <T : Any> extractAwemeList(
        obj: JSONObject,
        build: (JSONObject, String, JSONObject?, Long) -> T?,
    ): List<T> {
        val list = obj.optJSONArray("aweme_list") ?: return emptyList()
        val out = ArrayList<T>(list.length())
        for (i in 0 until list.length()) {
            val item = list.optJSONObject(i) ?: continue
            val desc = item.optStringOrNull("desc") ?: "(no desc)"
            val author = item.optJSONObject("author")
            val ts = (item.optLong("create_time").takeIf { it > 0 } ?: item.optLong("time")) * 1000L
            val built = build(item, desc, author, ts) ?: continue
            out.add(built)
        }
        return out
    }

    private fun doGetJson(url: HttpUrl, cookie: String, extraHeaders: Map<String, String> = emptyMap()): JSONObject? {
        val builder = Request.Builder()
            .url(url)
            .header("Cookie", cookie)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .header("Referer", "https://www.douyin.com/")
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        for ((k, v) in extraHeaders) {
            builder.header(k, v)
        }
        val req = builder.build()
        return try {
            httpClient.newCall(req).execute().use { resp ->
                val body = resp.body?.string()
                if (body == null) {
                    setLastError(-1, "empty body")
                    return null
                }
                if (!resp.isSuccessful) {
                    // body excerpt dropped — error bodies may echo Set-Cookie /
                    // cookie fragments (audit F2)
                    Timber.w(
                        "DouyinApiClient: %s -> HTTP %d bodyLen=%d",
                        url.encodedPath, resp.code, body.length,
                    )
                    setLastError(resp.code, "HTTP ${resp.code}")
                    return null
                }
                // 抖音偶尔返 HTML 重定向（cookie 过期 / 反爬触发），先 trim 检测
                val trimmed = body.trimStart()
                if (!trimmed.startsWith("{")) {
                    Timber.w(
                        "DouyinApiClient: %s -> non-JSON body (likely login redirect or anti-bot)",
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
            Timber.w(e, "DouyinApiClient: IO error on %s", url.encodedPath)
            setLastError(-2, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: Exception) {
            if (e is CancellationException) throw e  // audit F3
            Timber.w(e, "DouyinApiClient: parse error on %s", url.encodedPath)
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

    companion object {
        /**
         * lastErrorCode sentinel for the "soft" anti-crawler case: passport
         * /info/v2 returned an ok-shaped body but with no `sec_user_id` (cookie
         * may still be valid; Douyin's acrawler isn't loaded on the login page
         * so secUid can't be resolved at login time). Callers treat this as a
         * lazy-resolve case (save the cookie, resolve secUid later) rather than
         * a hard auth failure. Genuine upstream errors carry the real
         * `status_code` (e.g. 2154 token-expired) and must be surfaced instead.
         */
        const val ERR_NO_SEC_UID = -7

        /**
         * 从抖音 web cookie 中抠 short_id (numeric)。cookie key 是 `uid_tt`
         * 或 `uid_tt_ss`，值是 32-char hex（不是直接 short id），实际 short
         * id 仍要走 fetchProfile 拿。但 cookie 里偶尔也有 `sid_uid_tt` 等纯
         * 数字字段，提供 best-effort fallback 让 UI 在 fetchProfile 失败时
         * 也能显示 *something*。返 null = 未找到任何看起来像 short_id 的
         * cookie 字段。
         */
        internal fun extractShortIdFromCookie(cookie: String?): String? {
            if (cookie.isNullOrBlank()) return null
            // Match `sid_uid_tt=12345678;` 或 `uid_tt=hex;` — 优先纯数字
            val numericMatch = Regex("(?:^|; ?)(?:sid_uid_tt|uid_tt|aweme_user_id)=(\\d+)")
                .find(cookie)
            return numericMatch?.groupValues?.getOrNull(1)
        }
    }
}

// org.json helpers — JSONObject's opt* return primitive defaults rather than
// null on miss, which makes "field exists vs field absent" indistinguishable.
private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val v = optString(key)
    return v.takeIf { it.isNotEmpty() }
}
