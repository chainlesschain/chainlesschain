package com.chainlesschain.android.pdh.social.kuaishou

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
 * §A8 v0.2 — Kuaishou snapshot writer.
 *
 * **v0.2 surface**: cookie + profile parse (`kuaishou.web.cp.api_ph` cookie
 * 字段的 URL-encoded JSON，含 user_name/headurl/kuaishou_id/sex/city/...）。
 * 无网络调用，因快手 GraphQL 全需 NS_sig3 签名。与 Toutiao 不同（Toutiao 走
 * ByteDance unsigned passport endpoint），但 v0.2 用户体感一致：登录后能看
 * 到自己的昵称头像。
 *
 * v0.3+ 走 NS_sig3 接通 GraphQL 拿 watch/collect/search/动态计数。
 *
 * v0.2 output schema (与 packages/personal-data-hub/lib/adapters/
 * social-kuaishou SNAPSHOT_SCHEMA_VERSION = 1 对齐)：
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "alice" },
 *     "events": [
 *       { "kind": "profile", "id": "profile-<uid>", "capturedAt": <ms>,
 *         "uid": "...", "nickname": "...", "kuaishouId": "...",
 *         "avatarUrl": "...", "sex": "...", "city": "...",
 *         "constellation": "...", "description": "..." }
 *     ]
 *   }
 *
 * v0.2 fetchProfile 成功 → 1 profile event；失败（cookie 无 api_ph 字段）→
 * events: []，但 account.uid 仍持有。VM 透 everythingEmpty=true 给 UI。
 *
 * 与 Toutiao v0.2 几乎完全对称（同 dual-mode JS adapter，同 KIND_PROFILE
 * 策略），仅 fetchProfile 路径不同（cookie-parse vs HTTP passport）。
 */
@Singleton
class KuaishouLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: KuaishouApiClient,
    private val credentialsStore: KuaishouCredentialsStore,
) {

    /** v0.3 — optional signer for the v0.3 GraphQL endpoints. */
    var signProvider: com.chainlesschain.android.pdh.social.SignProvider? = null

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val profileCount: Int,
            val watchCount: Int,
            val collectCount: Int,
            val searchCount: Int,
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
        val storedUid = credentialsStore.getUid() ?: return@withContext SnapshotResult.NoCredentials

        val profile = try {
            apiClient.fetchProfile(cookie)
        } catch (t: Throwable) {
            Timber.w(t, "KuaishouLocalCollector: fetchProfile threw")
            null
        }
        val resolvedUid = profile?.uid ?: storedUid

        // v0.3 — wire signer + fan out to 3 GraphQL endpoints, same template
        // as Douyin / Toutiao. signer null = v0.2 fallback.
        val signer = signProvider
        apiClient.signProvider = signer ?: com.chainlesschain.android.pdh.social.NullSignProvider
        val v03Attempted = signer != null
        var watches: List<KuaishouApiClient.WatchItem> = emptyList()
        var profilePhotos: List<KuaishouApiClient.ProfilePhotoItem> = emptyList()
        var searches: List<KuaishouApiClient.SearchItem> = emptyList()
        if (signer != null) {
            val warm = try {
                signer.warmUp(cookie)
            } catch (t: Throwable) {
                Timber.w(t, "KuaishouLocalCollector: signProvider.warmUp threw")
                false
            }
            if (warm) {
                watches = safelyFetch("fetchWatchHistory") { apiClient.fetchWatchHistory(cookie) }
                profilePhotos = safelyFetch("fetchProfilePhotos") {
                    apiClient.fetchProfilePhotos(cookie, resolvedUid)
                }
                searches = safelyFetch("fetchSearchHistory") { apiClient.fetchSearchHistory(cookie) }
            } else {
                Timber.w("KuaishouLocalCollector: signProvider.warmUp returned false — skipping v0.3 endpoints")
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
                    .putOpt("kuaishouId", profile.kuaishouId)
                    .putOpt("avatarUrl", profile.avatarUrl)
                    .putOpt("sex", profile.sex)
                    .putOpt("city", profile.city)
                    .putOpt("constellation", profile.constellation)
                    .putOpt("description", profile.description)
            )
        }
        for (item in watches) {
            events.put(
                JSONObject()
                    .put("kind", "watch")
                    .put("id", "watch-" + item.photoId)
                    .put("capturedAt", item.viewedAt.takeIf { it > 0 } ?: snapshottedAt)
                    .put("photoId", item.photoId)
                    .put("caption", item.caption)
                    .putOpt("authorName", item.authorName)
                    .putOpt("authorId", item.authorId)
                    .put("duration", item.duration),
            )
        }
        for (item in profilePhotos) {
            events.put(
                JSONObject()
                    .put("kind", "collect")
                    .put("id", "collect-" + item.photoId)
                    .put("capturedAt", item.postedAt.takeIf { it > 0 } ?: snapshottedAt)
                    .put("photoId", item.photoId)
                    .put("caption", item.caption),
            )
        }
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
        val snapshotFile = File(stagingDir, "social-kuaishou.json")
        try {
            snapshotFile.writeText(root.toString(), Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "KuaishouLocalCollector: snapshot write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }

        credentialsStore.recordSync(snapshottedAt, total)

        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            profileCount = if (profile != null) 1 else 0,
            watchCount = watches.size,
            collectCount = profilePhotos.size,
            searchCount = searches.size,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
            v03Attempted = v03Attempted,
        )
    }

    private suspend fun <T> safelyFetch(label: String, block: suspend () -> List<T>): List<T> {
        return try {
            block()
        } catch (t: Throwable) {
            Timber.w(t, "KuaishouLocalCollector: %s threw", label)
            emptyList()
        }
    }

    /**
     * WebView 把 cookie 抛回来后调本方法：抽 uid → 调 fetchProfile 拿
     * nickname/avatar → 写 store。fetchProfile 失败（cookie 无 api_ph）也不
     * 阻断（uid 仍可用），displayName 字段保持空，由 caller 引导 v0.3 接通后
     * 用 GraphQL 拿。
     *
     * 返 false = cookie 不含可识别 uid (登录未完成 / 仅游客态)，上层 surface 引导。
     */
    suspend fun acceptLoginCookie(cookie: String, displayName: String? = null): Boolean {
        val uid = apiClient.extractUid(cookie) ?: return false
        val profile = try {
            apiClient.fetchProfile(cookie)
        } catch (t: Throwable) {
            Timber.w(t, "KuaishouLocalCollector.acceptLoginCookie: fetchProfile threw")
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
         * Must equal SNAPSHOT_SCHEMA_VERSION in social-kuaishou/index.js.
         * Bump in lockstep — verify with grep across the two files.
         */
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
