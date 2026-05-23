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

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val profileCount: Int,
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
        val storedSecUid = credentialsStore.getSecUid() ?: return@withContext SnapshotResult.NoCredentials

        val profile = try {
            apiClient.fetchProfile(cookie)
        } catch (t: Throwable) {
            Timber.w(t, "DouyinLocalCollector: fetchProfile threw")
            null
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
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
        )
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
