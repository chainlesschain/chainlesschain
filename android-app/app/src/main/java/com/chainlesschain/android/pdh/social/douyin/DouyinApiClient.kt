package com.chainlesschain.android.pdh.social.douyin

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
        val url = baseUrl.newBuilder()
            .addPathSegments("aweme/v1/passport/account/info/v2/")
            .addQueryParameter("aid", "2906")
            .build()
        val obj = doGetJson(url, cookie) ?: return@withContext null
        // Endpoint shape: { status_code: 0, data: { user_id, screen_name, ... } }
        val statusCode = obj.optInt("status_code", -1)
        if (statusCode != 0) {
            setLastError(statusCode, obj.optString("status_msg"))
            return@withContext null
        }
        val data = obj.optJSONObject("data") ?: return@withContext null
        val secUid = data.optStringOrNull("sec_user_id")
            ?: data.optStringOrNull("sec_uid")
            ?: return@withContext null  // 没 sec_user_id → 视作未登录
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

    private fun doGetJson(url: HttpUrl, cookie: String): JSONObject? {
        val req = Request.Builder()
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
                        "DouyinApiClient: %s -> HTTP %d body=%s",
                        url.encodedPath, resp.code, body.take(200),
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
