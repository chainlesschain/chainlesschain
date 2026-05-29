package com.chainlesschain.android.pdh.social.xiaohongshu

import com.chainlesschain.android.pdh.social.NullSignProvider
import com.chainlesschain.android.pdh.social.SignProvider
import com.chainlesschain.android.pdh.social.SocialCookieWebViewHelpers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import timber.log.Timber
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.2 — 小红书 (xiaohongshu.com) public-API client driven by captured
 * browser cookie + a1 anti-bot fingerprint.
 *
 * 与 Bilibili / Weibo 的 4 大差异:
 *
 *  1) **X-S 签名**: 小红书所有数据端点都强制要求 X-S + X-T headers，cookie 单
 *     独不足。X-S 算法基于开源逆向 (md5(ts + url + body + a1) → base64
 *     "XYW_" 前缀)，可能在某些 endpoint 变体被拒；那些 graceful degrade 不
 *     tank 整个 snapshot。**v0.3 follow-up** 接入 b1 cookie + websocket secret
 *     补全签名输入。
 *
 *  2) **UID 解析**: xhs cookie 中无 DedeUserID-equivalent，且不像 weibo 一个
 *     /api/config 直返。要先调 /api/sns/web/v1/user/me (cookie-only，不需
 *     X-S) 拿 user_id；同时把 a1 cookie 字段独立抓出来存 store。
 *
 *  3) **uid 是字符串不是 Long**: xhs user_id 形如 "60xxxxxxxx..." (24 char hex
 *     string)，编码非数字。我们存 Long 哈希字段做存在性 sentinel，真 uid 存
 *     displayName 的反字段。**TODO v0.3**: store schema 加 stringUid field。
 *
 *  4) **反检测信号**: 必须带 `X-S` + `X-T` + Origin=`https://www.xiaohongshu.com` +
 *     Referer=`https://www.xiaohongshu.com/` 头；Chrome web-fingerprint UA。
 *     缺一即返 461 / 406 / 503 反爬。
 *
 * Endpoints (covers 3 kinds):
 *   - me         /api/sns/web/v1/user/me        (cookie-only, 拿 user_id +
 *                                                nickname, 无 X-S)
 *   - notes      /api/sns/web/v2/user_posted    (用户自己发的笔记, 需 X-S)
 *   - liked      /api/sns/web/v1/note/like/page (点赞过的笔记, 需 X-S)
 *   - follows    /api/sns/web/v1/user/follow/list (关注列表, 需 X-S)
 *
 * v0.2 caveats:
 *   - X-S 算法当前是 best-effort approximation，部分 endpoint variant 可能
 *     仍返 461 (X-S 校验失败) — collector 兜底为 emptyList()，错误信号 propagate
 *     到 lastErrorCode 让 UI 可见。真实 X-S 算法的完整版需 inject b1 cookie +
 *     a1.tail variant，v0.3 真机测试后再补。
 *   - Rate limit 严: 单 IP 每分钟 60 req 触发 461 short-band；collector
 *     sequential await + 一个 endpoint 失败不 tank 其他 fetchers。
 */
@Singleton
class XhsApiClient @Inject constructor() {

    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Override the base URL for MockWebServer in tests. */
    var baseUrl: HttpUrl = "https://edith.xiaohongshu.com/".toHttpUrl()

    /**
     * v0.3 — pluggable [SignProvider] for X-s/X-t/X-s-common headers.
     * Defaults to [NullSignProvider] so v0.2 behavior is preserved: when
     * no bridge is wired, doGetJson falls back to the in-process
     * best-effort [computeXsXt] (~60% GET hit / <30% POST hit).
     * Production wires [XhsSignBridge] for ~100% hit rate.
     */
    var signProvider: SignProvider = NullSignProvider

    data class NoteItem(
        val noteId: String,
        val title: String,
        val desc: String?,
        val type: String,        // "normal" / "video"
        val createdAt: Long,
        val likedCount: Int,
        val collectedCount: Int,
        val commentCount: Int,
    )

    data class LikedItem(
        val noteId: String,
        val title: String,
        val likedAt: Long,
        val authorNickname: String?,
    )

    data class FollowItem(
        val userId: String,
        val nickname: String,
        val image: String?,
        val followedAt: Long,
    )

    data class MeResult(
        val userId: String,
        val numericUid: Long,
        val nickname: String?,
    )

    /**
     * 调 /api/sns/web/v1/user/me 拿 user_id + nickname。**不需 X-S 签名**
     * 因为 me 端点只验 cookie 完整性。返 null = cookie 失效或登录未完成。
     */
    suspend fun fetchMe(cookie: String): MeResult? = withContext(Dispatchers.IO) {
        if (cookie.isBlank()) {  // audit F4
            setLastError(-8, "missing cookie")
            return@withContext null
        }
        val url = baseUrl.newBuilder().addPathSegments("api/sns/web/v1/user/me").build()
        val obj = doGetJson(url, cookie, requireSign = false) ?: return@withContext null
        // doGetJson already gated on success!=false / code!=0 (sets lastError).
        // The 3 branches below are reached only when xhs returns 200 + success=true
        // + code=0 but a deeper shape problem — surface each with a distinct code
        // so onXhsLoginCookie can tell them apart.
        val success = obj.optBoolean("success", true)
        if (!success) {
            // Defensive — doGetJson should have caught this. If hit, xhs returned
            // success=false but no code field (shape drift).
            // body=%s dropped — /user/me response contains nickname / user_id (audit F2)
            Timber.w(
                "XhsApiClient: /user/me success=false but no code; bodyLen=%d",
                obj.toString().length,
            )
            setLastError(-5, "/user/me success=false (no code field)")
            return@withContext null
        }
        val data = obj.optJSONObject("data")
        if (data == null) {
            // body=%s dropped — /user/me PII (audit F2)
            Timber.w(
                "XhsApiClient: /user/me ok but no `data` object; bodyLen=%d",
                obj.toString().length,
            )
            setLastError(-6, "/user/me ok but no `data` object")
            return@withContext null
        }
        val uidStr = data.optString("user_id").takeIf { it.isNotBlank() }
        if (uidStr == null) {
            val dataKeys = data.keys().asSequence().toList().joinToString(",")
            // body=%s dropped — /user/me PII (audit F2). dataKeys is field-name-only, safe.
            Timber.w(
                "XhsApiClient: /user/me ok but user_id blank; dataKeys=[%s] bodyLen=%d",
                dataKeys, obj.toString().length,
            )
            setLastError(
                -7,
                "/user/me ok but user_id blank (cookie likely missing web_session); dataKeys=[$dataKeys]",
            )
            return@withContext null
        }
        val nickname = data.optStringOrNull("nickname")
        // user_id 是 base64-ish 字符串 (e.g. "5e8c..."), 不是数字。哈希成
        // Long 作 store 哨兵；真 user_id 走 displayName/extra 字段。
        val numericUid = hashUidToLong(uidStr)
        MeResult(userId = uidStr, numericUid = numericUid, nickname = nickname)
    }

    /**
     * 用户自己发布的笔记 (timeline)。需 X-S 签名。
     *
     * 2026-05-27 真机 HTTP 404 修：xhs web 2025 强制要 xsec_source=pc_user
     * query param，缺它返 404 page not found (即使 X-S/X-T 签名正确)。
     * `XhsJsBridge.PREFETCH_JS` 已经带这俩 — Kotlin OkHttp 路径补齐对齐。
     */
    suspend fun fetchNotes(cookie: String, a1: String, userId: String, limit: Int = 30): List<NoteItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val url = baseUrl.newBuilder()
                .addPathSegments("api/sns/web/v2/user_posted")
                .addQueryParameter("user_id", userId)
                .addQueryParameter("num", "30")
                .addQueryParameter("cursor", "")
                .addQueryParameter("image_formats", "jpg,webp,avif")
                .addQueryParameter("xsec_token", "")
                .addQueryParameter("xsec_source", "pc_user")
                .build()
            val obj = doGetJson(url, cookie, a1 = a1, requireSign = true) ?: return@withContext emptyList()
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val notes = data.optJSONArray("notes") ?: return@withContext emptyList()
            val out = ArrayList<NoteItem>(minOf(limit, notes.length()))
            for (i in 0 until minOf(limit, notes.length())) {
                val n = notes.optJSONObject(i) ?: continue
                val nid = n.optString("note_id").takeIf { it.isNotBlank() }
                    ?: n.optString("id").takeIf { it.isNotBlank() }
                    ?: continue
                val interact = n.optJSONObject("interact_info")
                out.add(
                    NoteItem(
                        noteId = nid,
                        title = n.optString("display_title").takeIf { it.isNotBlank() }
                            ?: n.optString("title").takeIf { it.isNotBlank() }
                            ?: "(no title)",
                        desc = n.optStringOrNull("desc"),
                        type = n.optString("type").takeIf { it.isNotBlank() } ?: "normal",
                        createdAt = n.optLong("time").takeIf { it > 0 }?.let { if (it > 1e12) it else it * 1000 }
                            ?: 0L,
                        likedCount = parseCount(interact?.optStringOrNull("liked_count")),
                        collectedCount = parseCount(interact?.optStringOrNull("collected_count")),
                        commentCount = parseCount(interact?.optStringOrNull("comment_count")),
                    )
                )
            }
            out
        }

    /**
     * 用户点赞过的笔记。需 X-S 签名。
     *
     * 2026-05-27 path 改：原 `note/like/page` 真机返 code=300011 "当前账号
     * 存在异常" — 这是 xhs admin/back-office endpoint，对前端账号触风控。
     * `XhsJsBridge.PREFETCH_JS` 用的是 user-facing `/note/liked` 路径，对齐。
     */
    suspend fun fetchLiked(cookie: String, a1: String, limit: Int = 30): List<LikedItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val url = baseUrl.newBuilder()
                .addPathSegments("api/sns/web/v1/note/liked")
                .addQueryParameter("num", "30")
                .addQueryParameter("cursor", "")
                .build()
            val obj = doGetJson(url, cookie, a1 = a1, requireSign = true) ?: return@withContext emptyList()
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val notes = data.optJSONArray("notes") ?: return@withContext emptyList()
            val out = ArrayList<LikedItem>(minOf(limit, notes.length()))
            for (i in 0 until minOf(limit, notes.length())) {
                val n = notes.optJSONObject(i) ?: continue
                val nid = n.optString("note_id").takeIf { it.isNotBlank() }
                    ?: continue
                val user = n.optJSONObject("user")
                out.add(
                    LikedItem(
                        noteId = nid,
                        title = n.optString("display_title").takeIf { it.isNotBlank() }
                            ?: n.optString("title").takeIf { it.isNotBlank() }
                            ?: "(no title)",
                        // xhs 不返显式 liked_at，用 fetch 时间近似 (粗排即可)
                        likedAt = 0L,
                        authorNickname = user?.optStringOrNull("nickname"),
                    )
                )
            }
            out
        }

    /**
     * 关注列表。需 X-S 签名。
     *
     * 2026-05-27 path 改：原 `/user/follow/list?user_id=X` 真机 HTTP 404 —
     * xhs 改 RESTful 风格 uid 入 URL path 段且 endpoint 改名 `followings`。
     * `XhsJsBridge.PREFETCH_JS` 同款。pagination 也从 cursor-based 改 page-based。
     */
    suspend fun fetchFollows(cookie: String, a1: String, userId: String, limit: Int = 100): List<FollowItem> =
        withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(-8, "missing cookie")
                return@withContext emptyList()
            }
            val url = baseUrl.newBuilder()
                .addPathSegments("api/sns/web/v1/user/$userId/followings")
                .addQueryParameter("page", "1")
                .addQueryParameter("page_size", "20")
                .build()
            val obj = doGetJson(url, cookie, a1 = a1, requireSign = true) ?: return@withContext emptyList()
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val users = data.optJSONArray("users") ?: return@withContext emptyList()
            val out = ArrayList<FollowItem>(minOf(limit, users.length()))
            for (i in 0 until minOf(limit, users.length())) {
                val u = users.optJSONObject(i) ?: continue
                val uid = u.optString("user_id").takeIf { it.isNotBlank() }
                    ?: continue
                out.add(
                    FollowItem(
                        userId = uid,
                        nickname = u.optString("nickname").takeIf { it.isNotBlank() }
                            ?: "(unnamed)",
                        image = u.optStringOrNull("image"),
                        followedAt = 0L, // xhs 不返显式 follow time
                    )
                )
            }
            out
        }

    @Volatile var lastErrorCode: Int = 0
        private set
    @Volatile var lastErrorMessage: String? = null
        private set

    private suspend fun doGetJson(
        url: HttpUrl,
        cookie: String,
        a1: String? = null,
        requireSign: Boolean = false,
    ): JSONObject? {
        val builder = Request.Builder()
            .url(url)
            .header("Cookie", cookie)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .header("Referer", "https://www.xiaohongshu.com/")
            .header("Origin", "https://www.xiaohongshu.com")
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        if (requireSign && a1 != null) {
            // v0.3 — prefer the bridge (xhs's own signing JS) over the
            // in-process best-effort [computeXsXt] fallback. The bridge
            // hits ~100% on live endpoints; the fallback ~60% GET / <30%
            // POST. When the bridge is NullSignProvider (v0.2 mode) OR
            // returns empty headers (warm-up failed / rotation), we fall
            // back to computeXsXt so v0.2 callers keep partial coverage.
            val pathWithQuery = url.encodedPath + (url.encodedQuery?.let { "?$it" } ?: "")
            val purpose = "$pathWithQuery|"  // GET => empty body part
            val bridgeSigned = signProvider.signUrl(url, purpose)
            val bridgeHeaders = if (bridgeSigned != null) {
                signProvider.signedHeaders(url, purpose)
            } else {
                emptyMap()
            }
            if (bridgeHeaders.isNotEmpty()) {
                for ((k, v) in bridgeHeaders) builder.header(k, v)
            } else {
                val (xs, xt) = computeXsXt(pathWithQuery, null, a1)
                builder.header("X-S", xs).header("X-T", xt.toString())
            }
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
                    // body=%s dropped — 461/406 HTML may echo Set-Cookie (audit F2)
                    Timber.w(
                        "XhsApiClient: %s -> HTTP %d bodyLen=%d",
                        url.encodedPath, resp.code, body.length,
                    )
                    setLastError(resp.code, "HTTP ${resp.code}")
                    return null
                }
                val trimmed = body.trimStart()
                if (!trimmed.startsWith("{")) {
                    Timber.w(
                        "XhsApiClient: %s -> non-JSON body (likely login redirect)",
                        url.encodedPath,
                    )
                    setLastError(-4, "non-json (cookie expired?)")
                    return null
                }
                val obj = JSONObject(body)
                val success = obj.optBoolean("success", true)
                val code = obj.optInt("code", 0)
                if (!success || code != 0) {
                    val msg = obj.optString("msg")
                    Timber.w(
                        "XhsApiClient: %s -> code=%d success=%b msg=%s",
                        url.encodedPath, code, success, msg,
                    )
                    setLastError(if (code != 0) code else -461, msg)
                    return null
                }
                clearLastError()
                obj
            }
        } catch (e: IOException) {
            Timber.w(e, "XhsApiClient: IO error on %s", url.encodedPath)
            setLastError(-2, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: Exception) {
            if (e is CancellationException) throw e  // audit F3
            Timber.w(e, "XhsApiClient: parse error on %s", url.encodedPath)
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
         * 解 xhs cookie 中的 a1 字段 — anti-bot fingerprint, X-S 签名输入。
         * 例如 "a1=18d6e... ; web_session=..." → "18d6e..."。返 null = 缺
         * a1 字段 (cookie 不完整或被 trim)。
         */
        fun extractA1(cookie: String): String? {
            return SocialCookieWebViewHelpers.parseCookieValue(cookie, "a1")
        }

        /**
         * X-S 签名生成 (开源逆向 best-effort approximation, v0.2)。
         *
         * 真实 xhs.js 算法:
         *   1. payload = "url=" + url_path_with_query + ("" or body_json)
         *   2. raw = ts_ms + payload + a1_cookie
         *   3. md5_hex = MD5(raw).hex()
         *   4. X-S = "XYW_" + base64(md5_hex)
         *   5. X-T = ts_ms (as string)
         *
         * 实际 xhs.js 在 step 3 后还做一轮 XOR with rotating key + base64 with
         * +"=" padding，那一步 v0.3 follow-up 补 (需 b1 cookie + 反混淆 JS)。
         *
         * 当前实现对 GET endpoint 命中率 ~60%，POST 命中率 <30%。命中失败
         * → 461 code → collector 兜底 emptyList()。
         */
        internal fun computeXsXt(urlPathWithQuery: String, body: String?, a1: String): Pair<String, Long> {
            val ts = System.currentTimeMillis()
            val payload = "url=$urlPathWithQuery" + (body ?: "")
            val raw = "${ts}$payload${a1}"
            val md5 = MessageDigest.getInstance("MD5")
                .digest(raw.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
            val xs = "XYW_" + android.util.Base64.encodeToString(
                md5.toByteArray(Charsets.UTF_8),
                android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
            )
            return xs to ts
        }

        /**
         * xhs user_id 是 hex string ("5e8c8f7e..."), 不是数字。为了复用 Long
         * uid sentinel 字段做 hasCredentials 判定，把字符串 stable-hash 到
         * Long (折半 XOR fold, 防 0 → 加 1 偏移)。真 user_id 存 displayName
         * 反字段或单独 KEY_UID_STR (v0.3 加)。
         */
        internal fun hashUidToLong(uidStr: String): Long {
            if (uidStr.isBlank()) return 0L
            val bytes = uidStr.toByteArray(Charsets.UTF_8)
            var hash = 0L
            for (b in bytes) {
                hash = (hash * 31 + b.toLong()) and 0x7FFFFFFFFFFFFFFFL
            }
            // 0 = 未登录哨兵，hash=0 概率极低但避免歧义
            return if (hash == 0L) 1L else hash
        }

        /** 小红书 interact_info 字段返 "1.2万" / "234" / "10w+" 字符串，转 Int。 */
        internal fun parseCount(raw: String?): Int {
            if (raw.isNullOrBlank()) return 0
            val trimmed = raw.trim()
            return when {
                trimmed.endsWith("万") -> (trimmed.dropLast(1).toFloatOrNull() ?: 0f).times(10000).toInt()
                trimmed.endsWith("w") || trimmed.endsWith("w+") || trimmed.endsWith("W") ->
                    (trimmed.removeSuffix("+").dropLast(1).toFloatOrNull() ?: 0f).times(10000).toInt()
                trimmed.endsWith("亿") -> (trimmed.dropLast(1).toFloatOrNull() ?: 0f).times(100_000_000).toInt()
                else -> trimmed.toIntOrNull() ?: 0
            }
        }
    }
}

// org.json helpers
private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val v = optString(key)
    return v.takeIf { it.isNotEmpty() }
}
