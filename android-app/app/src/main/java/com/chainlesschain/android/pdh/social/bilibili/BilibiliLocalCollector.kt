package com.chainlesschain.android.pdh.social.bilibili

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
 * A8 v0.1 — orchestrates a single Bilibili sync end-to-end:
 *
 *   1. Read cookie + uid from [BilibiliCredentialsStore]
 *   2. Fan out to [BilibiliApiClient]'s 4 fetchers in parallel-ish order
 *      (sequential awaits — paralleling here risks tripping Bilibili's
 *      anti-bot rate limiter)
 *   3. Assemble a snapshot JSON matching the social-bilibili adapter's
 *      SNAPSHOT_SCHEMA_VERSION = 1 (see packages/personal-data-hub/lib/
 *      adapters/social-bilibili/adapter.js)
 *   4. Write to filesDir/.chainlesschain/staging/social-bilibili.json
 *   5. Return [SnapshotResult] so the caller (HubLocalViewModel) can hand
 *      the path to LocalCcRunner.syncAdapter("social-bilibili", path)
 *
 * Failure modes:
 *   - No credentials → [SnapshotResult.NoCredentials]; caller must launch
 *     SocialCookieWebViewScreen
 *   - All 4 fetchers return empty → we still write the snapshot but mark
 *     `everythingEmpty = true`; surfaces "cookie expired? try re-login"
 *   - Snapshot file write failed → [SnapshotResult.Failed]
 */
@Singleton
class BilibiliLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: BilibiliApiClient,
    private val credentialsStore: BilibiliCredentialsStore,
) {

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val historyCount: Int,
            val favouriteCount: Int,
            val dynamicCount: Int,
            val followCount: Int,
            val totalEvents: Int,
            val everythingEmpty: Boolean,
            val snapshottedAt: Long,
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

        val history = try { apiClient.fetchHistory(cookie) } catch (t: Throwable) {
            Timber.w(t, "BilibiliLocalCollector: fetchHistory threw")
            emptyList()
        }
        val favourites = try { apiClient.fetchFavourites(cookie, uid) } catch (t: Throwable) {
            Timber.w(t, "BilibiliLocalCollector: fetchFavourites threw")
            emptyList()
        }
        val dynamics = try { apiClient.fetchDynamics(cookie) } catch (t: Throwable) {
            Timber.w(t, "BilibiliLocalCollector: fetchDynamics threw")
            emptyList()
        }
        val follows = try { apiClient.fetchFollows(cookie, uid) } catch (t: Throwable) {
            Timber.w(t, "BilibiliLocalCollector: fetchFollows threw")
            emptyList()
        }

        val total = history.size + favourites.size + dynamics.size + follows.size
        val snapshottedAt = System.currentTimeMillis()

        val events = JSONArray()
        history.forEach { h ->
            events.put(
                JSONObject()
                    .put("kind", "history")
                    .put("id", h.bvid ?: ("avid-" + (h.avid ?: 0)))
                    .put("capturedAt", h.viewAt * 1000)
                    .put("title", h.title)
                    .putOpt("bvid", h.bvid)
                    .putOpt("avid", h.avid)
                    .putOpt("duration", h.duration)
                    .putOpt("uploader", h.uploader)
                    .putOpt("uploaderMid", h.uploaderMid)
                    .putOpt("part", h.part)
            )
        }
        favourites.forEach { f ->
            events.put(
                JSONObject()
                    .put("kind", "favourite")
                    .put("id", "fav-" + (f.bvid ?: f.title))
                    .put("capturedAt", f.savedAt)
                    .put("title", f.title)
                    .putOpt("bvid", f.bvid)
                    .putOpt("folderName", f.folderName)
                    .putOpt("uploader", f.uploader)
            )
        }
        dynamics.forEach { d ->
            events.put(
                JSONObject()
                    .put("kind", "dynamic")
                    .put("id", "dyn-" + (d.rid ?: System.nanoTime().toString()))
                    .put("capturedAt", d.publishedAt)
                    .put("summary", d.summary)
                    .put("dynamicType", d.dynamicType)
                    .putOpt("rid", d.rid)
                    .putOpt("authorMid", d.authorMid)
                    .putOpt("authorName", d.authorName)
            )
        }
        follows.forEach { fl ->
            events.put(
                JSONObject()
                    .put("kind", "follow")
                    .put("id", "follow-" + fl.mid)
                    .put("capturedAt", fl.followedAt)
                    .put("mid", fl.mid)
                    .put("uname", fl.uname)
                    .putOpt("face", fl.face)
                    .putOpt("sign", fl.sign)
            )
        }

        val root = JSONObject()
            .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            .put("snapshottedAt", snapshottedAt)
            .put("account", JSONObject().put("uid", uid.toString()).put("displayName", credentialsStore.getDisplayName() ?: ""))
            .put("events", events)

        val stagingDir = File(context.filesDir, ".chainlesschain/staging")
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            return@withContext SnapshotResult.Failed(
                "failed to create staging dir at ${stagingDir.absolutePath}"
            )
        }
        val snapshotFile = File(stagingDir, "social-bilibili.json")
        try {
            snapshotFile.writeText(root.toString(), Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "BilibiliLocalCollector: snapshot write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }

        credentialsStore.recordSync(snapshottedAt, total)

        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            historyCount = history.size,
            favouriteCount = favourites.size,
            dynamicCount = dynamics.size,
            followCount = follows.size,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
        )
    }

    /**
     * Called by the UI when the WebView completes login. Parses UID from
     * cookie's DedeUserID field and persists. Returns false if the cookie
     * lacks DedeUserID (login likely incomplete — captcha bounced, etc.).
     */
    fun acceptLoginCookie(cookie: String, displayName: String? = null): Boolean {
        val uid = apiClient.extractUid(cookie) ?: return false
        credentialsStore.saveCredentials(cookie, uid, displayName)
        return true
    }

    fun logout() {
        credentialsStore.clear()
    }

    companion object {
        // Must equal SNAPSHOT_SCHEMA_VERSION in social-bilibili/adapter.js.
        // If we bump JS we MUST bump this in lockstep — verify with grep.
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
