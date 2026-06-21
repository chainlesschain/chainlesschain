package com.chainlesschain.android.pdh.social.douyin

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
 * §A8 v0.2 — orchestrates a single Douyin sync end-to-end (mirror of
 * WeiboLocalCollector but **with a tiny v0.2 surface — just profile info**):
 *
 *   1. Read cookie + sec_uid from [DouyinCredentialsStore]
 *   2. Call [DouyinApiClient.fetchProfile] (1 endpoint — no X-Bogus needed)
 *   3. Assemble a snapshot JSON matching social-douyin adapter's
 *      SNAPSHOT_SCHEMA_VERSION = 1 (see packages/personal-data-hub/lib/
 *      adapters/social-douyin/index.js _syncViaSnapshot)
 *   4. Write to filesDir/.chainlesschain/staging/social-douyin.json
 *   5. Return [SnapshotResult] so HubLocalViewModel can hand off path to
 *      LocalCcRunner.syncAdapter("social-douyin", path)
 *
 * v0.3 will add history / favourite / like kinds once the X-Bogus signature
 * path is wired (likely via WebView JS injection — Douyin signs every read
 * endpoint and there's no pure-Kotlin solution that survives mssdk.js
 * obfuscation rotation).
 *
 * Failure modes:
 *   - No credentials → [SnapshotResult.NoCredentials]
 *   - acceptLoginCookie 阶段 fetchProfile 返 null（cookie 不全或登录未完成）
 *   - fetchProfile 失败 → snapshot still written but everythingEmpty=true，
 *     UI 引导重 login
 */
@Singleton
class DouyinLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: DouyinApiClient,
    private val credentialsStore: DouyinCredentialsStore,
) {

    /**
     * v0.3 — optional signer for the v0.3 history/favourite/like endpoints.
     * Null = v0.2 fallback (profile only). Wired in HubLocalViewModel from
     * the DI graph (DouyinSignBridge).
     */
    var signProvider: com.chainlesschain.android.pdh.social.SignProvider? = null

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val profileCount: Int,
            val historyCount: Int,
            val favouriteCount: Int,
            val likeCount: Int,
            val totalEvents: Int,
            val everythingEmpty: Boolean,
            val snapshottedAt: Long,
            val lastErrorCode: Int = 0,
            val lastErrorMessage: String? = null,
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

        // fetchProfile needs no signing (no X-Bogus), so it works with just the
        // cookie — this is how we resolve secUid lazily when login couldn't
        // (Douyin's acrawler isn't loaded on the login page).
        val profile = try {
            apiClient.fetchProfile(cookie)
        } catch (t: Throwable) {
            Timber.w(t, "DouyinLocalCollector: fetchProfile threw")
            null
        }

        // Lazy secUid: prefer the stored one, else take it from fetchProfile and
        // backfill the store for next time. No usable secUid at all → not yet
        // authenticated (cookie stale / login incomplete).
        val storedSecUid = credentialsStore.getSecUid() ?: profile?.secUid
            ?: return@withContext SnapshotResult.NoCredentials
        if (credentialsStore.getSecUid() == null) {
            credentialsStore.setSecUid(storedSecUid)
            Timber.i("DouyinLocalCollector: backfilled secUid via fetchProfile (lazy login)")
        }

        // v0.3 — same template as Toutiao: optionally warm sign bridge,
        // best-effort call each endpoint. ApiClient short-circuits when
        // bridge returns null (lastErrorCode=-99, no HTTP issued).
        val signer = signProvider
        apiClient.signProvider = signer ?: com.chainlesschain.android.pdh.social.NullSignProvider
        val v03Attempted = signer != null
        var history: List<DouyinApiClient.HistoryItem> = emptyList()
        var favourites: List<DouyinApiClient.FavouriteItem> = emptyList()
        var likes: List<DouyinApiClient.LikeItem> = emptyList()
        if (signer != null) {
            val warm = try {
                signer.warmUp(cookie)
            } catch (t: Throwable) {
                Timber.w(t, "DouyinLocalCollector: signProvider.warmUp threw")
                false
            }
            if (warm) {
                history = safelyFetch("fetchHistory") { apiClient.fetchHistory(cookie) }
                favourites = safelyFetch("fetchFavourites") { apiClient.fetchFavourites(cookie) }
                likes = safelyFetch("fetchLikes") { apiClient.fetchLikes(cookie) }
            } else {
                Timber.w("DouyinLocalCollector: signProvider.warmUp returned false — skipping v0.3 endpoints")
            }
        }

        val snapshottedAt = System.currentTimeMillis()
        val events = JSONArray()
        if (profile != null) {
            events.put(
                JSONObject()
                    .put("kind", "profile")
                    .put("id", "profile-" + profile.secUid)
                    .put("capturedAt", snapshottedAt)
                    .put("secUid", profile.secUid)
                    .putOpt("shortId", profile.shortId)
                    .put("nickname", profile.nickname)
                    .putOpt("signature", profile.signature)
                    .put("followingCount", profile.followingCount)
                    .put("followerCount", profile.followerCount)
                    .put("awemeCount", profile.awemeCount)
                    .put("favoritingCount", profile.favoritingCount)
                    .put("totalFavorited", profile.totalFavorited)
            )
        }
        for (item in history) {
            events.put(
                JSONObject()
                    .put("kind", "history")
                    .put("id", "watch-" + item.awemeId)
                    .put("capturedAt", item.watchedAt.takeIf { it > 0 } ?: snapshottedAt)
                    .put("awemeId", item.awemeId)
                    .put("description", item.description)
                    .putOpt("authorSecUid", item.authorSecUid)
                    .putOpt("authorNickname", item.authorNickname)
                    .put("duration", item.duration),
            )
        }
        for (item in favourites) {
            events.put(
                JSONObject()
                    .put("kind", "favourite")
                    .put("id", "fav-" + item.awemeId)
                    .put("capturedAt", item.savedAt.takeIf { it > 0 } ?: snapshottedAt)
                    .put("awemeId", item.awemeId)
                    .put("description", item.description)
                    .putOpt("authorNickname", item.authorNickname),
            )
        }
        for (item in likes) {
            events.put(
                JSONObject()
                    .put("kind", "like")
                    .put("id", "like-" + item.awemeId)
                    .put("capturedAt", item.likedAt.takeIf { it > 0 } ?: snapshottedAt)
                    .put("awemeId", item.awemeId)
                    .put("description", item.description)
                    .putOpt("authorNickname", item.authorNickname),
            )
        }

        val total = events.length()

        val root = JSONObject()
            .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            .put("snapshottedAt", snapshottedAt)
            .put(
                "account",
                JSONObject()
                    .put("secUid", profile?.secUid ?: storedSecUid)
                    .putOpt("shortId", profile?.shortId ?: credentialsStore.getShortId())
                    .put("displayName", profile?.nickname ?: credentialsStore.getDisplayName() ?: ""),
            )
            .put("events", events)

        val stagingDir = File(context.filesDir, ".chainlesschain/staging")
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            return@withContext SnapshotResult.Failed(
                "failed to create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val snapshotFile = File(stagingDir, "social-douyin.json")
        try {
            snapshotFile.writeText(root.toString(), Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "DouyinLocalCollector: snapshot write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }

        credentialsStore.recordSync(snapshottedAt, total)

        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            profileCount = if (profile != null) 1 else 0,
            historyCount = history.size,
            favouriteCount = favourites.size,
            likeCount = likes.size,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
            v03Attempted = v03Attempted,
        )
    }

    /**
     * 2026-05-25 — in-WebView prefetch 路径 (复刻 [BilibiliLocalCollector.ingestPrefetched])。
     * [DouyinJsBridge.PREFETCH_JS] 在 www.douyin.com 登录 WebView 内 fetch profile +
     * history + favourite + like 后把 JSON 传上来。本方法直接落到 staging 路径，返
     * SnapshotResult.Ok 让 caller 走 cc CLI sync 入 vault — 跟普通 snapshot 同后半段。
     */
    suspend fun ingestPrefetched(prefetchedJson: String): SnapshotResult = withContext(Dispatchers.IO) {
        val root = try {
            JSONObject(prefetchedJson)
        } catch (e: Exception) {
            Timber.w(e, "DouyinLocalCollector: prefetched JSON parse failed (len=%d)", prefetchedJson.length)
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
        val snapshotFile = File(stagingDir, "social-douyin.json")
        try {
            snapshotFile.writeText(prefetchedJson, Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "DouyinLocalCollector: prefetched write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }
        // credentials store 由 HubLocalViewModel 在调本方法前先 saveCredentials
        // (从 prefetched JSON 拿 secUid/nickname) — 这里只 recordSync 时间戳
        credentialsStore.recordSync(snapshottedAt, total)
        Timber.i(
            "DouyinLocalCollector: ingested prefetched events=%d → %s",
            total, snapshotFile.absolutePath,
        )
        root.optJSONArray("_debug")?.let { dbg ->
            for (i in 0 until dbg.length()) {
                val e = dbg.optJSONObject(i) ?: continue
                Timber.i(
                    "DouyinLocalCollector: prefetch[%d] engine=%s url=%s status=%s len=%d err=%s head=%s smoke=%s",
                    i,
                    e.optString("e", "?"),
                    e.optString("u"),
                    e.optString("s", "?"),
                    e.optInt("l", -1),
                    e.optString("err", ""),
                    e.optString("head", "").replace("\n", " ").take(500),
                    if (e.has("_smokeTest")) "secUid=${e.optString("secUid", "null")} nickname=${e.optString("nickname")} cookieLen=${e.optInt("cookieLen")} hasAcrawler=${e.optBoolean("hasAcrawler")} loc=${e.optString("locHref")}" else "",
                )
            }
        }
        var profileCount = 0; var historyCount = 0; var favCount = 0; var likeCount = 0
        if (events != null) for (i in 0 until events.length()) {
            when (events.optJSONObject(i)?.optString("kind")) {
                "profile" -> profileCount++
                "history" -> historyCount++
                "favourite" -> favCount++
                "like" -> likeCount++
            }
        }
        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            profileCount = profileCount,
            historyCount = historyCount,
            favouriteCount = favCount,
            likeCount = likeCount,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = 0,
            lastErrorMessage = null,
            v03Attempted = false,
        )
    }

    /** Called by [HubLocalViewModel.onDouyinLoginWithPrefetch] after cc sync ok. */
    fun recordSync(eventCount: Int) {
        credentialsStore.recordSync(System.currentTimeMillis(), eventCount)
    }

    private suspend fun <T> safelyFetch(label: String, block: suspend () -> List<T>): List<T> {
        return try {
            block()
        } catch (t: Throwable) {
            Timber.w(t, "DouyinLocalCollector: %s threw", label)
            emptyList()
        }
    }

    /**
     * 与 Bilibili 不同：抖音 cookie 没有直接可读的稳定 UID 字段（uid_tt 是
     * 加密 hex，sec_user_id 不在 cookie 里只在 URL/API 里）。**必须** async
     * 调 /aweme/v1/passport/account/info/v2/ 拿 sec_user_id，存入 store。
     *
     * 返回 false = cookie 不全 / 登录未完成 / fetchProfile 失败 — caller
     * surface "登录未完成请重试" 引导。成功 → 写 store。
     */
    suspend fun acceptLoginCookie(cookie: String, displayName: String? = null): Boolean {
        val profile = apiClient.fetchProfile(cookie) ?: return false
        val shortIdFromCookie = DouyinApiClient.extractShortIdFromCookie(cookie)
        credentialsStore.saveCredentials(
            cookie = cookie,
            secUid = profile.secUid,
            shortId = profile.shortId ?: shortIdFromCookie,
            displayName = displayName ?: profile.nickname,
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
         * Must equal SNAPSHOT_SCHEMA_VERSION in social-douyin/index.js
         * _syncViaSnapshot. Bump in lockstep — verify with grep.
         */
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
