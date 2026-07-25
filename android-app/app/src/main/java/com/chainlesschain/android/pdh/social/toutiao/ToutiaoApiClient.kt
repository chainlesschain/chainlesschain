package com.chainlesschain.android.pdh.social.toutiao

import com.chainlesschain.android.pdh.social.NullSignProvider
import com.chainlesschain.android.pdh.social.SignProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.IOException
import java.math.BigDecimal
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

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

    data class SourceRequest(
        val operation: String,
        val page: Int,
        val cursor: String? = null,
        val offset: Long? = null,
    )

    /**
     * Immutable request-scoped dependencies. A fetch captures or receives one
     * instance at entry and never re-reads mutable singleton configuration
     * while paging.
     */
    data class RequestContext(
        val signProvider: SignProvider = NullSignProvider,
        val beforeSourceRequest: (suspend (SourceRequest) -> Unit)? = null,
    )

    private val defaultRequestContextRef = AtomicReference(RequestContext())

    /**
     * Legacy mutable configuration retained for callers that configure the
     * singleton before invoking a fetch. Each setter atomically replaces the
     * default context; each legacy fetch snapshots it exactly once.
     */
    var signProvider: SignProvider
        get() = defaultRequestContextRef.get().signProvider
        set(value) = updateDefaultRequestContext { it.copy(signProvider = value) }

    var beforeSourceRequest: (suspend (SourceRequest) -> Unit)?
        get() = defaultRequestContextRef.get().beforeSourceRequest
        set(value) = updateDefaultRequestContext { it.copy(beforeSourceRequest = value) }

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

    /**
     * Immutable so a caller never observes a code from one request paired with
     * the message from another concurrent request. The legacy scalar getters
     * remain for source/binary compatibility; collectors should read this
     * snapshot once.
     */
    data class ErrorSnapshot(
        val code: Int = 0,
        val message: String? = null,
    )

    data class FetchResult<T>(
        val value: T,
        val error: ErrorSnapshot,
    )

    private class OperationError {
        var snapshot: ErrorSnapshot = ErrorSnapshot()
    }

    private val errorSnapshotRef = AtomicReference(ErrorSnapshot())

    private fun updateDefaultRequestContext(
        transform: (RequestContext) -> RequestContext,
    ) {
        while (true) {
            val current = defaultRequestContextRef.get()
            if (defaultRequestContextRef.compareAndSet(current, transform(current))) return
        }
    }

    private fun captureDefaultRequestContext(): RequestContext =
        defaultRequestContextRef.get()

    val lastErrorSnapshot: ErrorSnapshot
        get() = errorSnapshotRef.get()

    val lastErrorCode: Int
        get() = errorSnapshotRef.get().code

    val lastErrorMessage: String?
        get() = errorSnapshotRef.get().message

    private sealed class PageContinuation<out T> {
        object End : PageContinuation<Nothing>()
        data class Next<T>(val value: T) : PageContinuation<T>()
        data class Invalid(val reason: String) : PageContinuation<Nothing>()
    }

    private sealed class PaginationFlag {
        object Absent : PaginationFlag()
        object More : PaginationFlag()
        object End : PaginationFlag()
        data class Invalid(val reason: String) : PaginationFlag()
    }

    private data class RawHttpResponse(
        val code: Int,
        val successful: Boolean,
        val body: String?,
    )

    /**
     * v0.1 entry: WebView 把 cookie 字符串递回来后调本方法抽 uid + 校验"已登录"。
     *
     * 返回 null = cookie 不含可识别的 uid 字段（基本可断定为未登录或登录未完成）。
     * 上层应 surface "登录未完成，请重试" 而非 silent 写空 store。
     */
    fun extractUid(cookie: String?): String? =
        extractUidResult(cookie).value

    /**
     * Request-local UID extraction result. The value and diagnostic are
     * produced together, so concurrent singleton calls cannot mismatch them.
     */
    fun extractUidResult(cookie: String?): FetchResult<String?> {
        val operationError = OperationError()
        val value = extractUidInternal(cookie, operationError)
        return FetchResult(value, operationError.snapshot)
    }

    private fun extractUidInternal(
        cookie: String?,
        operationError: OperationError,
    ): String? {
        if (cookie.isNullOrBlank()) {
            setLastError(operationError, -1, "cookie 为空")
            return null
        }
        // 优先：passport_uid (旧版登录后稳定，2025+ 已 deprecated)
        val passportUid = Regex("(?:^|; ?)passport_uid=(\\d+)").find(cookie)?.groupValues?.getOrNull(1)
        if (passportUid != null && passportUid.isNotBlank() && passportUid != "0") {
            clearLastError(operationError)
            return passportUid
        }
        // 次选：multi_sids 第一段 uid。格式 "12345:abcd;67890:efgh"
        val multiSidsRaw = Regex("(?:^|; ?)multi_sids=([^;]+)").find(cookie)?.groupValues?.getOrNull(1)
        if (!multiSidsRaw.isNullOrBlank()) {
            val firstUid = multiSidsRaw.substringBefore(';').substringBefore(':').trim()
            if (firstUid.isNotBlank() && firstUid.all { it.isDigit() } && firstUid != "0") {
                clearLastError(operationError)
                return firstUid
            }
        }
        // legacy 数字 uid fallback
        val legacy = Regex("(?:^|; ?)(?:__ac_uid|tt_uid)=(\\d+)").find(cookie)?.groupValues?.getOrNull(1)
        if (legacy != null && legacy.isNotBlank() && legacy != "0") {
            clearLastError(operationError)
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
            clearLastError(operationError)
            return uidTt
        }
        val ssoUidTt = Regex("(?:^|; ?)sso_uid_tt=([0-9a-fA-F]{16,64})").find(cookie)?.groupValues?.getOrNull(1)
        if (ssoUidTt != null && ssoUidTt.isNotBlank()) {
            clearLastError(operationError)
            return ssoUidTt
        }
        val ttWebid = Regex("(?:^|; ?)tt_webid=(\\d{10,})").find(cookie)?.groupValues?.getOrNull(1)
        if (ttWebid != null && ttWebid.isNotBlank() && ttWebid != "0") {
            clearLastError(operationError)
            return ttWebid
        }
        // 没找到任何 uid 字段 — cookie 是"匿名"或"登录未完成"
        setLastError(
            operationError,
            -7,
            "cookie 缺 passport_uid/multi_sids/__ac_uid/uid_tt/sso_uid_tt/tt_webid — 登录未完成或仅游客态",
        )
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
    suspend fun fetchProfile(cookie: String): ProfileInfo? =
        fetchProfileResult(cookie).value

    suspend fun fetchProfile(
        cookie: String,
        context: RequestContext,
    ): ProfileInfo? = fetchProfileResult(cookie, context).value

    suspend fun fetchProfileResult(cookie: String): FetchResult<ProfileInfo?> =
        fetchProfileResult(cookie, captureDefaultRequestContext())

    suspend fun fetchProfileResult(
        cookie: String,
        context: RequestContext,
    ): FetchResult<ProfileInfo?> {
        val operationError = OperationError()
        val value = fetchProfileInternal(cookie, context, operationError)
        return FetchResult(value, operationError.snapshot)
    }

    private suspend fun fetchProfileInternal(
        cookie: String,
        context: RequestContext,
        operationError: OperationError,
    ): ProfileInfo? = withContext(Dispatchers.IO) {
        if (cookie.isBlank()) {  // audit F4
            setLastError(operationError, -8, "missing cookie")
            return@withContext null
        }
        val url = baseUrl.newBuilder()
            .addPathSegments("passport/account/info/v2/")
            .addQueryParameter("aid", "24")
            .build()
        val obj = doGetJson(
            url = url,
            cookie = cookie,
            sourceRequest = SourceRequest(operation = "profile", page = 1),
            context = context,
            operationError = operationError,
        ) ?: return@withContext null
        val statusCode = obj.optExactInt("status_code")
        val message = obj.optStringOrNull("message")?.trim()
        val messageSuccess = message.equals("success", ignoreCase = true)
        val ok = statusCode == 0 || (!obj.has("status_code") && messageSuccess)
        if (!ok) {
            val topKeys = obj.keys().asSequence().toList().joinToString(",")
            val detail = businessDescription(obj, obj.optJSONObject("data"))
            if (statusCode != null) {
                setLastError(
                    operationError,
                    statusCode,
                    detail ?: "status_code=$statusCode",
                )
            } else {
                // Retain the historical "missing status_code" hint while
                // recognizing passport-v2's message=success shape.
                setLastError(
                    operationError,
                    ERROR_UNRECOGNIZED_ENVELOPE,
                    "passport/info/v2 missing status_code or message=success " +
                        "(message=${message ?: "null"}, keys=[$topKeys])",
                )
            }
            return@withContext null
        }
        val data = obj.optJSONObject("data")
        if (data == null) {
            // body=%s dropped — passport PII (audit F2)
            Timber.w(
                "ToutiaoApiClient: passport/info/v2 status_code=0 but no `data` object; bodyLen=%d",
                obj.toString().length,
            )
            setLastError(operationError, ERROR_INVALID_SOURCE_PAGE, "profile ok but no `data` object")
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
                operationError,
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
    suspend fun fetchFeed(
        cookie: String,
        limit: Int = DEFAULT_FEED_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): List<FeedItem> = fetchFeedResult(cookie, limit, maxPages).value

    suspend fun fetchFeed(
        cookie: String,
        context: RequestContext,
        limit: Int = DEFAULT_FEED_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): List<FeedItem> = fetchFeedResult(cookie, context, limit, maxPages).value

    suspend fun fetchFeedResult(
        cookie: String,
        limit: Int = DEFAULT_FEED_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): FetchResult<List<FeedItem>> =
        fetchFeedResult(cookie, captureDefaultRequestContext(), limit, maxPages)

    suspend fun fetchFeedResult(
        cookie: String,
        context: RequestContext,
        limit: Int = DEFAULT_FEED_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): FetchResult<List<FeedItem>> {
        val operationError = OperationError()
        val value = fetchFeedInternal(cookie, context, limit, maxPages, operationError)
        return FetchResult(value, operationError.snapshot)
    }

    private suspend fun fetchFeedInternal(
        cookie: String,
        context: RequestContext,
        limit: Int,
        maxPages: Int,
        operationError: OperationError,
    ): List<FeedItem> = withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(operationError, -8, "missing cookie")
                return@withContext emptyList()
            }
            val resultLimit = normalizeLimit(limit, DEFAULT_FEED_LIMIT)
            val pageLimit = normalizeMaxPages(maxPages)
            val out = ArrayList<FeedItem>(minOf(resultLimit, FEED_PAGE_SIZE * pageLimit))
            val seenItems = mutableSetOf<String>()
            val seenPages = mutableSetOf<String>()
            val seenCursors = mutableSetOf<String>()
            var cursor: String? = null

            for (page in 1..pageLimit) {
                if (out.size >= resultLimit) break
                val requestCount = minOf(FEED_PAGE_SIZE, resultLimit - out.size)
                val rawUrl = baseUrl.newBuilder()
                    .addPathSegments("api/news/feed/v90/")
                    .addQueryParameter("category", "__all__")
                    .addQueryParameter("aid", "24")
                    .addQueryParameter("client_extra_params", "{}")
                    .addQueryParameter("count", requestCount.toString())
                    .apply {
                        cursor?.let { addQueryParameter("max_behot_time", it) }
                    }
                    .build()
                val url = signUrlOrRecord(
                    rawUrl,
                    "feed",
                    page,
                    context.signProvider,
                    operationError,
                ) ?: break
                val obj = doGetJson(
                    url = url,
                    cookie = cookie,
                    sourceRequest = SourceRequest(
                        operation = "feed",
                        page = page,
                        cursor = cursor,
                    ),
                    context = context,
                    operationError = operationError,
                ) ?: break
                val data = recognizedArray(
                    obj,
                    "feed",
                    operationError,
                    listOf("data"),
                ) ?: break
                if (!seenPages.add(pageFingerprint(data, ::feedItemKey))) {
                    setPaginationError(operationError, "feed", page, "repeated page")
                    break
                }

                for (i in 0 until data.length()) {
                    if (out.size >= resultLimit) break
                    val item = parseFeedItem(data.optJSONObject(i) ?: continue) ?: continue
                    if (!seenItems.add(item.itemId)) continue
                    out.add(item)
                }
                if (out.size >= resultLimit) break
                if (data.length() == 0) {
                    captureEmptyPageContinuation(
                        feedContinuation(obj),
                        operationError,
                        "feed",
                        page,
                    )
                    break
                }
                when (val continuation = feedContinuation(obj)) {
                    PageContinuation.End -> break
                    is PageContinuation.Invalid -> {
                        setPaginationError(operationError, "feed", page, continuation.reason)
                        break
                    }
                    is PageContinuation.Next -> {
                        val nextCursor = continuation.value
                        if (nextCursor == cursor || !seenCursors.add(nextCursor)) {
                            setPaginationError(
                                operationError,
                                "feed",
                                page,
                                "repeated cursor '$nextCursor'",
                            )
                            break
                        }
                        if (page == pageLimit) {
                            setPaginationError(
                                operationError,
                                "feed",
                                page,
                                "page cap $pageLimit reached with a continuation cursor",
                            )
                            break
                        }
                        cursor = nextCursor
                    }
                }
            }
            out
        }

    /**
     * v0.3 — Collected articles. `tab_comments` is misleadingly named: it's
     * the user's "my favorites" list in the Toutiao web app, returning
     * `data: [{ group_id, title, source, behot_time, ...}]`.
     */
    suspend fun fetchCollection(
        cookie: String,
        limit: Int = DEFAULT_COLLECTION_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): List<CollectionItem> = fetchCollectionResult(cookie, limit, maxPages).value

    suspend fun fetchCollection(
        cookie: String,
        context: RequestContext,
        limit: Int = DEFAULT_COLLECTION_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): List<CollectionItem> = fetchCollectionResult(cookie, context, limit, maxPages).value

    suspend fun fetchCollectionResult(
        cookie: String,
        limit: Int = DEFAULT_COLLECTION_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): FetchResult<List<CollectionItem>> =
        fetchCollectionResult(cookie, captureDefaultRequestContext(), limit, maxPages)

    suspend fun fetchCollectionResult(
        cookie: String,
        context: RequestContext,
        limit: Int = DEFAULT_COLLECTION_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): FetchResult<List<CollectionItem>> {
        val operationError = OperationError()
        val value = fetchCollectionInternal(cookie, context, limit, maxPages, operationError)
        return FetchResult(value, operationError.snapshot)
    }

    private suspend fun fetchCollectionInternal(
        cookie: String,
        context: RequestContext,
        limit: Int,
        maxPages: Int,
        operationError: OperationError,
    ): List<CollectionItem> = withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(operationError, -8, "missing cookie")
                return@withContext emptyList()
            }
            val resultLimit = normalizeLimit(limit, DEFAULT_COLLECTION_LIMIT)
            val pageLimit = normalizeMaxPages(maxPages)
            val out = ArrayList<CollectionItem>(minOf(resultLimit, COLLECTION_PAGE_SIZE * pageLimit))
            val seenItems = mutableSetOf<String>()
            val seenPages = mutableSetOf<String>()
            val seenOffsets = mutableSetOf(0L)
            var offset = 0L

            for (page in 1..pageLimit) {
                if (out.size >= resultLimit) break
                val requestCount = minOf(COLLECTION_PAGE_SIZE, resultLimit - out.size)
                val rawUrl = baseUrl.newBuilder()
                    .addPathSegments("article/v2/tab_comments/")
                    .addQueryParameter("aid", "24")
                    .addQueryParameter("count", requestCount.toString())
                    .apply {
                        if (page > 1) addQueryParameter("offset", offset.toString())
                    }
                    .build()
                val url = signUrlOrRecord(
                    rawUrl,
                    "comments",
                    page,
                    context.signProvider,
                    operationError,
                ) ?: break
                val obj = doGetJson(
                    url = url,
                    cookie = cookie,
                    sourceRequest = SourceRequest(
                        operation = "collection",
                        page = page,
                        offset = offset,
                    ),
                    context = context,
                    operationError = operationError,
                ) ?: break
                val data = recognizedArray(
                    obj,
                    "collection",
                    operationError,
                    listOf("data"),
                ) ?: break
                if (!seenPages.add(pageFingerprint(data, ::articleItemKey))) {
                    setPaginationError(operationError, "collection", page, "repeated page")
                    break
                }

                for (i in 0 until data.length()) {
                    if (out.size >= resultLimit) break
                    val item = parseCollectionItem(data.optJSONObject(i) ?: continue) ?: continue
                    if (!seenItems.add(item.itemId)) continue
                    out.add(item)
                }
                if (out.size >= resultLimit) break
                if (data.length() == 0) {
                    captureEmptyPageContinuation(
                        offsetContinuation(obj, offset, 0),
                        operationError,
                        "collection",
                        page,
                    )
                    break
                }
                when (val continuation = offsetContinuation(obj, offset, data.length())) {
                    PageContinuation.End -> break
                    is PageContinuation.Invalid -> {
                        setPaginationError(operationError, "collection", page, continuation.reason)
                        break
                    }
                    is PageContinuation.Next -> {
                        val nextOffset = continuation.value
                        if (!seenOffsets.add(nextOffset)) {
                            setPaginationError(
                                operationError,
                                "collection",
                                page,
                                "repeated offset $nextOffset",
                            )
                            break
                        }
                        if (page == pageLimit) {
                            setPaginationError(
                                operationError,
                                "collection",
                                page,
                                "page cap $pageLimit reached with a continuation offset",
                            )
                            break
                        }
                        offset = nextOffset
                    }
                }
            }
            out
        }

    /**
     * v0.3 — Search history. Toutiao web stores recent searches in
     * `/api/search/content/?keyword=<empty>` returns the user's recent
     * query list under `data.user_search_history` (when logged in).
     */
    suspend fun fetchSearchHistory(
        cookie: String,
        limit: Int = DEFAULT_SEARCH_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): List<SearchItem> = fetchSearchHistoryResult(cookie, limit, maxPages).value

    suspend fun fetchSearchHistory(
        cookie: String,
        context: RequestContext,
        limit: Int = DEFAULT_SEARCH_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): List<SearchItem> = fetchSearchHistoryResult(cookie, context, limit, maxPages).value

    suspend fun fetchSearchHistoryResult(
        cookie: String,
        limit: Int = DEFAULT_SEARCH_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): FetchResult<List<SearchItem>> =
        fetchSearchHistoryResult(cookie, captureDefaultRequestContext(), limit, maxPages)

    suspend fun fetchSearchHistoryResult(
        cookie: String,
        context: RequestContext,
        limit: Int = DEFAULT_SEARCH_LIMIT,
        maxPages: Int = DEFAULT_MAX_PAGES,
    ): FetchResult<List<SearchItem>> {
        val operationError = OperationError()
        val value = fetchSearchHistoryInternal(cookie, context, limit, maxPages, operationError)
        return FetchResult(value, operationError.snapshot)
    }

    private suspend fun fetchSearchHistoryInternal(
        cookie: String,
        context: RequestContext,
        limit: Int,
        maxPages: Int,
        operationError: OperationError,
    ): List<SearchItem> = withContext(Dispatchers.IO) {
            if (cookie.isBlank()) {  // audit F4
                setLastError(operationError, -8, "missing cookie")
                return@withContext emptyList()
            }
            val resultLimit = normalizeLimit(limit, DEFAULT_SEARCH_LIMIT)
            val pageLimit = normalizeMaxPages(maxPages)
            val out = ArrayList<SearchItem>(minOf(resultLimit, SEARCH_PAGE_SIZE * pageLimit))
            val seenItems = mutableSetOf<String>()
            val seenPages = mutableSetOf<String>()
            val seenOffsets = mutableSetOf(0L)
            val scanStartedAt = System.currentTimeMillis()
            var syntheticIndex = 0
            var offset = 0L

            for (page in 1..pageLimit) {
                if (out.size >= resultLimit) break
                val requestCount = minOf(SEARCH_PAGE_SIZE, resultLimit - out.size)
                val rawUrl = baseUrl.newBuilder()
                    .addPathSegments("api/search/content/")
                    .addQueryParameter("aid", "24")
                    .addQueryParameter("keyword", "")
                    .addQueryParameter("count", requestCount.toString())
                    .apply {
                        if (page > 1) addQueryParameter("offset", offset.toString())
                    }
                    .build()
                val url = signUrlOrRecord(
                    rawUrl,
                    "search",
                    page,
                    context.signProvider,
                    operationError,
                ) ?: break
                val obj = doGetJson(
                    url = url,
                    cookie = cookie,
                    sourceRequest = SourceRequest(
                        operation = "search-history",
                        page = page,
                        offset = offset,
                    ),
                    context = context,
                    operationError = operationError,
                ) ?: break
                val history = recognizedArray(
                    obj,
                    "search-history",
                    operationError,
                    listOf("data", "user_search_history"),
                    listOf("data", "search_history"),
                ) ?: break
                if (!seenPages.add(pageFingerprint(history, ::searchItemKey))) {
                    setPaginationError(operationError, "search-history", page, "repeated page")
                    break
                }

                for (i in 0 until history.length()) {
                    if (out.size >= resultLimit) break
                    val raw = history.opt(i) ?: continue
                    val itemKey = searchItemKey(raw) ?: continue
                    if (!seenItems.add(itemKey)) continue
                    val item = parseSearchItem(raw, scanStartedAt, syntheticIndex) ?: continue
                    if (raw is String) syntheticIndex += 1
                    out.add(item)
                }
                if (out.size >= resultLimit) break
                if (history.length() == 0) {
                    captureEmptyPageContinuation(
                        offsetContinuation(obj, offset, 0),
                        operationError,
                        "search-history",
                        page,
                    )
                    break
                }
                when (val continuation = offsetContinuation(obj, offset, history.length())) {
                    PageContinuation.End -> break
                    is PageContinuation.Invalid -> {
                        setPaginationError(operationError, "search-history", page, continuation.reason)
                        break
                    }
                    is PageContinuation.Next -> {
                        val nextOffset = continuation.value
                        if (!seenOffsets.add(nextOffset)) {
                            setPaginationError(
                                operationError,
                                "search-history",
                                page,
                                "repeated offset $nextOffset",
                            )
                            break
                        }
                        if (page == pageLimit) {
                            setPaginationError(
                                operationError,
                                "search-history",
                                page,
                                "page cap $pageLimit reached with a continuation offset",
                            )
                            break
                        }
                        offset = nextOffset
                    }
                }
            }
            out
        }

    private fun parseFeedItem(raw: JSONObject): FeedItem? {
        // Some feed cells have the real article nested under `raw_data`
        // (encoded JSON string); others are top-level.
        val item = decodeNestedRaw(raw) ?: raw
        val id = item.optStringOrNull("group_id")
            ?: item.optStringOrNull("item_id")
            ?: return null
        return FeedItem(
            itemId = id,
            title = item.optStringOrNull("title") ?: "(no title)",
            category = item.optStringOrNull("category")
                ?: raw.optStringOrNull("category"),
            author = item.optJSONObject("user_info")?.optStringOrNull("name")
                ?: item.optStringOrNull("source"),
            publishedAt = epochMillis(
                item.optLong("behot_time").takeIf { it > 0 }
                    ?: item.optLong("publish_time"),
            ),
            readDuration = item.optInt("read_duration", 0),
            source = item.optStringOrNull("source"),
        )
    }

    private fun parseCollectionItem(item: JSONObject): CollectionItem? {
        val id = item.optStringOrNull("group_id")
            ?: item.optStringOrNull("item_id")
            ?: return null
        return CollectionItem(
            itemId = id,
            title = item.optStringOrNull("title") ?: "(no title)",
            category = item.optStringOrNull("category"),
            author = item.optJSONObject("user_info")?.optStringOrNull("name")
                ?: item.optStringOrNull("source"),
            savedAt = epochMillis(
                item.optLong("behot_time").takeIf { it > 0 }
                    ?: item.optLong("create_time"),
            ),
        )
    }

    private fun parseSearchItem(
        raw: Any,
        scanStartedAt: Long,
        syntheticIndex: Int,
    ): SearchItem? {
        return when (raw) {
            is JSONObject -> {
                val keyword = raw.optStringOrNull("keyword")
                    ?: raw.optStringOrNull("query")
                    ?: return null
                if (keyword.isBlank()) return null
                SearchItem(
                    keyword = keyword,
                    searchedAt = epochMillis(
                        raw.optLong("time").takeIf { it > 0 }
                            ?: raw.optLong("search_time"),
                    ),
                )
            }
            is String -> {
                if (raw.isBlank()) return null
                SearchItem(
                    keyword = raw,
                    searchedAt = scanStartedAt - syntheticIndex * 1000L,
                )
            }
            else -> null
        }
    }

    private fun recognizedArray(
        response: JSONObject,
        stream: String,
        operationError: OperationError,
        vararg paths: List<String>,
    ): JSONArray? {
        for (path in paths) {
            var current: Any? = response
            for (segment in path) {
                current = (current as? JSONObject)?.opt(segment)
                if (current == null || current === JSONObject.NULL) break
            }
            if (current is JSONArray) return current
        }
        setLastError(
            operationError,
            ERROR_INVALID_SOURCE_PAGE,
            "$stream response missing recognized list",
        )
        return null
    }

    private fun pageFingerprint(
        items: JSONArray,
        itemKey: (Any?) -> String?,
    ): String = buildString {
        for (i in 0 until items.length()) {
            if (i > 0) append('\u001f')
            val raw = items.opt(i)
            append(itemKey(raw) ?: raw?.toString() ?: "null")
        }
    }

    private fun feedItemKey(raw: Any?): String? {
        val cell = raw as? JSONObject ?: return null
        val item = decodeNestedRaw(cell) ?: cell
        return item.optStringOrNull("group_id")
            ?: item.optStringOrNull("item_id")
    }

    private fun articleItemKey(raw: Any?): String? {
        val item = raw as? JSONObject ?: return null
        return item.optStringOrNull("group_id")
            ?: item.optStringOrNull("item_id")
    }

    private fun searchItemKey(raw: Any?): String? {
        return when (raw) {
            is String -> "string:$raw"
            is JSONObject -> {
                val keyword = raw.optStringOrNull("keyword")
                    ?: raw.optStringOrNull("query")
                    ?: return null
                "$keyword:${raw.optLong("time").takeIf { it > 0 } ?: raw.optLong("search_time")}"
            }
            else -> null
        }
    }

    private fun feedContinuation(response: JSONObject): PageContinuation<String> {
        val paginationFlag = paginationFlag(response)
        when (paginationFlag) {
            PaginationFlag.End -> return PageContinuation.End
            is PaginationFlag.Invalid -> {
                return PageContinuation.Invalid(paginationFlag.reason)
            }
            PaginationFlag.Absent,
            PaginationFlag.More -> Unit
        }
        val next = response.optJSONObject("next")
        val candidates = listOfNotNull(
            next?.presentValue("max_behot_time", "next.max_behot_time"),
            next?.presentValue("maxBehotTime", "next.maxBehotTime"),
            response.presentValue("max_behot_time", "max_behot_time"),
            response.presentValue("next_max_behot_time", "next_max_behot_time"),
        )
        val continuationAdvertised =
            paginationFlag === PaginationFlag.More ||
                next?.has("max_behot_time") == true ||
                next?.has("maxBehotTime") == true ||
                response.has("max_behot_time") ||
                response.has("next_max_behot_time")
        if (!continuationAdvertised) return PageContinuation.End
        val candidate = candidates.firstOrNull()
            ?: return PageContinuation.Invalid("has_more=true without a usable continuation cursor")
        val cursor = scalarCursor(candidate.second)
            ?: return PageContinuation.Invalid(
                "${candidate.first} must be a non-empty scalar string or integral number",
            )
        return PageContinuation.Next(cursor)
    }

    private fun offsetContinuation(
        response: JSONObject,
        currentOffset: Long,
        itemCount: Int,
    ): PageContinuation<Long> {
        val paginationFlag = paginationFlag(response)
        when (paginationFlag) {
            PaginationFlag.End -> return PageContinuation.End
            is PaginationFlag.Invalid -> {
                return PageContinuation.Invalid(paginationFlag.reason)
            }
            PaginationFlag.Absent,
            PaginationFlag.More -> Unit
        }
        val next = response.optJSONObject("next")
        val explicit = listOfNotNull(
            next?.presentValue("offset", "next.offset"),
            response.presentValue("next_offset", "next_offset"),
            response.presentValue("nextOffset", "nextOffset"),
        ).firstOrNull()
        if (explicit != null) {
            val value = exactLong(explicit.second)
                ?: return PageContinuation.Invalid(
                    "${explicit.first} must be an integral 64-bit offset",
                )
            if (value <= currentOffset) {
                return PageContinuation.Invalid(
                    "non-forward ${explicit.first}=$value (current=$currentOffset)",
                )
            }
            return PageContinuation.Next(value)
        }
        if (paginationFlag !== PaginationFlag.More) return PageContinuation.End
        if (itemCount <= 0) {
            return PageContinuation.Invalid("has_more=true without a usable continuation offset")
        }
        val fallback = try {
            Math.addExact(currentOffset, itemCount.toLong())
        } catch (_: ArithmeticException) {
            return PageContinuation.Invalid("offset overflow after $currentOffset")
        }
        if (fallback <= currentOffset) {
            return PageContinuation.Invalid("non-forward derived offset $fallback")
        }
        return PageContinuation.Next(fallback)
    }

    private fun normalizeLimit(limit: Int, defaultValue: Int): Int {
        val positive = if (limit > 0) limit else defaultValue
        return positive.coerceAtMost(MAX_RESULT_LIMIT)
    }

    private fun normalizeMaxPages(maxPages: Int): Int =
        maxPages.coerceIn(1, DEFAULT_MAX_PAGES)

    private fun epochMillis(value: Long): Long = when {
        value <= 0L -> 0L
        value > 1_000_000_000_000L -> value
        else -> value * 1000L
    }

    private fun JSONObject.presentValue(key: String, label: String): Pair<String, Any?>? {
        if (!has(key)) return null
        return label to opt(key)
    }

    private fun scalarCursor(raw: Any?): String? = when (raw) {
        is String -> raw.trim().takeIf { it.isNotEmpty() }
        is Number -> exactLong(raw)?.toString()
        else -> null
    }

    private fun JSONObject.optExactInt(key: String): Int? {
        if (!has(key) || isNull(key)) return null
        return exactInt(opt(key))
    }

    private fun exactInt(raw: Any?): Int? {
        val value = exactLong(raw) ?: return null
        return value.takeIf { it in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong() }?.toInt()
    }

    private fun exactLong(raw: Any?): Long? = when (raw) {
        is String -> raw.trim()
            .takeIf { INTEGER_TOKEN.matches(it) }
            ?.toLongOrNull()
        is Number -> try {
            BigDecimal(raw.toString()).toBigIntegerExact().longValueExact()
        } catch (_: ArithmeticException) {
            null
        } catch (_: NumberFormatException) {
            null
        }
        else -> null
    }

    private fun paginationFlag(response: JSONObject): PaginationFlag {
        var parsed: Boolean? = null
        var parsedKey: String? = null
        for (key in PAGINATION_FLAG_KEYS) {
            if (!response.has(key)) continue
            val value = response.opt(key)
            val current = when {
                isTrueLike(value) -> true
                isFalseLike(value) -> false
                else -> {
                    return PaginationFlag.Invalid(
                        "$key must be a boolean-like pagination flag",
                    )
                }
            }
            if (parsed != null && parsed != current) {
                return PaginationFlag.Invalid(
                    "conflicting pagination flags $parsedKey and $key",
                )
            }
            parsed = current
            parsedKey = key
        }
        return when (parsed) {
            true -> PaginationFlag.More
            false -> PaginationFlag.End
            null -> PaginationFlag.Absent
        }
    }

    private fun <T> captureEmptyPageContinuation(
        continuation: PageContinuation<T>,
        operationError: OperationError,
        operation: String,
        page: Int,
    ) {
        when (continuation) {
            PageContinuation.End -> Unit
            is PageContinuation.Invalid -> setPaginationError(
                operationError,
                operation,
                page,
                "empty page: ${continuation.reason}",
            )
            is PageContinuation.Next -> setPaginationError(
                operationError,
                operation,
                page,
                "empty page advertised a continuation",
            )
        }
    }

    private fun isTrueLike(value: Any?): Boolean =
        value == true ||
            value == 1 ||
            value == 1L ||
            (value is String && value.trim().lowercase() in TRUE_TOKENS)

    private fun isFalseLike(value: Any?): Boolean {
        if (value == false || value == 0 || value == 0L) return true
        if (value !is String) return false
        return value.trim().lowercase() in FALSE_TOKENS
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

    private suspend fun signUrlOrRecord(
        rawUrl: HttpUrl,
        purpose: String,
        page: Int,
        requestSignProvider: SignProvider,
        operationError: OperationError,
    ): HttpUrl? {
        return try {
            requestSignProvider.signUrl(rawUrl, purpose).also { signed ->
                if (signed == null) {
                    setLastError(
                        operationError,
                        ERROR_SIGNER_UNAVAILABLE,
                        "_signature unavailable for $purpose page $page " +
                            "(bridge not warm or rotated)",
                    )
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            setLastError(
                operationError,
                ERROR_SIGNER_UNAVAILABLE,
                "signProvider failed for $purpose page $page: " +
                    (e.message ?: e.javaClass.simpleName),
            )
            null
        }
    }

    private fun setPaginationError(
        operationError: OperationError,
        stream: String,
        page: Int,
        detail: String,
    ) {
        setLastError(
            operationError,
            ERROR_PAGINATION_TRUNCATED,
            "$stream pagination truncated at page $page: $detail",
        )
    }

    private suspend fun doGetJson(
        url: HttpUrl,
        cookie: String,
        sourceRequest: SourceRequest,
        context: RequestContext,
        operationError: OperationError,
    ): JSONObject? {
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
        if (!acquireSourceRequestPermit(
                sourceRequest,
                context.beforeSourceRequest,
                operationError,
            )
        ) return null
        return try {
            val response = executeSingleAttempt(req)
            val body = response.body
            if (body == null) {
                setLastError(operationError, -1, "empty body")
                return null
            }
            if (!response.successful) {
                Timber.w(
                    "ToutiaoApiClient: %s -> HTTP %d bodyLen=%d",
                    url.encodedPath, response.code, body.length,
                )
                setLastError(operationError, response.code, "HTTP ${response.code}")
                return null
            }
            val trimmed = body.trimStart()
            if (!trimmed.startsWith("{")) {
                Timber.w(
                    "ToutiaoApiClient: %s -> non-JSON body (likely login redirect or anti-bot)",
                    url.encodedPath,
                )
                setLastError(
                    operationError,
                    -4,
                    "non-json (cookie expired or anti-bot triggered)",
                )
                return null
            }
            val obj = JSONObject(body)
            if (!validateBusinessEnvelope(obj, operationError)) return null
            clearLastError(operationError)
            obj
        } catch (e: IOException) {
            Timber.w(e, "ToutiaoApiClient: IO error on %s", url.encodedPath)
            setLastError(operationError, -2, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.w(e, "ToutiaoApiClient: parse error on %s", url.encodedPath)
            setLastError(operationError, -3, "parse: ${e.message ?: e.javaClass.simpleName}")
            null
        }
    }

    private suspend fun executeSingleAttempt(request: Request): RawHttpResponse =
        suspendCancellableCoroutine { continuation ->
            val wireAttempted = AtomicBoolean(false)
            // OkHttp may retry a 421 from a coalesced HTTP/2 connection even
            // when retryOnConnectionFailure=false. Rewrite it to a
            // non-follow-up status inside the interceptor, then restore the
            // source status in our immutable result.
            val preservedStatus = AtomicReference<Int?>(null)
            val singleAttemptClient = httpClient.newBuilder()
                .retryOnConnectionFailure(false)
                .followRedirects(false)
                .followSslRedirects(false)
                .authenticator(okhttp3.Authenticator.NONE)
                .proxyAuthenticator(okhttp3.Authenticator.NONE)
                // Prevent OkHttp's special Retry-After: 0 follow-up.
                .addNetworkInterceptor { chain ->
                    if (!wireAttempted.compareAndSet(false, true)) {
                        throw IOException("implicit HTTP follow-up blocked")
                    }
                    val response = chain.proceed(chain.request())
                    when {
                        response.code == 421 -> {
                            preservedStatus.compareAndSet(null, 421)
                            response.newBuilder().code(400).build()
                        }
                        response.code == 503 && response.header("Retry-After") == "0" -> {
                            response.newBuilder().header("Retry-After", "1").build()
                        }
                        else -> response
                    }
                }
                .build()
            val call = singleAttemptClient.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(
                object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        if (continuation.isActive) {
                            continuation.resumeWithException(e)
                        }
                    }

                    override fun onResponse(call: Call, response: Response) {
                        val result = try {
                            response.use {
                                val sourceCode = preservedStatus.get() ?: it.code
                                RawHttpResponse(
                                    code = sourceCode,
                                    successful = sourceCode in 200..299,
                                    body = it.body?.string(),
                                )
                            }
                        } catch (e: IOException) {
                            if (continuation.isActive) {
                                continuation.resumeWithException(e)
                            }
                            return
                        }
                        if (continuation.isActive) {
                            continuation.resume(result)
                        }
                    }
                },
            )
        }

    private suspend fun acquireSourceRequestPermit(
        request: SourceRequest,
        permit: (suspend (SourceRequest) -> Unit)?,
        operationError: OperationError,
    ): Boolean {
        permit ?: return true
        return try {
            permit(request)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            setLastError(
                operationError,
                ERROR_REQUEST_PERMIT,
                "source request permit failed: ${e.message ?: e.javaClass.simpleName}",
            )
            false
        }
    }

    private fun validateBusinessEnvelope(
        response: JSONObject,
        operationError: OperationError,
    ): Boolean {
        val nested = response.optJSONObject("data")
        for (key in BUSINESS_CODE_KEYS) {
            if (!validateBusinessCode(response, key, nested, operationError)) return false
        }
        if (nested != null) {
            for (key in BUSINESS_CODE_KEYS) {
                if (!validateBusinessCode(nested, key, response, operationError)) return false
            }
        }
        if (!validateExplicitFailure(response, nested, operationError)) return false
        if (nested != null &&
            !validateExplicitFailure(nested, response, operationError)
        ) return false
        return true
    }

    private fun validateBusinessCode(
        response: JSONObject,
        key: String,
        fallback: JSONObject?,
        operationError: OperationError,
    ): Boolean {
        if (!response.has(key)) return true
        if (response.isNull(key)) {
            setLastError(
                operationError,
                ERROR_INVALID_SOURCE_PAGE,
                "$key must be an integral 32-bit business code",
            )
            return false
        }
        val code = exactInt(response.opt(key))
        if (code == null) {
            setLastError(
                operationError,
                ERROR_INVALID_SOURCE_PAGE,
                "$key must be an integral 32-bit business code",
            )
            return false
        }
        if (code in SUCCESS_BUSINESS_CODES) return true
        setLastError(
            operationError,
            code,
            businessDescription(response, fallback) ?: "$key=$code",
        )
        return false
    }

    private fun validateExplicitFailure(
        response: JSONObject,
        fallback: JSONObject?,
        operationError: OperationError,
    ): Boolean {
        for (key in SUCCESS_FLAG_KEYS) {
            if (!response.has(key)) continue
            val value = response.opt(key)
            if (!isTrueLike(value) && !isFalseLike(value)) {
                setLastError(
                    operationError,
                    ERROR_INVALID_SOURCE_PAGE,
                    "$key must be a boolean-like success flag",
                )
                return false
            }
        }
        val reason = when {
            response.has("success") && isFalseLike(response.opt("success")) -> "success=false"
            response.has("ok") && isFalseLike(response.opt("ok")) -> "ok=false"
            response.optStringOrNull("message")
                ?.trim()
                ?.lowercase() in ERROR_MESSAGE_TOKENS -> "message=error"
            response.has("error") && isExplicitErrorValue(response.opt("error")) -> "error response"
            else -> return true
        }
        setLastError(
            operationError,
            ERROR_INVALID_SOURCE_PAGE,
            businessDescription(response, fallback) ?: reason,
        )
        return false
    }

    private fun isExplicitErrorValue(value: Any?): Boolean {
        if (value == null || value === JSONObject.NULL || value == false || value == 0 || value == 0L) {
            return false
        }
        if (isFalseLike(value)) return false
        if (value is String) {
            val token = value.trim().lowercase()
            return token.isNotEmpty() && token !in SUCCESS_MESSAGE_TOKENS
        }
        return true
    }

    private fun businessDescription(
        primary: JSONObject,
        secondary: JSONObject? = null,
    ): String? {
        fun descriptiveField(source: JSONObject?): String? {
            if (source == null) return null
            for (key in DESCRIPTION_KEYS) {
                val value = source.optStringOrNull(key)?.trim()
                if (!value.isNullOrEmpty()) return value
            }
            val message = source.optStringOrNull("message")?.trim()
            return message?.takeUnless {
                it.lowercase() in SUCCESS_MESSAGE_TOKENS ||
                    it.lowercase() in ERROR_MESSAGE_TOKENS
            }
        }
        return descriptiveField(primary)
            ?: descriptiveField(secondary)
            ?: primary.optStringOrNull("message")?.trim()
            ?: secondary?.optStringOrNull("message")?.trim()
    }

    private fun setLastError(code: Int, message: String?) {
        errorSnapshotRef.set(ErrorSnapshot(code, message))
    }

    private fun setLastError(
        operationError: OperationError,
        code: Int,
        message: String?,
    ) {
        val snapshot = ErrorSnapshot(code, message)
        operationError.snapshot = snapshot
        errorSnapshotRef.set(snapshot)
    }

    private fun clearLastError() {
        errorSnapshotRef.set(ErrorSnapshot())
    }

    private fun clearLastError(operationError: OperationError) {
        val snapshot = ErrorSnapshot()
        operationError.snapshot = snapshot
        errorSnapshotRef.set(snapshot)
    }

    companion object {
        const val ERROR_PAGINATION_TRUNCATED = -11
        const val ERROR_SIGNER_UNAVAILABLE = -99

        private const val ERROR_REQUEST_PERMIT = -10
        private const val ERROR_UNRECOGNIZED_ENVELOPE = -5
        private const val ERROR_INVALID_SOURCE_PAGE = -6
        private const val DEFAULT_FEED_LIMIT = 50
        private const val DEFAULT_COLLECTION_LIMIT = 200
        private const val DEFAULT_SEARCH_LIMIT = 100
        private const val DEFAULT_MAX_PAGES = 10
        private const val MAX_RESULT_LIMIT = 1_000
        private const val FEED_PAGE_SIZE = 50
        private const val COLLECTION_PAGE_SIZE = 200
        private const val SEARCH_PAGE_SIZE = 100
        private val INTEGER_TOKEN = Regex("[+-]?\\d+")
        private val TRUE_TOKENS = setOf("1", "true", "yes", "on")
        private val FALSE_TOKENS = setOf("0", "false", "no", "off")
        private val PAGINATION_FLAG_KEYS = listOf("has_more", "hasMore")
        private val SUCCESS_FLAG_KEYS = listOf("success", "ok")
        private val SUCCESS_BUSINESS_CODES = setOf(0, 200)
        private val SUCCESS_MESSAGE_TOKENS = setOf("0", "ok", "success")
        private val ERROR_MESSAGE_TOKENS = setOf("error", "failed", "fail")
        private val BUSINESS_CODE_KEYS = listOf(
            "err_no",
            "status_code",
            "code",
            "errno",
            "errorCode",
            "error_code",
        )
        private val DESCRIPTION_KEYS = listOf(
            "description",
            "error_description",
            "status_msg",
            "err_tips",
            "error_message",
            "errmsg",
            "msg",
        )
    }
}

// org.json helpers — JSONObject's opt* return primitive defaults rather than
// null on miss, which makes "field exists vs field absent" indistinguishable.
private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val v = optString(key)
    return v.takeIf { it.isNotEmpty() }
}
