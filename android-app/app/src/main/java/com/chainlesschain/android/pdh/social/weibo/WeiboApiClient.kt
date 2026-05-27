package com.chainlesschain.android.pdh.social.weibo

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
 * §A8 v0.2 — Weibo (微博) m.weibo.cn public API client driven by captured
 * browser cookie. 1:1 镜像 BilibiliApiClient 模式，但有 3 个 Weibo-specific
 * 差异：
 *
 *  1) UID 不在 cookie 字段中（Bilibili 是 DedeUserID=12345 直读）。微博的 SUB
 *     cookie 是 Base64 加密的复合 token，逆向不稳定。改走 async fetchUid 调用
 *     /api/config 拿 uid，存入 store。
 *  2) 时间字段是 ISO 8601 字符串（"Sun Jan 12 13:45:00 +0800 2026"）需 Java
 *     SimpleDateFormat 解，不是 Bilibili 的 unix-seconds。
 *  3) timeline endpoint 用 containerid 拼接 — 用户自己的微博走 107603<uid>，
 *     不是单独 /api/posts 路径。
 *
 * Endpoints (covers 3 "kinds"):
 *   - config     /api/config (拿 uid + 验登录态)
 *   - posts      /api/container/getIndex?type=uid&value=<uid>&containerid=107603<uid>
 *   - favourites /api/favorites?page=1 (m.weibo.cn 收藏夹)
 *   - follows    /api/friendships/friends?uid=<uid>&page=1
 *
 * v0.2 caveats:
 *   - WBI / X-Bogus 签名: m.weibo.cn 移动端 API 无需签名；weibo.com 桌面端有
 *     XSRF-TOKEN。本 client 锁定 m.weibo.cn，桌面端 endpoint v0.3+ 单独 wire。
 *   - 反爬 medium: 微博对没 Mobile UA 的 OkHttp 默认 UA 会返 -100 silentband
 *     或 30x 重定向到登录页。User-Agent 必须像移动 Chrome；Referer 必须 m.weibo.cn。
 *   - 用户 cookie 的微博带 anti-cookie-hijack 检测：单 IP 短时间频繁请求会触发
 *     "网络繁忙"。collector 顺序 await 避免并发触雷。
 */
@Singleton
class WeiboApiClient @Inject constructor() {

    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Override the base URL for MockWebServer in tests. */
    var baseUrl: HttpUrl = "https://m.weibo.cn/".toHttpUrl()

    data class PostItem(
        val mid: String,
        val text: String,
        val createdAt: Long,
        val source: String?,
        val repostsCount: Int,
        val commentsCount: Int,
        val likesCount: Int,
        val picCount: Int,
    )

    data class FavouriteItem(
        val mid: String,
        val text: String,
        val favAt: Long,
        val authorScreenName: String?,
    )

    data class FollowItem(
        val uid: Long,
        val screenName: String,
        val description: String?,
        val avatarUrl: String?,
        val followedAt: Long,
    )

    /**
     * 调 /api/config 拿 UID + 验登录态。返回 null = cookie 失效或登录未完成。
     * 与 Bilibili 不同：Weibo cookie 中无可靠 UID 字段，必须发一次 HTTP 调用。
     */
    suspend fun fetchUid(cookie: String): Long? = withContext(Dispatchers.IO) {
        val url = baseUrl.newBuilder().addPathSegments("api/config").build()
        val obj = doGetJson(url, cookie) ?: return@withContext null
        val data = obj.optJSONObject("data") ?: return@withContext null
        val login = data.optBoolean("login", false)
        if (!login) return@withContext null
        val uidStr = data.optString("uid")
        uidStr.toLongOrNull()?.takeIf { it > 0L }
    }

    /** 用户自己发布的微博 (timeline)。 */
    suspend fun fetchPosts(cookie: String, uid: Long, limit: Int = 100): List<PostItem> =
        withContext(Dispatchers.IO) {
            val containerid = "107603$uid"
            val url = baseUrl.newBuilder()
                .addPathSegments("api/container/getIndex")
                .addQueryParameter("type", "uid")
                .addQueryParameter("value", uid.toString())
                .addQueryParameter("containerid", containerid)
                .build()
            val obj = doGetJson(url, cookie) ?: return@withContext emptyList()
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val cards = data.optJSONArray("cards") ?: return@withContext emptyList()
            val out = ArrayList<PostItem>(minOf(limit, cards.length()))
            for (i in 0 until cards.length()) {
                if (out.size >= limit) break
                val card = cards.optJSONObject(i) ?: continue
                // card_type=9 = mblog (其它是 banner / topic / 占位)
                if (card.optInt("card_type") != 9) continue
                val blog = card.optJSONObject("mblog") ?: continue
                val mid = blog.optString("mid").takeIf { it.isNotBlank() }
                    ?: blog.optString("id").takeIf { it.isNotBlank() }
                    ?: continue
                out.add(
                    PostItem(
                        mid = mid,
                        text = stripHtml(blog.optString("text")),
                        createdAt = parseWeiboTime(blog.optString("created_at")),
                        source = blog.optStringOrNull("source"),
                        repostsCount = blog.optInt("reposts_count"),
                        commentsCount = blog.optInt("comments_count"),
                        likesCount = blog.optInt("attitudes_count"),
                        picCount = blog.optInt("pic_num"),
                    )
                )
            }
            out
        }

    /**
     * 收藏夹。
     *
     * 2026-05-27 真机测试 (Xiaomi 24115RA8EC) 证实 m.weibo.cn `/api/favorites`
     * **endpoint 已被微博服务端下线** — 返 200 OK + `{"ok":0,"msg":"出错了:
     * 链接http://m.weibo.cn/api/favorites无效"}`。微博自己服务端的错误文案
     * 直接说 "链接无效"，与 cookie / 签名 / UA 无关。
     *
     * 桌面端 weibo.com `/ajax/favorites/all_fav` 仍工作，但要 XSRF-TOKEN 签
     * 名，本 client 锁定 m.weibo.cn 不支持。v0.3 + WeiboDesktopApiClient 路径
     * 加。
     *
     * 当前实现：优雅降级 — 直接返空列表，不触 setLastError，让 collector
     * everythingEmpty 判定时不把缺失的收藏算作 "全空" 错误。posts + follows
     * 仍可正常拉。
     */
    suspend fun fetchFavourites(cookie: String, limit: Int = 100): List<FavouriteItem> {
        Timber.i("WeiboApiClient: skipping /api/favorites — endpoint deprecated by Weibo (返 链接无效)")
        return emptyList()
    }

    /** 关注列表。 */
    suspend fun fetchFollows(cookie: String, uid: Long, limit: Int = 200): List<FollowItem> =
        withContext(Dispatchers.IO) {
            val url = baseUrl.newBuilder()
                .addPathSegments("api/friendships/friends")
                .addQueryParameter("uid", uid.toString())
                .addQueryParameter("page", "1")
                .build()
            val obj = doGetJson(url, cookie) ?: return@withContext emptyList()
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val users = data.optJSONArray("users") ?: return@withContext emptyList()
            val out = ArrayList<FollowItem>(minOf(limit, users.length()))
            for (i in 0 until minOf(limit, users.length())) {
                val u = users.optJSONObject(i) ?: continue
                val followUid = u.optLong("id")
                if (followUid == 0L) continue
                out.add(
                    FollowItem(
                        uid = followUid,
                        screenName = u.optString("screen_name").takeIf { it.isNotBlank() }
                            ?: "(unnamed)",
                        description = u.optStringOrNull("description"),
                        avatarUrl = u.optStringOrNull("profile_image_url"),
                        // m.weibo.cn /api/friendships/friends 不返 follow time
                        // 字段，统一用 fetch 时间 + index 衍生 (粗排即可)。
                        followedAt = 0L,
                    )
                )
            }
            out
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
                "Mozilla/5.0 (Linux; Android 14; ChainlessChain) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            )
            .header("Referer", "https://m.weibo.cn/")
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            // m.weibo.cn 反检测信号：必须 XHR 头，否则返 HTML 不是 JSON
            .header("X-Requested-With", "XMLHttpRequest")
            .header("MWeibo-Pwa", "1")
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
                        "WeiboApiClient: %s -> HTTP %d body=%s",
                        url.encodedPath, resp.code, body.take(200),
                    )
                    setLastError(resp.code, "HTTP ${resp.code}")
                    return null
                }
                // 微博偶尔返 HTML 重定向到登录页（cookie 失效），先 trim 检测
                val trimmed = body.trimStart()
                if (!trimmed.startsWith("{")) {
                    Timber.w(
                        "WeiboApiClient: %s -> non-JSON body (likely login redirect)",
                        url.encodedPath,
                    )
                    setLastError(-4, "non-json (cookie expired?)")
                    return null
                }
                val obj = JSONObject(body)
                val ok = obj.optInt("ok", 1)
                if (ok != 1) {
                    val msg = obj.optString("msg")
                    Timber.w(
                        "WeiboApiClient: %s -> ok=%d msg=%s",
                        url.encodedPath, ok, msg,
                    )
                    setLastError(ok, msg)
                    return null
                }
                clearLastError()
                obj
            }
        } catch (e: IOException) {
            Timber.w(e, "WeiboApiClient: IO error on %s", url.encodedPath)
            setLastError(-2, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: Exception) {
            Timber.w(e, "WeiboApiClient: parse error on %s", url.encodedPath)
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
         * 解微博的时间格式: "Sun Jan 12 13:45:00 +0800 2026"。返 epoch-ms。
         * 字段空 / 解析失败 → 0L (caller 用 fetch 时间兜底)。
         */
        internal fun parseWeiboTime(raw: String?): Long {
            if (raw.isNullOrBlank()) return 0L
            // ISO digits-only fallback (微博偶尔直接发 unix-seconds 字符串)
            raw.toLongOrNull()?.let { return if (it > 1e12) it else it * 1000 }
            return try {
                val fmt = java.text.SimpleDateFormat(
                    "EEE MMM dd HH:mm:ss Z yyyy",
                    java.util.Locale.US,
                )
                fmt.parse(raw)?.time ?: 0L
            } catch (_: Throwable) {
                0L
            }
        }

        /** 微博 text 字段含 HTML（<a>, <span> 等）。简单 strip 让快照可读。 */
        internal fun stripHtml(raw: String?): String {
            if (raw.isNullOrBlank()) return ""
            return raw.replace(Regex("<[^>]+>"), "")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .trim()
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
