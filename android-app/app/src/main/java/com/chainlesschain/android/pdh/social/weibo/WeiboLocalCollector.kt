package com.chainlesschain.android.pdh.social.weibo

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
 * §A8 v0.2 — orchestrates a single Weibo sync end-to-end (mirror of
 * BilibiliLocalCollector):
 *
 *   1. Read cookie + uid from [WeiboCredentialsStore]
 *   2. Fan out to [WeiboApiClient]'s 3 fetchers (posts / favourites / follows)
 *      — sequential awaits (parallel triggers Weibo anti-bot "网络繁忙")
 *   3. Assemble a snapshot JSON matching social-weibo adapter's
 *      SNAPSHOT_SCHEMA_VERSION = 1 (see packages/personal-data-hub/lib/
 *      adapters/social-weibo/index.js _syncViaSnapshot)
 *   4. Write to filesDir/.chainlesschain/staging/social-weibo.json
 *   5. Return [SnapshotResult] so HubLocalViewModel can hand off path to
 *      LocalCcRunner.syncAdapter("social-weibo", path)
 *
 * Failure modes:
 *   - No credentials → [SnapshotResult.NoCredentials]
 *   - acceptLoginCookie 阶段 fetchUid 返 null（cookie 不全或登录未完成）
 *   - All 3 fetchers empty → snapshot still written, everythingEmpty=true
 *     用户引导重 login
 */
@Singleton
class WeiboLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: WeiboApiClient,
    private val credentialsStore: WeiboCredentialsStore,
) {

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val postCount: Int,
            val favouriteCount: Int,
            val followCount: Int,
            val totalEvents: Int,
            val everythingEmpty: Boolean,
            val snapshottedAt: Long,
            val lastErrorCode: Int = 0,
            val lastErrorMessage: String? = null,
        ) : SnapshotResult()

        object NoCredentials : SnapshotResult()

        data class Failed(val reason: String) : SnapshotResult()
    }

    suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext SnapshotResult.NoCredentials
        }
        val cookie = credentialsStore.getCookie() ?: return@withContext SnapshotResult.NoCredentials
        val uid = credentialsStore.getUid() ?: return@withContext SnapshotResult.NoCredentials

        val posts = try { apiClient.fetchPosts(cookie, uid) } catch (t: Throwable) {
            Timber.w(t, "WeiboLocalCollector: fetchPosts threw")
            emptyList()
        }
        val favourites = try { apiClient.fetchFavourites(cookie) } catch (t: Throwable) {
            Timber.w(t, "WeiboLocalCollector: fetchFavourites threw")
            emptyList()
        }
        val follows = try { apiClient.fetchFollows(cookie, uid) } catch (t: Throwable) {
            Timber.w(t, "WeiboLocalCollector: fetchFollows threw")
            emptyList()
        }

        val total = posts.size + favourites.size + follows.size
        val snapshottedAt = System.currentTimeMillis()

        val events = JSONArray()
        posts.forEach { p ->
            events.put(
                JSONObject()
                    .put("kind", "post")
                    .put("id", "post-" + p.mid)
                    .put("capturedAt", p.createdAt)
                    .put("text", p.text)
                    .put("mid", p.mid)
                    .putOpt("source", p.source)
                    .put("repostsCount", p.repostsCount)
                    .put("commentsCount", p.commentsCount)
                    .put("likesCount", p.likesCount)
                    .put("picCount", p.picCount)
            )
        }
        favourites.forEach { f ->
            events.put(
                JSONObject()
                    .put("kind", "favourite")
                    .put("id", "fav-" + f.mid)
                    .put("capturedAt", f.favAt)
                    .put("text", f.text)
                    .put("mid", f.mid)
                    .putOpt("authorScreenName", f.authorScreenName)
            )
        }
        follows.forEach { fl ->
            events.put(
                JSONObject()
                    .put("kind", "follow")
                    .put("id", "follow-" + fl.uid)
                    .put("capturedAt", fl.followedAt)
                    .put("uid", fl.uid)
                    .put("screenName", fl.screenName)
                    .putOpt("description", fl.description)
                    .putOpt("avatarUrl", fl.avatarUrl)
            )
        }

        val root = JSONObject()
            .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            .put("snapshottedAt", snapshottedAt)
            .put(
                "account",
                JSONObject()
                    .put("uid", uid.toString())
                    .put("displayName", credentialsStore.getDisplayName() ?: ""),
            )
            .put("events", events)

        val stagingDir = File(context.filesDir, ".chainlesschain/staging")
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            return@withContext SnapshotResult.Failed(
                "failed to create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val snapshotFile = File(stagingDir, "social-weibo.json")
        try {
            snapshotFile.writeText(root.toString(), Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "WeiboLocalCollector: snapshot write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }

        credentialsStore.recordSync(snapshottedAt, total)

        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            postCount = posts.size,
            favouriteCount = favourites.size,
            followCount = follows.size,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
        )
    }

    /**
     * 与 Bilibili 不同：weibo cookie 没有 UID 字段，需 async 调 /api/config 拿。
     * 返回 false = cookie 不全 / 登录未完成 / fetchUid 失败 — caller surface
     * "登录未完成请重试" 引导。成功 → 写 store。
     */
    suspend fun acceptLoginCookie(cookie: String, displayName: String? = null): Boolean {
        val uid = apiClient.fetchUid(cookie) ?: return false
        credentialsStore.saveCredentials(cookie, uid, displayName)
        return true
    }

    fun logout() {
        credentialsStore.clear()
    }

    companion object {
        /**
         * Must equal SNAPSHOT_SCHEMA_VERSION in social-weibo/index.js
         * _syncViaSnapshot. Bump in lockstep — verify with grep.
         */
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
