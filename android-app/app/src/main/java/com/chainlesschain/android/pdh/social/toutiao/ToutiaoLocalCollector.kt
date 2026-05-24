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
        val storedUid = credentialsStore.getUid() ?: return@withContext SnapshotResult.NoCredentials

        val profile = try {
            apiClient.fetchProfile(cookie)
        } catch (t: Throwable) {
            Timber.w(t, "ToutiaoLocalCollector: fetchProfile threw")
            null
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
            totalEvents = total,
            everythingEmpty = total == 0,
            snapshottedAt = snapshottedAt,
            lastErrorCode = apiClient.lastErrorCode,
            lastErrorMessage = apiClient.lastErrorMessage,
        )
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
