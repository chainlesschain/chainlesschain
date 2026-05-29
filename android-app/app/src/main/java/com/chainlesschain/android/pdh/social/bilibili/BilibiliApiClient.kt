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
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Bilibili WBI signature mixin key reorder table — fixed 64-index list the
 * web client uses to derive `mixin_key` from `img_key + sub_key`. Standard
 * across Bilibili clients; if these indexes change the JS that builds w_rid
 * has changed, and we'll need to refresh from a browser session.
 */
private val WBI_MIXIN_KEY_TABLE = intArrayOf(
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
)

/** Chars Bilibili strips from query values before signing (matches their JS). */
private val WBI_FORBIDDEN_CHARS = charArrayOf('!', '\'', '(', ')', '*')

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
                    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
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
                    val obj = try {
                        JSONObject(body)
                    } catch (e: Exception) {
                        Timber.w(
                            "BilibiliApiClient: /spi body not JSON (len=%d head=%s)",
                            body.length, body.take(120),
                        )
                        return@withContext null
                    }
                    if (obj.optInt("code", -1) != 0) {
                        Timber.w("BilibiliApiClient: /spi → code=%d", obj.optInt("code"))
                        return@withContext null
                    }
                    val b3 = obj.optJSONObject("data")?.optString("b_3")?.takeIf { it.isNotBlank() }
                    if (b3 == null) {
                        Timber.w(
                            "BilibiliApiClient: /spi data.b_3 missing/blank (top-keys=%s)",
                            obj.keys().asSequence().toList(),
                        )
                        return@withContext null
                    }
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

    /**
     * Bilibili WBI (Web-side anti-spider) signature: the web client signs
     * each API request with `w_rid` + `wts` query params derived from a
     * `mixin_key` rotated daily via /x/web-interface/nav. Without these,
     * data endpoints silently return `{code:0, data:{list:[]}}` or
     * `code:-400 请求错误` (resource/list specifically) even when SESSDATA
     * + buvid3 are valid. Verified on real device 2026-05-24: 4-API empty
     * persists even after buvid3 mint until WBI signing was added.
     *
     * Cache strategy: mixin_key rotates daily but the same key works for
     * the whole session. Cache for the process lifetime; if a request
     * fails with -403 / -352 (WBI-related errors) we could invalidate
     * and re-fetch, but for now once-per-process is fine.
     */
    @Volatile
    private var wbiMixinKey: String? = null

    /** For tests: pre-seed mixin key to skip the network nav fetch. */
    internal fun setWbiMixinKeyForTest(value: String?) {
        wbiMixinKey = value
    }

    private suspend fun ensureWbiMixinKey(): String? {
        wbiMixinKey?.let { return it }
        return withContext(Dispatchers.IO) {
            val url = baseUrl.newBuilder().addPathSegments("x/web-interface/nav").build()
            val req = Request.Builder()
                .url(url)
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
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
                        Timber.w("BilibiliApiClient: /nav → HTTP %d", resp.code)
                        return@withContext null
                    }
                    val obj = try {
                        JSONObject(body)
                    } catch (e: Exception) {
                        Timber.w(
                            "BilibiliApiClient: /nav body not JSON (len=%d head=%s)",
                            body.length, body.take(120),
                        )
                        return@withContext null
                    }
                    // nav returns code=-101 for unauthenticated, but wbi_img is
                    // still in `data` either way — don't gate on code.
                    val wbiImg = obj.optJSONObject("data")?.optJSONObject("wbi_img")
                    if (wbiImg == null) {
                        Timber.w(
                            "BilibiliApiClient: /nav missing data.wbi_img (code=%d top-keys=%s)",
                            obj.optInt("code", -999), obj.keys().asSequence().toList(),
                        )
                        return@withContext null
                    }
                    val imgUrl = wbiImg.optString("img_url")
                    val subUrl = wbiImg.optString("sub_url")
                    val imgKey = extractWbiKeyFromUrl(imgUrl)
                    val subKey = extractWbiKeyFromUrl(subUrl)
                    if (imgKey == null || subKey == null) {
                        Timber.w(
                            "BilibiliApiClient: /nav wbi_img URL parse failed img=%s sub=%s",
                            imgUrl, subUrl,
                        )
                        return@withContext null
                    }
                    val raw = imgKey + subKey
                    if (raw.length < 64) {
                        Timber.w("BilibiliApiClient: wbi raw key too short: %d", raw.length)
                        return@withContext null
                    }
                    val mixin = buildString(32) {
                        for (i in WBI_MIXIN_KEY_TABLE) {
                            if (i < raw.length) append(raw[i])
                            if (length >= 32) break
                        }
                    }
                    Timber.i("BilibiliApiClient: derived wbi mixin_key (len=%d)", mixin.length)
                    wbiMixinKey = mixin
                    mixin
                }
            } catch (e: Exception) {
                Timber.w(e, "BilibiliApiClient: ensureWbiMixinKey failed")
                null
            }
        }
    }

    /** "https://i0.hdslb.com/bfs/wbi/abc123.png" → "abc123". */
    internal fun extractWbiKeyFromUrl(url: String): String? {
        if (url.isBlank()) return null
        val lastSlash = url.lastIndexOf('/')
        val lastDot = url.lastIndexOf('.')
        if (lastSlash < 0 || lastDot <= lastSlash) return null
        return url.substring(lastSlash + 1, lastDot).takeIf { it.isNotBlank() }
    }

    /**
     * Sign an HttpUrl by appending `wts` + `w_rid` query params derived
     * from [mixinKey]. Existing query params are included in the signature
     * (sorted alphabetically, value chars in [WBI_FORBIDDEN_CHARS] stripped,
     * URL-encoded). The returned URL has BOTH the original params and the
     * two signature params.
     */
    internal fun signUrl(url: HttpUrl, mixinKey: String): HttpUrl {
        val wts = System.currentTimeMillis() / 1000L
        val existing = LinkedHashMap<String, String>(url.querySize + 1)
        for (i in 0 until url.querySize) {
            existing[url.queryParameterName(i)] = url.queryParameterValue(i) ?: ""
        }
        existing["wts"] = wts.toString()
        val sortedQuery = existing.entries
            .sortedBy { it.key }
            .joinToString("&") { (k, v) ->
                val cleaned = v.filter { it !in WBI_FORBIDDEN_CHARS }
                "${urlEncodeWbi(k)}=${urlEncodeWbi(cleaned)}"
            }
        val wRid = md5Hex(sortedQuery + mixinKey)
        return url.newBuilder()
            .addQueryParameter("wts", wts.toString())
            .addQueryParameter("w_rid", wRid)
            .build()
    }

    /**
     * Compose buvid3 mint + WBI sign for a request URL. Returns Pair(cookie,
     * signedUrl) or fallback to the unsigned URL if WBI keys can't be
     * fetched (preserves the buvid3-only path as a degraded mode).
     */
    private suspend fun prepareRequest(cookie: String, url: HttpUrl): Pair<String, HttpUrl> {
        val effectiveCookie = prepareCookie(cookie)
        val mixin = ensureWbiMixinKey() ?: return effectiveCookie to url
        val signed = try {
            signUrl(url, mixin)
        } catch (e: Exception) {
            Timber.w(e, "BilibiliApiClient: signUrl failed")
            url
        }
        return effectiveCookie to signed
    }

    suspend fun fetchHistory(cookie: String, limit: Int = 200): List<HistoryItem> =
        withContext(Dispatchers.IO) {
            val rawUrl = baseUrl.newBuilder()
                // Real-device 2026-05-22: /x/v2/history/cursor returns 404
                // (HTML page, not JSON) — Bilibili deprecated the v2 path in
                // favor of /x/web-interface/history/cursor (same response shape).
                .addPathSegments("x/web-interface/history/cursor")
                .addQueryParameter("ps", "30")
                .addQueryParameter("type", "archive")
                .build()
            val (effectiveCookie, url) = prepareRequest(cookie, rawUrl)
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
            val rawFoldersUrl = baseUrl.newBuilder()
                .addPathSegments("x/v3/fav/folder/created/list-all")
                .addQueryParameter("up_mid", uid.toString())
                .build()
            val (effectiveCookie, foldersUrl) = prepareRequest(cookie, rawFoldersUrl)
            val foldersJson = doGetJson(foldersUrl, effectiveCookie) ?: return@withContext emptyList()
            val foldersData = foldersJson.optJSONObject("data") ?: return@withContext emptyList()
            val folders = foldersData.optJSONArray("list") ?: return@withContext emptyList()
            val out = ArrayList<FavouriteItem>()
            for (i in 0 until folders.length()) {
                val folder = folders.optJSONObject(i) ?: continue
                val folderId = folder.optLong("id")
                val folderName = folder.optStringOrNull("title")
                if (folderId == 0L) continue
                val rawItemsUrl = baseUrl.newBuilder()
                    .addPathSegments("x/v3/fav/resource/list")
                    .addQueryParameter("media_id", folderId.toString())
                    .addQueryParameter("ps", perFolderLimit.toString())
                    .addQueryParameter("pn", "1")
                    // 2026-05-22: missing `platform=web` returns -400.
                    .addQueryParameter("platform", "web")
                    // 2026-05-25 真机：带 platform + WBI 签名仍 -400. b 站 2024+
                    // 反爬升级 — web 客户端实际请求带这 5 个新必需 param。少任何
                    // 一个 → -400「请求错误」(body 不暴露哪个缺，只能照 web 端
                    // network tab 全补)：
                    //   keyword       默认空串
                    //   order=mtime   按收藏时间倒序
                    //   type=0        全资源类型
                    //   tid=0         无分区过滤
                    //   web_location  333.1387 = "我的收藏" 页 location 锚
                    // 必须在 signUrl 之前 add（signUrl 哈希所有 query 含这 5 个）
                    .addQueryParameter("keyword", "")
                    .addQueryParameter("order", "mtime")
                    .addQueryParameter("type", "0")
                    .addQueryParameter("tid", "0")
                    .addQueryParameter("web_location", "333.1387")
                    // 2026-05-25 真机：5 个 param + WBI 仍 -400。b 站风控加 canvas
                    // /WebGL 指纹检测。dm_img_str=base64("WebGL 1.0 (OpenGL ES 2.0
                    // Chromium)") + dm_cover_img_str=base64(GPU info) +
                    // dm_img_list=[] 是真实浏览器固定字面值，欠这三个 -400 才会触发。
                    // 必须在 signUrl 前 add（signUrl 会哈希全 query 含这 3 个）
                    .addQueryParameter(
                        "dm_img_list", "[]",
                    )
                    .addQueryParameter(
                        "dm_img_str", "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
                    )
                    .addQueryParameter(
                        "dm_cover_img_str",
                        "QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgKDB4MDAwMDljNDIpIERpcmVjdDNEMTEgdnNfNV8wIHBzXzVfMCksIG9yIHNpbWlsYXIgZ3JhcGhpY3Mp",
                    )
                    .build()
                // Sign the per-folder URL too (signature wraps each request,
                // not the session). Reuse the already-prepared cookie.
                val itemsUrl = wbiMixinKey?.let { signUrl(rawItemsUrl, it) } ?: rawItemsUrl
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
            // Real-device 2026-05-22: Bilibili dynamics returned 0 items
            // silently (code=0 + empty list, no WARN). Adding `type=all` +
            // `platform=web` + `timezone_offset` to match what the web client
            // sends — without these the anti-bot returns an OK + empty page.
            val rawUrl = baseUrl.newBuilder()
                .addPathSegments("x/polymer/web-dynamic/v1/feed/all")
                .addQueryParameter("type", "all")
                .addQueryParameter("platform", "web")
                .addQueryParameter("timezone_offset", "-480")
                .build()
            val (effectiveCookie, url) = prepareRequest(cookie, rawUrl)
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
            val rawUrl = baseUrl.newBuilder()
                .addPathSegments("x/relation/followings")
                .addQueryParameter("vmid", uid.toString())
                .addQueryParameter("ps", "50")
                .addQueryParameter("pn", "1")
                .addQueryParameter("order", "desc")
                .addQueryParameter("order_type", "attention")
                .build()
            val (effectiveCookie, url) = prepareRequest(cookie, rawUrl)
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
            // Device model unified to `Pixel 7` to match the /spi + /nav UAs
            // (lines 157, 256) — inconsistent device model within one session
            // is itself a fingerprint anomaly. Removed prior `ChainlessChain`
            // literal which was a trivial blocklist string (audit 2026-05-29 S1).
            .header(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
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
                        "BilibiliApiClient: %s → code=%d msg=%s | full-url=%s | body-head=%s",
                        url.encodedPath, code, msg, url.toString(), body.take(300)
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

/**
 * URL-encode per Bilibili's WBI sign rules (UTF-8 + standard %xx, mirrors
 * the JS encodeURIComponent the web client uses on each key/value).
 */
internal fun urlEncodeWbi(s: String): String = URLEncoder.encode(s, "UTF-8")
    // URLEncoder uses + for space; encodeURIComponent uses %20.
    .replace("+", "%20")

/** Lowercase-hex MD5 digest (matches Bilibili's JS CryptoJS.MD5 output). */
internal fun md5Hex(input: String): String {
    val md = MessageDigest.getInstance("MD5")
    val bytes = md.digest(input.toByteArray(Charsets.UTF_8))
    val sb = StringBuilder(bytes.size * 2)
    for (b in bytes) {
        sb.append(((b.toInt() shr 4) and 0xF).toString(16))
        sb.append((b.toInt() and 0xF).toString(16))
    }
    return sb.toString()
}
