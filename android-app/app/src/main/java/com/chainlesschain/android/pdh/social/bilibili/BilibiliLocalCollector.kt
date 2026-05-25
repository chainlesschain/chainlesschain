package com.chainlesschain.android.pdh.social.bilibili

import android.content.Context
import com.chainlesschain.android.pdh.social.SocialCookieWebViewHelpers
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
            // Real-device 2026-05-22: 4 of 4 returned empty after a successful
            // login. The catch-all "cookie 可能过期" UI hides what Bilibili
            // actually said (-412 anti-spider vs -101 not logged in vs missing
            // UA → empty body). Propagate the last error so the VM can show
            // an actionable message.
            val lastErrorCode: Int = 0,
            val lastErrorMessage: String? = null,
        ) : SnapshotResult()

        object NoCredentials : SnapshotResult()

        data class Failed(val reason: String) : SnapshotResult()

        /**
         * Real-device 2026-05-24: a cookie saved before 2c8f41f9 (no
         * AcceptResult validation) silently passes hasCredentials() but
         * misses buvid3 / bili_jct, causing every sync to return "4 API
         * empty + 无错误码 + 可能 cookie 缺关键字段" forever — the message is
         * literally correct but the store doesn't self-heal so the user
         * stays stuck. Re-validating the stored cookie at snapshot entry
         * (and at VM refresh) demotes the persistent state to a one-shot
         * error: store is cleared, isLoggedIn flips false, UI prompts
         * re-login. [missingFields] is the comma-joined list for display.
         */
        data class StaleCookie(val missingFields: String) : SnapshotResult()
    }

    suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
        // Re-validate stored cookie against REQUIRED_FIELDS before reading
        // from store. acceptLoginCookie gates the WRITE path since 2c8f41f9
        // but pre-fix installs can have cookies missing buvid3 / bili_jct
        // sitting in EncryptedSharedPreferences, silently passing
        // hasCredentials() (which only checks string non-blank + uid > 0)
        // and tripping "4 API empty" on every sync — see SnapshotResult.
        // StaleCookie. clearIfStoredCookieStale wipes the store as a side
        // effect so the next call routes to NoCredentials cleanly.
        clearIfStoredCookieStale()?.let { missing ->
            return@withContext SnapshotResult.StaleCookie(missing)
        }
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
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
        )
    }

    /**
     * 2026-05-25: in-WebView prefetch 路径 — [BilibiliJsBridge.PREFETCH_JS] 在登录用
     * 的 WebView 内并发 fetch 4 API 后把跟 [snapshot] 完全同 shape 的 JSON 字符串
     * 传上来。本方法把它直接落到 staging 路径，返 SnapshotResult.Ok 让 caller 走
     * cc CLI sync 入 vault — 跟普通 snapshot 同后半段。
     *
     * 绕过 b 站 OkHttp 端 TLS 指纹 + JS-set anti-bot cookie 风控 — WebView 是真
     * Chrome，b 站不能拒。详 [BilibiliJsBridge] KDoc。
     */
    suspend fun ingestPrefetched(prefetchedJson: String): SnapshotResult = withContext(Dispatchers.IO) {
        val root = try {
            JSONObject(prefetchedJson)
        } catch (e: Exception) {
            Timber.w(e, "BilibiliLocalCollector: prefetched JSON parse failed (len=%d)", prefetchedJson.length)
            return@withContext SnapshotResult.Failed("prefetched not JSON: ${e.message}")
        }
        val events = root.optJSONArray("events")
        val total = events?.length() ?: 0
        val snapshottedAt = root.optLong("snapshottedAt", System.currentTimeMillis())
        val stagingDir = File(context.filesDir, ".chainlesschain/staging")
        if (!stagingDir.exists() && !stagingDir.mkdirs()) {
            return@withContext SnapshotResult.Failed(
                "failed to create staging dir at ${stagingDir.absolutePath}"
            )
        }
        val snapshotFile = File(stagingDir, "social-bilibili.json")
        try {
            snapshotFile.writeText(prefetchedJson, Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "BilibiliLocalCollector: prefetched write failed")
            return@withContext SnapshotResult.Failed("write failed: ${t.message}")
        }
        credentialsStore.recordSync(snapshottedAt, total)
        Timber.i(
            "BilibiliLocalCollector: ingested prefetched events=%d → %s",
            total, snapshotFile.absolutePath,
        )
        // v2 诊断：JS 端 fetch 逐条 status/err dump — events=0 但 cookie/UID 都有
        // 时锁定 CORS / HTTP 401 / 风控空响应
        root.optJSONArray("_debug")?.let { dbg ->
            for (i in 0 until dbg.length()) {
                val e = dbg.optJSONObject(i) ?: continue
                Timber.i(
                    "BilibiliLocalCollector: prefetch[%d] engine=%s url=%s status=%s len=%d err=%s head=%s smoke=%s",
                    i,
                    e.optString("e", "?"),
                    e.optString("u"),
                    e.optString("s", "?"),
                    e.optInt("l", -1),
                    e.optString("err", ""),
                    e.optString("head", "").replace("\n", " ").take(50),
                    if (e.has("_smokeTest")) "isLogin=${e.optBoolean("isLogin")} code=${e.opt("code")} cookieLen=${e.optInt("cookieLen")} loc=${e.optString("locHref")}" else "",
                )
            }
        }
        // 各 kind 计数（per-kind 字段保持 sane defaults — UI 不依赖单独 kind）
        var historyCount = 0; var favCount = 0; var dynCount = 0; var followCount = 0
        if (events != null) for (i in 0 until events.length()) {
            when (events.optJSONObject(i)?.optString("kind")) {
                "history" -> historyCount++
                "favourite" -> favCount++
                "dynamic" -> dynCount++
                "follow" -> followCount++
            }
        }
        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            historyCount = historyCount,
            favouriteCount = favCount,
            dynamicCount = dynCount,
            followCount = followCount,
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = 0,
            lastErrorMessage = null,
        )
    }

    /** Called by [HubLocalViewModel.onBilibiliLoginWithPrefetch] after cc sync ok. */
    fun recordSync(eventCount: Int) {
        credentialsStore.recordSync(System.currentTimeMillis(), eventCount)
    }

    /** Result of feeding a WebView-captured cookie into the collector. */
    sealed class AcceptResult {
        /** Cookie has all required fields and was persisted. */
        object Ok : AcceptResult()

        /**
         * Cookie was accepted by the WebView but is missing fields the
         * Bilibili web API needs to return real data. [name] is the
         * comma-separated list of missing keys for UI display.
         *
         * Real-device 2026-05-23: buvid3 + bili_jct are set by post-onload
         * JS — onPageFinished could race the grab and produce a cookie that
         * looks fine (passes DedeUserID parse) but has none of the
         * anti-spider keys, leading to silent empty API responses later.
         */
        data class MissingField(val name: String) : AcceptResult()
    }

    /**
     * Called by the UI when the WebView completes login. Validates the
     * cookie has all 4 required fields, parses UID from DedeUserID, and
     * persists. Returns [AcceptResult.MissingField] (with the missing key
     * names) when validation fails so the VM can prompt the user
     * actionably instead of silently storing a bad cookie that later trips
     * "4 API empty" on sync.
     */
    fun acceptLoginCookie(cookie: String, displayName: String? = null): AcceptResult {
        val uid = apiClient.extractUid(cookie)
            ?: return AcceptResult.MissingField("DedeUserID")
        val missing = REQUIRED_FIELDS.filter {
            SocialCookieWebViewHelpers.parseCookieValue(cookie, it).isNullOrBlank()
        }
        if (missing.isNotEmpty()) {
            return AcceptResult.MissingField(missing.joinToString(", "))
        }
        credentialsStore.saveCredentials(cookie, uid, displayName)
        return AcceptResult.Ok
    }

    fun logout() {
        credentialsStore.clear()
    }

    /**
     * If a stored cookie is present but missing any [REQUIRED_FIELDS],
     * clears the store and returns the comma-joined missing field names.
     * Returns null when there are no credentials, the cookie is missing
     * entirely, or all 4 fields are present.
     *
     * Shared by [snapshot] entry AND HubLocalViewModel.refreshBilibiliFromStore
     * so both paths self-heal in lockstep — without this, a pre-2c8f41f9
     * cookie ages indefinitely in EncryptedSharedPreferences, passing the
     * naive `hasCredentials()` check and tripping "4 API empty" on every
     * sync until the user manually taps logout (which the UI didn't
     * surface as the right action). See SnapshotResult.StaleCookie KDoc.
     */
    fun clearIfStoredCookieStale(): String? {
        if (!credentialsStore.hasCredentials()) return null
        val cookie = credentialsStore.getCookie() ?: return null
        val missing = REQUIRED_FIELDS.filter {
            SocialCookieWebViewHelpers.parseCookieValue(cookie, it).isNullOrBlank()
        }
        if (missing.isEmpty()) return null
        Timber.w(
            "BilibiliLocalCollector: stored cookie stale — missing=%s; clearing store",
            missing,
        )
        credentialsStore.clear()
        return missing.joinToString(", ")
    }

    companion object {
        // Must equal SNAPSHOT_SCHEMA_VERSION in social-bilibili/adapter.js.
        // If we bump JS we MUST bump this in lockstep — verify with grep.
        const val SNAPSHOT_SCHEMA_VERSION = 1

        // 4 fields the Bilibili web API needs to return real (non-empty)
        // data. SESSDATA = session token; DedeUserID = UID; bili_jct = CSRF
        // token; buvid3 = device fingerprint (set by post-onload JS — see
        // SocialCookieWebViewScreen's COOKIE_CAPTURE_DELAY_MS). Missing any
        // of these causes silent empty responses, not error codes.
        private val REQUIRED_FIELDS = listOf("SESSDATA", "DedeUserID", "bili_jct", "buvid3")
    }
}
