package com.chainlesschain.android.pdh.social.toutiao

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

    /**
     * 调 /passport/account/info/v2/?aid=24 拿 user_id + 基本资料 + 验登录态。
     * 返回 null = cookie 失效或登录未完成。aid=24 是头条 web 的 client id
     * （Douyin 是 aid=2906）。passport endpoint 返回 status_code=0 表示成功；
     * 非 0 表示失败（cookie 过期 / 限流）。
     */
    suspend fun fetchProfile(cookie: String): ProfileInfo? = withContext(Dispatchers.IO) {
        val url = baseUrl.newBuilder()
            .addPathSegments("passport/account/info/v2/")
            .addQueryParameter("aid", "24")
            .build()
        val obj = doGetJson(url, cookie) ?: return@withContext null
        val statusCode = obj.optInt("status_code", Int.MIN_VALUE)
        if (statusCode == Int.MIN_VALUE) {
            val topKeys = obj.keys().asSequence().toList().joinToString(",")
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 missing status_code; topKeys=[%s] body=%s",
                topKeys, obj.toString().take(500),
            )
            setLastError(-5, "passport/info/v2 missing status_code (keys=[$topKeys])")
            return@withContext null
        }
        if (statusCode != 0) {
            val msg = obj.optStringOrNull("status_msg")
                ?: obj.optStringOrNull("message")
                ?: obj.optStringOrNull("error_description")
                ?: "status_code=$statusCode"
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 status_code=%d msg=%s body=%s",
                statusCode, msg, obj.toString().take(500),
            )
            setLastError(statusCode, msg)
            return@withContext null
        }
        val data = obj.optJSONObject("data")
        if (data == null) {
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 status_code=0 but no `data` object; body=%s",
                obj.toString().take(500),
            )
            setLastError(-6, "status_code=0 but no `data` object")
            return@withContext null
        }
        val rawUid = data.optStringOrNull("user_id")
            ?: data.optLong("user_id_str", 0L).takeIf { it > 0L }?.toString()
            ?: data.optLong("user_id", 0L).takeIf { it > 0L }?.toString()
        if (rawUid == null) {
            val dataKeys = data.keys().asSequence().toList().joinToString(",")
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 ok but no user_id; dataKeys=[%s] body=%s",
                dataKeys, obj.toString().take(500),
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
                    Timber.w(
                        "ToutiaoApiClient: %s -> HTTP %d body=%s",
                        url.encodedPath, resp.code, body.take(200),
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
