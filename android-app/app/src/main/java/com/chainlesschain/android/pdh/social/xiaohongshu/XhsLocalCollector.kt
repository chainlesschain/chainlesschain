package com.chainlesschain.android.pdh.social.xiaohongshu

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
 * §A8 v0.2 — orchestrates a single Xiaohongshu sync end-to-end (mirror of
 * WeiboLocalCollector + BilibiliLocalCollector):
 *
 *   1. Read cookie + a1 + user_id_str from [XhsCredentialsStore]
 *   2. Fan out to [XhsApiClient]'s 3 fetchers (notes / liked / follows)
 *      — sequential awaits (parallel triggers xhs anti-bot 461 short-band)
 *   3. Assemble snapshot JSON matching social-xiaohongshu adapter's
 *      SNAPSHOT_SCHEMA_VERSION = 1 (see packages/personal-data-hub/lib/
 *      adapters/social-xiaohongshu/index.js _syncViaSnapshot)
 *   4. Write to filesDir/.chainlesschain/staging/social-xiaohongshu.json
 *   5. Return [SnapshotResult] so HubLocalViewModel hands path to
 *      LocalCcRunner.syncAdapter("social-xiaohongshu", path)
 *
 * 与 Weibo 差异:
 *  - acceptLoginCookie 不仅调 /api/config 等价 (xhs 是 /api/sns/web/v1/user/me)
 *    拿 user_id+nickname，还需从同一 cookie 解析 a1 字段单独存 (X-S 签名要用)。
 *  - everythingEmpty 路径要 surface 一个特殊错误 detail: X-S 签名失败 (-461)
 *    很可能 = 算法 v0.2 approximation 命中失败，引导用户 v0.3 follow-up。
 */
@Singleton
class XhsLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: XhsApiClient,
    private val credentialsStore: XhsCredentialsStore,
) {

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val noteCount: Int,
            val likedCount: Int,
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
        val a1 = credentialsStore.getA1() ?: return@withContext SnapshotResult.NoCredentials
        val userId = credentialsStore.getUserIdStr() ?: return@withContext SnapshotResult.NoCredentials
        val numericUid = credentialsStore.getUid() ?: return@withContext SnapshotResult.NoCredentials

        val notes = try { apiClient.fetchNotes(cookie, a1, userId) } catch (t: Throwable) {
            Timber.w(t, "XhsLocalCollector: fetchNotes threw")
            emptyList()
        }
        val liked = try { apiClient.fetchLiked(cookie, a1) } catch (t: Throwable) {
            Timber.w(t, "XhsLocalCollector: fetchLiked threw")
            emptyList()
        }
        val follows = try { apiClient.fetchFollows(cookie, a1, userId) } catch (t: Throwable) {
            Timber.w(t, "XhsLocalCollector: fetchFollows threw")
            emptyList()
        }

        val total = notes.size + liked.size + follows.size
        val snapshottedAt = System.currentTimeMillis()

        val events = JSONArray()
        notes.forEach { n ->
            events.put(
                JSONObject()
                    .put("kind", "note")
                    .put("id", "note-" + n.noteId)
                    .put("capturedAt", n.createdAt)
                    .put("title", n.title)
                    .put("noteId", n.noteId)
                    .putOpt("desc", n.desc)
                    .put("type", n.type)
                    .put("likedCount", n.likedCount)
                    .put("collectedCount", n.collectedCount)
                    .put("commentCount", n.commentCount),
            )
        }
        liked.forEach { l ->
            events.put(
                JSONObject()
                    .put("kind", "liked")
                    .put("id", "liked-" + l.noteId)
                    .put("capturedAt", l.likedAt)
                    .put("title", l.title)
                    .put("noteId", l.noteId)
                    .putOpt("authorNickname", l.authorNickname),
            )
        }
        follows.forEach { f ->
            events.put(
                JSONObject()
                    .put("kind", "follow")
                    .put("id", "follow-" + f.userId)
                    .put("capturedAt", f.followedAt)
                    .put("userId", f.userId)
                    .put("nickname", f.nickname)
                    .putOpt("image", f.image),
            )
        }

        val root = JSONObject()
            .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            .put("snapshottedAt", snapshottedAt)
            .put(
                "account",
                JSONObject()
                    .put("uid", userId) // 真 user_id string
                    .put("numericUid", numericUid.toString())
                    .put("displayName", credentialsStore.getDisplayName() ?: ""),
            )
            .put("events", events)

        val stagingDir = File(context.filesDir, ".chainlesschain/staging")
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            return@withContext SnapshotResult.Failed(
                "failed to create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val snapshotFile = File(stagingDir, "social-xiaohongshu.json")
        try {
            snapshotFile.writeText(root.toString(), Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "XhsLocalCollector: snapshot write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }

        credentialsStore.recordSync(snapshottedAt, total)

        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            noteCount = notes.size,
            likedCount = liked.size,
            followCount = follows.size,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
        )
    }

    /**
     * 与 Weibo 同：suspend (因为 fetchMe 是 HTTP 调用)。但又比 Weibo 多解 a1
     * cookie 字段单独存。返 false = cookie 不全 (缺 a1) / fetchMe 失败 / login
     * 未完成 — caller surface 引导。成功 → 写 store (cookie/uid/userIdStr/a1)。
     */
    suspend fun acceptLoginCookie(cookie: String, displayName: String? = null): Boolean {
        val a1 = XhsApiClient.extractA1(cookie) ?: return false
        val me = apiClient.fetchMe(cookie) ?: return false
        credentialsStore.saveCredentials(
            cookie = cookie,
            uid = me.numericUid,
            userIdStr = me.userId,
            a1 = a1,
            displayName = displayName ?: me.nickname,
        )
        return true
    }

    fun logout() {
        credentialsStore.clear()
    }

    companion object {
        /**
         * Must equal SNAPSHOT_SCHEMA_VERSION in social-xiaohongshu/index.js
         * _syncViaSnapshot. Bump in lockstep — verify with grep.
         */
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
