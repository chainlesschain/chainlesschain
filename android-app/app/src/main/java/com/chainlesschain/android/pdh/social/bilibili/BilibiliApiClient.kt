package com.chainlesschain.android.pdh.social.bilibili

import com.chainlesschain.android.pdh.social.SocialCookieWebViewHelpers
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
 * A8 v0.1 — Bilibili public-API client driven by a captured browser cookie.
 *
 * Endpoints fetched (covers the four "kinds" the A8 snapshot adapter expects):
 *   - history    /x/v2/history/cursor
 *   - favourites /x/v3/fav/folder/created/list-all + /x/v3/fav/resource/list
 *   - dynamics   /x/polymer/web-dynamic/v1/feed/all
 *   - follows    /x/relation/followings
 *
 * All endpoints take a Cookie header containing at minimum `SESSDATA` and
 * `DedeUserID` (the latter is the user's numeric UID and lets us derive
 * `account.uid` for the snapshot without needing a separate "me" call).
 *
 * v0.1 caveats:
 *   - WBI signing is NOT implemented. Endpoints above currently accept un-signed
 *     requests when SESSDATA is valid. The newer "wbi" endpoints require it
 *     (avoid writing the literal slash-star sequence here — Kotlin block
 *     comments nest, so any slash-star inside a KDoc opens a nested comment
 *     that swallows subsequent code; see memory kotlin_nested_block_comments);
 *     if Bilibili tightens enforcement, we'll need to port the WBI key handshake
 *     from `/x/web-interface/nav` (TODO follow-up trap).
 *   - Anti-bot risk is medium. If we see 412 (Bilibili rate-limit code) or 401,
 *     the collector falls back to whatever data was successfully fetched so far
 *     rather than throwing. Recovery = wait + relog.
 *   - No retry on transient 5xx. Caller (BilibiliLocalCollector) shows the user
 *     a retry button; automatic retry would risk doubling rate-limit pressure.
 */
@Singleton
class BilibiliApiClient @Inject constructor() {

    /**
     * Local OkHttp instance — deliberately NOT reusing the app's shared
     * core-network OkHttpClient because that one has AuthInterceptor which
     * adds the app's backend Authorization header. Bilibili would either
     * ignore that or treat it as anti-bot signal. Each social adapter owns
     * a minimal client tuned for its host. Public for tests so they can swap
     * in MockWebServer-routed clients.
     */
    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Override the base URL for MockWebServer in tests. */
    var baseUrl: HttpUrl = "https://api.bilibili.com/".toHttpUrl()

    /** Public API for snapshot collector — see BilibiliLocalCollector. */
    data class HistoryItem(
        val bvid: String?,
        val avid: Long?,
        val title: String,
        val viewAt: Long,
        val duration: Long?,
        val uploader: String?,
        val uploaderMid: Long?,
        val part: String?,
    )

    data class FavouriteItem(
        val bvid: String?,
        val title: String,
        val savedAt: Long,
        val folderName: String?,
        val uploader: String?,
    )

    data class DynamicItem(
        val rid: String?,
        val summary: String,
        val dynamicType: String,
        val publishedAt: Long,
        val authorMid: Long?,
        val authorName: String?,
    )

    data class FollowItem(
        val mid: Long,
        val uname: String,
        val face: String?,
        val sign: String?,
        val followedAt: Long,
    )

    /**
     * "DedeUserID=12345; …" → 12345 (or null if cookie missing the field).
     * Bilibili never issues uid=0, so 0L coerces to null — protects against
     * cookies in mid-logout state where DedeUserID is present but cleared.
     */
    fun extractUid(cookie: String): Long? {
        val raw = SocialCookieWebViewHelpers.parseCookieValue(cookie, "DedeUserID") ?: return null
        return raw.toLongOrNull()?.takeIf { it > 0L }
    }

    /**
     * Real-device 2026-05-24 (Xiaomi 24115RA8EC v5.0.3.84-DEBUG): even with
     * 5000ms WebView cookie capture defer, the captured buvid3 string is
     * either too short or a stale placeholder and the data endpoints still
     * return code=-400 "请求错误" with empty payloads. The actual JS that
     * sets the "real" buvid3 chains an anonymous XHR to
     * /x/frontend/finger/spi after window.onload, on a delay that varies
     * with 5G latency. Rather than chase the JS timer, mint buvid3 ourselves
     * from the same anonymous endpoint at first API use and inject it into
     * the Cookie header on every subsequent data call. Cached in
     * [mintedBuvid3] for the process lifetime — buvid3 is a per-device
     * fingerprint, not session-scoped, so one mint suffices across re-logins.
     */
    @Volatile
    private var mintedBuvid3: String? = null

    /** For tests: pre-seed buvid3 to skip the network mint. */
    internal fun setMintedBuvid3ForTest(value: String?) {
        mintedBuvid3 = value
    }

    private suspend fun mintBuvid3(): String? {
        mintedBuvid3?.let { return it }
        return withContext(Dispatchers.IO) {
            val url = baseUrl.newBuilder().addPathSegments("x/frontend/finger/spi").build()
            val req = Request.Builder()
                .url(url)
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Linux; Android 14; ChainlessChain) AppleWebKit/537.36 " +
                        "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
                )
                .header("Referer", "https://www.bilibili.com/")
                .header("Origin", "https://www.bilibili.com")
                .header("Accept", "application/json, text/plain, */*")
                .build()
            try {
                httpClient.newCall(req).execute().use { resp ->
                    val body = resp.body?.string()
                    if (!resp.isSuccessful || body == null) {
                        Timber.w("BilibiliApiClient: /spi → HTTP %d", resp.code)
                        return@withContext null
                    }
                    val obj = JSONObject(body)
                    if (obj.optInt("code", -1) != 0) {
                        Timber.w("BilibiliApiClient: /spi → code=%d", obj.optInt("code"))
                        return@withContext null
                    }
                    val b3 = obj.optJSONObject("data")?.optString("b_3")
                        ?.takeIf { it.isNotBlank() } ?: return@withContext null
                    Timber.i("BilibiliApiClient: minted buvid3 (len=%d)", b3.length)
                    mintedBuvid3 = b3
                    b3
                }
            } catch (e: Exception) {
                Timber.w(e, "BilibiliApiClient: mintBuvid3 failed")
                null
            }
        }
    }

    /**
     * Strip any existing `buvid3=...` from [cookie] and append [newBuvid3].
     * Last-write-wins is not portable across Cookie parsers; explicit
     * substitution is.
     */
    internal fun substituteBuvid3(cookie: String, newBuvid3: String): String {
        val parts = cookie.split(";").map { it.trim() }.filter {
            it.isNotEmpty() && !it.startsWith("buvid3=")
        }
        return if (parts.isEmpty()) "buvid3=$newBuvid3"
        else parts.joinToString("; ") + "; buvid3=$newBuvid3"
    }

    /**
     * Mint buvid3 + substitute into cookie. Falls back to the raw cookie
     * if minting fails (still preserves SESSDATA + DedeUserID + bili_jct
     * paths that may already be enough on lucky devices).
     */
    private suspend fun prepareCookie(cookie: String): String {
        val b3 = mintBuvid3() ?: return cookie
        return substituteBuvid3(cookie, b3)
    }

    suspend fun fetchHistory(cookie: String, limit: Int = 200): List<HistoryItem> =
        withContext(Dispatchers.IO) {
            val effectiveCookie = prepareCookie(cookie)
            val url = baseUrl.newBuilder()
                // Real-device 2026-05-22: /x/v2/history/cursor returns 404
                // (HTML page, not JSON) — Bilibili deprecated the v2 path in
                // favor of /x/web-interface/history/cursor (same response shape).
                .addPathSegments("x/web-interface/history/cursor")
                .addQueryParameter("ps", "30")
                .addQueryParameter("type", "archive")
                .build()
            val obj = doGetJson(url, effectiveCookie) ?: return@withContext emptyList()
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val list = data.optJSONArray("list") ?: return@withContext emptyList()
            val out = ArrayList<HistoryItem>(minOf(limit, list.length()))
            for (i in 0 until minOf(limit, list.length())) {
                val item = list.optJSONObject(i) ?: continue
                val hist = item.optJSONObject("history")
                val owner = item.optJSONObject("owner")
                out.add(
                    HistoryItem(
                        bvid = hist?.optStringOrNull("bvid"),
                        avid = hist?.optLongOrNull("oid") ?: item.optLongOrNull("oid"),
                        title = item.optString("title").takeIf { it.isNotBlank() } ?: "(no title)",
                        viewAt = item.optLong("view_at"),
                        duration = item.optLongOrNull("duration"),
                        uploader = owner?.optStringOrNull("name"),
                        uploaderMid = owner?.optLongOrNull("mid"),
                        part = item.optStringOrNull("part"),
                    )
                )
            }
            out
        }

    /**
     * Returns favourites across **all** of the user's created folders.
     * Two API calls per folder: list folders, then list items per folder.
     */
    suspend fun fetchFavourites(cookie: String, uid: Long, perFolderLimit: Int = 50): List<FavouriteItem> =
        withContext(Dispatchers.IO) {
            val effectiveCookie = prepareCookie(cookie)
            val foldersUrl = baseUrl.newBuilder()
                .addPathSegments("x/v3/fav/folder/created/list-all")
                .addQueryParameter("up_mid", uid.toString())
                .build()
            val foldersJson = doGetJson(foldersUrl, effectiveCookie) ?: return@withContext emptyList()
            val foldersData = foldersJson.optJSONObject("data") ?: return@withContext emptyList()
            val folders = foldersData.optJSONArray("list") ?: return@withContext emptyList()
            val out = ArrayList<FavouriteItem>()
            for (i in 0 until folders.length()) {
                val folder = folders.optJSONObject(i) ?: continue
                val folderId = folder.optLong("id")
                val folderName = folder.optStringOrNull("title")
                if (folderId == 0L) continue
                val itemsUrl = baseUrl.newBuilder()
                    .addPathSegments("x/v3/fav/resource/list")
                    .addQueryParameter("media_id", folderId.toString())
                    .addQueryParameter("ps", perFolderLimit.toString())
                    .addQueryParameter("pn", "1")
                    // Real-device 2026-05-22: missing `platform=web` returns
                    // code=-400 "请求错误". Bilibili tightened this endpoint to
                    // require an explicit platform tag.
                    .addQueryParameter("platform", "web")
                    .build()
                val itemsJson = doGetJson(itemsUrl, effectiveCookie) ?: continue
                val itemsData = itemsJson.optJSONObject("data") ?: continue
                val medias = itemsData.optJSONArray("medias") ?: continue
                for (j in 0 until medias.length()) {
                    val m = medias.optJSONObject(j) ?: continue
                    val upper = m.optJSONObject("upper")
                    val favTime = m.optLong("fav_time").let { if (it > 0) it * 1000 else m.optLong("ctime") * 1000 }
                    out.add(
                        FavouriteItem(
                            bvid = m.optStringOrNull("bvid"),
                            title = m.optString("title").takeIf { it.isNotBlank() } ?: "(no title)",
                            savedAt = favTime,
                            folderName = folderName,
                            uploader = upper?.optStringOrNull("name"),
                        )
                    )
                }
            }
            out
        }

    suspend fun fetchDynamics(cookie: String, limit: Int = 50): List<DynamicItem> =
        withContext(Dispatchers.IO) {
            val effectiveCookie = prepareCookie(cookie)
            // Real-device 2026-05-22: Bilibili dynamics returned 0 items
            // silently (code=0 + empty list, no WARN). Adding `type=all` +
            // `platform=web` + `timezone_offset` to match what the web client
            // sends — without these the anti-bot returns an OK + empty page.
            val url = baseUrl.newBuilder()
                .addPathSegments("x/polymer/web-dynamic/v1/feed/all")
                .addQueryParameter("type", "all")
                .addQueryParameter("platform", "web")
                .addQueryParameter("timezone_offset", "-480")
                .build()
            val obj = doGetJson(url, effectiveCookie) ?: return@withContext emptyList()
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val items = data.optJSONArray("items") ?: return@withContext emptyList()
            val out = ArrayList<DynamicItem>(minOf(limit, items.length()))
            for (i in 0 until minOf(limit, items.length())) {
                val it = items.optJSONObject(i) ?: continue
                val modules = it.optJSONObject("modules") ?: continue
                val author = modules.optJSONObject("module_author")
                val dyn = modules.optJSONObject("module_dynamic")
                val desc = dyn?.optJSONObject("desc")
                val summary = desc?.optString("text")?.takeIf { s -> s.isNotBlank() }
                    ?: dyn?.optJSONObject("major")?.optJSONObject("archive")?.optStringOrNull("title")
                    ?: "(no summary)"
                out.add(
                    DynamicItem(
                        rid = it.optStringOrNull("id_str"),
                        summary = summary,
                        dynamicType = it.optString("type").removePrefix("DYNAMIC_TYPE_").lowercase()
                            .takeIf { s -> s.isNotBlank() } ?: "unknown",
                        publishedAt = (author?.optLong("pub_ts") ?: 0L) * 1000,
                        authorMid = author?.optLongOrNull("mid"),
                        authorName = author?.optStringOrNull("name"),
                    )
                )
            }
            out
        }

    suspend fun fetchFollows(cookie: String, uid: Long, limit: Int = 200): List<FollowItem> =
        withContext(Dispatchers.IO) {
            val effectiveCookie = prepareCookie(cookie)
            val url = baseUrl.newBuilder()
                .addPathSegments("x/relation/followings")
                .addQueryParameter("vmid", uid.toString())
                .addQueryParameter("ps", "50")
                .addQueryParameter("pn", "1")
                .addQueryParameter("order", "desc")
                .addQueryParameter("order_type", "attention")
                .build()
            val obj = doGetJson(url, effectiveCookie) ?: return@withContext emptyList()
            val data = obj.optJSONObject("data") ?: return@withContext emptyList()
            val list = data.optJSONArray("list") ?: return@withContext emptyList()
            val out = ArrayList<FollowItem>(minOf(limit, list.length()))
            for (i in 0 until minOf(limit, list.length())) {
                val it = list.optJSONObject(i) ?: continue
                val mid = it.optLong("mid")
                if (mid == 0L) continue
                out.add(
                    FollowItem(
                        mid = mid,
                        uname = it.optString("uname").takeIf { s -> s.isNotBlank() } ?: "(unnamed)",
                        face = it.optStringOrNull("face"),
                        sign = it.optStringOrNull("sign"),
                        // mtime is "modified time" of the follow row — same as
                        // followed-at in Bilibili's schema, returned as unix seconds
                        followedAt = it.optLong("mtime") * 1000,
                    )
                )
            }
            out
        }

    /**
     * GET <url> with Cookie + browser-like headers. Returns parsed JSONObject
     * on success, null on transport / API error.
     *
     * Real-device repro 2026-05-22 (Xiaomi 24115RA8EC): after a successful
     * WebView login (UID parsed), all 4 endpoints returned empty data. Root
     * cause: missing User-Agent + Origin headers. Bilibili's anti-spider
     * sees OkHttp's default "okhttp/4.x.x" UA + no Origin and treats every
     * request as bot → either returns `code: -412` (rate-limit/anti-spider)
     * or pretends the cookie is invalid (`code: -101`). Browser-like UA +
     * Origin matches what the web client sends and bypasses the heuristic.
     *
     * lastErrorCode + lastErrorMessage are exposed so the collector can
     * surface "code=-412, anti-spider" vs "code=-101, not logged in" rather
     * than the catch-all "cookie 可能过期".
     */
    @Volatile var lastErrorCode: Int = 0
        private set
    @Volatile var lastErrorMessage: String? = null
        private set

    private fun doGetJson(url: HttpUrl, cookie: String): JSONObject? {
        val req = Request.Builder()
            .url(url)
            .header("Cookie", cookie)
            // Browser-like UA: required to bypass Bilibili anti-spider; the
            // app's own UA is rejected. Pinning to Chrome 120 mobile UA — if
            // Bilibili adds UA-version fingerprinting later, may need bump.
            .header(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 14; ChainlessChain) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            )
            // Bilibili enforces Referer + Origin for the four endpoints we hit
            .header("Referer", "https://www.bilibili.com/")
            .header("Origin", "https://www.bilibili.com")
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
                    Timber.w("BilibiliApiClient: %s → HTTP %d body=%s",
                        url.encodedPath, resp.code, body.take(200))
                    setLastError(resp.code, "HTTP ${resp.code}")
                    return null
                }
                val obj = JSONObject(body)
                val code = obj.optInt("code", 0)
                if (code != 0) {
                    val msg = obj.optString("message")
                    Timber.w(
                        "BilibiliApiClient: %s → code=%d msg=%s",
                        url.encodedPath, code, msg
                    )
                    setLastError(code, msg)
                    return null
                }
                clearLastError()
                obj
            }
        } catch (e: IOException) {
            Timber.w(e, "BilibiliApiClient: IO error on %s", url.encodedPath)
            setLastError(-2, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: Exception) {
            Timber.w(e, "BilibiliApiClient: parse error on %s", url.encodedPath)
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

private fun JSONObject.optLongOrNull(key: String): Long? {
    if (!has(key) || isNull(key)) return null
    return when (val v = opt(key)) {
        is Number -> v.toLong()
        is String -> v.toLongOrNull()
        else -> null
    }
}
