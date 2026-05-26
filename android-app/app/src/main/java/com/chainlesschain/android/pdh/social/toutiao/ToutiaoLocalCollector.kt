package com.chainlesschain.android.pdh.social.toutiao

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.2 — Toutiao snapshot writer.
 *
 * **v0.2 surface**: cookie + profile fetch (`/passport/account/info/v2/?aid=24`,
 * unsigned ByteDance passport endpoint). 与 Douyin v0.2 同模板。read/collection/
 * search 接口都需 `_signature` 签名（ByteDance acrawler.js），与抖音 X-Bogus 同
 * family，留给 v0.3 走 WebView JS hook 注入或 acrawler 端口。
 *
 * v0.2 output schema (与 packages/personal-data-hub/lib/adapters/social-toutiao
 * SNAPSHOT_SCHEMA_VERSION = 1 对齐)：
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "alice" },
 *     "events": [
 *       { "kind": "profile", "id": "profile-<uid>", "capturedAt": <ms>,
 *         "uid": "...", "nickname": "...", "avatarUrl": "...",
 *         "description": "...", "followingCount": N, "followerCount": N,
 *         "mediaId": "..." }
 *     ]
 *   }
 *
 * v0.2 fetchProfile 成功 → 1 profile event；失败 → events: []，但 account.uid
 * 仍持有。VM 在 sync 完后把 `everythingEmpty=true` 透出到 UI banner，提醒 v0.3
 * 会接通历史/收藏/搜索。
 *
 * Failure modes:
 *   - No credentials → [SnapshotResult.NoCredentials]
 *   - fetchProfile 失败 → snapshot still written but events empty，lastErrorCode
 *     从 apiClient 透出给 UI 提示重 login
 *   - staging dir 创建失败 / write 异常 → [SnapshotResult.Failed]
 */
@Singleton
class ToutiaoLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: ToutiaoApiClient,
    private val credentialsStore: ToutiaoCredentialsStore,
) {

    /**
     * v0.3 — optional signer for the v0.3 read/collection/search endpoints.
     * Default null = caller never wired a [ToutiaoSignBridge]; we degrade
     * gracefully to v0.2 profile-only (preserves v0.2 behavior). When non-null,
     * the collector warms the bridge once + calls fetchFeed/Collection/Search.
     */
    var signProvider: com.chainlesschain.android.pdh.social.SignProvider? = null

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val profileCount: Int,
            val readCount: Int,
            val collectionCount: Int,
            val searchCount: Int,
            val totalEvents: Int,
            val everythingEmpty: Boolean,
            val snapshottedAt: Long,
            val lastErrorCode: Int = 0,
            val lastErrorMessage: String? = null,
            /** True if v0.3 endpoints were attempted (signProvider was wired). */
            val v03Attempted: Boolean = false,
        ) : SnapshotResult()

        object NoCredentials : SnapshotResult()

        data class Failed(val reason: String) : SnapshotResult()
    }

    suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext SnapshotResult.NoCredentials
        }
        val cookie = credentialsStore.getCookie() ?: return@withContext SnapshotResult.NoCredentials
        val storedUid = credentialsStore.getUid() ?: return@withContext SnapshotResult.NoCredentials

        val profile = try {
            apiClient.fetchProfile(cookie)
        } catch (t: Throwable) {
            Timber.w(t, "ToutiaoLocalCollector: fetchProfile threw")
            null
        }

        // v0.3 — try to warm the sign bridge, then call the three signed
        // endpoints. Each is best-effort: a failure on one doesn't tank the
        // others. ApiClient handles _signature unavailable by returning
        // emptyList with lastErrorCode=-99 (short-circuit, no HTTP issued).
        val signer = signProvider
        apiClient.signProvider = signer ?: com.chainlesschain.android.pdh.social.NullSignProvider
        val v03Attempted = signer != null
        var feed: List<ToutiaoApiClient.FeedItem> = emptyList()
        var collection: List<ToutiaoApiClient.CollectionItem> = emptyList()
        var searches: List<ToutiaoApiClient.SearchItem> = emptyList()
        if (signer != null) {
            // Warm the bridge once — costs ~3-5s the first time, ~0ms subsequent.
            val warm = try {
                signer.warmUp(cookie)
            } catch (t: Throwable) {
                Timber.w(t, "ToutiaoLocalCollector: signProvider.warmUp threw")
                false
            }
            if (warm) {
                feed = safelyFetch("fetchFeed") { apiClient.fetchFeed(cookie) }
                collection = safelyFetch("fetchCollection") { apiClient.fetchCollection(cookie) }
                searches = safelyFetch("fetchSearchHistory") { apiClient.fetchSearchHistory(cookie) }
            } else {
                Timber.w("ToutiaoLocalCollector: signProvider.warmUp returned false — skipping v0.3 endpoints")
            }
        }

        val snapshottedAt = System.currentTimeMillis()
        val events = JSONArray()
        if (profile != null) {
            events.put(
                JSONObject()
                    .put("kind", "profile")
                    .put("id", "profile-" + profile.uid)
                    .put("capturedAt", snapshottedAt)
                    .put("uid", profile.uid)
                    .put("nickname", profile.nickname)
                    .putOpt("avatarUrl", profile.avatarUrl)
                    .putOpt("mobile", profile.mobile)
                    .putOpt("description", profile.description)
                    .put("followingCount", profile.followingCount)
                    .put("followerCount", profile.followerCount)
                    .putOpt("mediaId", profile.mediaId)
            )
        }
        // v0.3 — feed becomes KIND_READ events (consumed articles / dwelled).
        for (item in feed) {
            events.put(
                JSONObject()
                    .put("kind", "read")
                    .put("id", "read-" + item.itemId)
                    .put("capturedAt", item.publishedAt.takeIf { it > 0 } ?: snapshottedAt)
                    .put("itemId", item.itemId)
                    .put("title", item.title)
                    .putOpt("category", item.category)
                    .putOpt("author", item.author)
                    .put("readDuration", item.readDuration)
                    .putOpt("source", item.source),
            )
        }
        // v0.3 — saved articles → KIND_COLLECTION events.
        for (item in collection) {
            events.put(
                JSONObject()
                    .put("kind", "collection")
                    .put("id", "collect-" + item.itemId)
                    .put("capturedAt", item.savedAt.takeIf { it > 0 } ?: snapshottedAt)
                    .put("itemId", item.itemId)
                    .put("title", item.title)
                    .putOpt("category", item.category)
                    .putOpt("author", item.author),
            )
        }
        // v0.3 — recent searches → KIND_SEARCH events.
        for (item in searches) {
            events.put(
                JSONObject()
                    .put("kind", "search")
                    .put("id", "search-" + item.keyword + ":" + item.searchedAt)
                    .put("capturedAt", item.searchedAt.takeIf { it > 0 } ?: snapshottedAt)
                    .put("keyword", item.keyword)
                    .put("searchAt", item.searchedAt),
            )
        }
        val total = events.length()

        val root = JSONObject()
            .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            .put("snapshottedAt", snapshottedAt)
            .put(
                "account",
                JSONObject()
                    .put("uid", profile?.uid ?: storedUid)
                    .put("displayName", profile?.nickname ?: credentialsStore.getDisplayName() ?: ""),
            )
            .put("events", events)

        val stagingDir = File(context.filesDir, ".chainlesschain/staging")
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            return@withContext SnapshotResult.Failed(
                "failed to create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val snapshotFile = File(stagingDir, "social-toutiao.json")
        try {
            snapshotFile.writeText(root.toString(), Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "ToutiaoLocalCollector: snapshot write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }

        credentialsStore.recordSync(snapshottedAt, total)

        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            profileCount = if (profile != null) 1 else 0,
            readCount = feed.size,
            collectionCount = collection.size,
            searchCount = searches.size,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
            v03Attempted = v03Attempted,
        )
    }

    /**
     * 2026-05-26 — in-WebView prefetch 路径 (复刻 [BilibiliLocalCollector]/
     * [DouyinLocalCollector]/[XhsLocalCollector].ingestPrefetched)。
     */
    suspend fun ingestPrefetched(prefetchedJson: String): SnapshotResult = withContext(Dispatchers.IO) {
        val root = try {
            JSONObject(prefetchedJson)
        } catch (e: Exception) {
            Timber.w(e, "ToutiaoLocalCollector: prefetched JSON parse failed (len=%d)", prefetchedJson.length)
            return@withContext SnapshotResult.Failed("prefetched not JSON: ${e.message}")
        }
        val events = root.optJSONArray("events")
        val total = events?.length() ?: 0
        val snapshottedAt = root.optLong("snapshottedAt", System.currentTimeMillis())
        val stagingDir = File(context.filesDir, ".chainlesschain/staging")
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            return@withContext SnapshotResult.Failed(
                "failed to create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val snapshotFile = File(stagingDir, "social-toutiao.json")
        try {
            snapshotFile.writeText(prefetchedJson, Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "ToutiaoLocalCollector: prefetched write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }
        credentialsStore.recordSync(snapshottedAt, total)
        Timber.i("ToutiaoLocalCollector: ingested prefetched events=%d → %s",
            total, snapshotFile.absolutePath)
        root.optJSONArray("_debug")?.let { dbg ->
            for (i in 0 until dbg.length()) {
                val e = dbg.optJSONObject(i) ?: continue
                Timber.i(
                    "ToutiaoLocalCollector: prefetch[%d] engine=%s url=%s status=%s len=%d err=%s head=%s smoke=%s",
                    i,
                    e.optString("e", "?"),
                    e.optString("u"),
                    e.optString("s", "?"),
                    e.optInt("l", -1),
                    e.optString("err", ""),
                    e.optString("head", "").replace("\n", " ").take(500),
                    if (e.has("_smokeTest")) "uid=${e.optString("uid", "null")} nickname=${e.optString("nickname")} passportUidFromCookie=${e.optString("passportUidFromCookie")} cookieLen=${e.optInt("cookieLen")} hasAcrawler=${e.optBoolean("hasAcrawler")} loc=${e.optString("locHref")}" else "",
                )
            }
        }
        var profileCount = 0; var readCount = 0; var collectionCount = 0; var searchCount = 0
        if (events != null) for (i in 0 until events.length()) {
            when (events.optJSONObject(i)?.optString("kind")) {
                "profile" -> profileCount++
                "read" -> readCount++
                "collection" -> collectionCount++
                "search" -> searchCount++
            }
        }
        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            profileCount = profileCount,
            readCount = readCount,
            collectionCount = collectionCount,
            searchCount = searchCount,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = 0,
            lastErrorMessage = null,
            v03Attempted = false,
        )
    }

    /** Called by [HubLocalViewModel.onToutiaoLoginWithPrefetch] after cc sync ok. */
    fun recordSync(eventCount: Int) {
        credentialsStore.recordSync(System.currentTimeMillis(), eventCount)
    }

    private suspend fun <T> safelyFetch(label: String, block: suspend () -> List<T>): List<T> {
        return try {
            block()
        } catch (t: Throwable) {
            Timber.w(t, "ToutiaoLocalCollector: %s threw", label)
            emptyList()
        }
    }

    /**
     * WebView 把 cookie 抛回来后调本方法：抽 uid → 调 fetchProfile 拿 nickname
     * → 写 store。fetchProfile 失败也不阻断（cookie 可能限流但 uid 已抽到）；
     * displayName 用 fetchProfile 结果优先，否则用 caller 传的 displayName。
     *
     * 返 false = cookie 不含可识别 uid (登录未完成 / 仅游客态)，上层 surface 引导。
     */
    suspend fun acceptLoginCookie(cookie: String, displayName: String? = null): Boolean {
        val uid = apiClient.extractUid(cookie) ?: return false
        val profile = try {
            apiClient.fetchProfile(cookie)
        } catch (t: Throwable) {
            Timber.w(t, "ToutiaoLocalCollector.acceptLoginCookie: fetchProfile threw")
            null
        }
        credentialsStore.saveCredentials(
            cookie = cookie,
            uid = profile?.uid ?: uid,
            displayName = profile?.nickname ?: displayName,
        )
        return true
    }

    fun logout() {
        credentialsStore.clear()
    }

    val lastLoginErrorCode: Int get() = apiClient.lastErrorCode
    val lastLoginErrorMessage: String? get() = apiClient.lastErrorMessage

    companion object {
        /**
         * Must equal SNAPSHOT_SCHEMA_VERSION in social-toutiao/index.js.
         * Bump in lockstep — verify with grep across the two files.
         */
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
