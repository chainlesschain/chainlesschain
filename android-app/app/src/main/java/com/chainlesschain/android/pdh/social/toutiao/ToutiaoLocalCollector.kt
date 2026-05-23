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
 * v0.1 — Toutiao snapshot writer.
 *
 * **v0.1 仅持账号 + 写空 events 快照**：头条 web read 接口 (`/api/news/feed/v90/`
 * 推荐流、`/article/v2/tab_comments/` 收藏、`/api/search/content/` 搜索) 都需
 * `_signature` 签名（ByteDance acrawler.js），没有可靠的纯 Kotlin 实现，与
 * 抖音 X-Bogus 同 family。v0.2 走 WebView JS hook 注入或 acrawler 端口。
 *
 * v0.1 output schema (与 packages/personal-data-hub/lib/adapters/social-toutiao
 * SNAPSHOT_SCHEMA_VERSION = 1 对齐)：
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "alice" },
 *     "events": []      ← v0.1 始终 empty；v0.2 加 read/collection/search
 *   }
 *
 * 因 `events: []`，`cc hub sync social-toutiao` 返 ingested=0，但 account.uid
 * 被持有 → 既能让用户看到"我已登录头条"卡片，又不引入虚假数据。VM 在 sync
 * 完后把 `everythingEmpty=true` 透出到 UI banner，提醒 v0.2 会接通历史。
 *
 * Failure modes:
 *   - No credentials → [SnapshotResult.NoCredentials]
 *   - staging dir 创建失败 / write 异常 → [SnapshotResult.Failed]
 *   - everythingEmpty=true → v0.1 始终如此，**不**算 failure；UI 走 statusLine
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
        val uid = credentialsStore.getUid() ?: return@withContext SnapshotResult.NoCredentials
        val displayName = credentialsStore.getDisplayName()

        val snapshottedAt = System.currentTimeMillis()

        // v0.1: empty events array. v0.2 will push read/collection/search events here.
        val events = JSONArray()

        val root = JSONObject()
            .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            .put("snapshottedAt", snapshottedAt)
            .put(
                "account",
                JSONObject()
                    .put("uid", uid)
                    .put("displayName", displayName ?: ""),
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

        credentialsStore.recordSync(snapshottedAt, 0)

        SnapshotResult.Ok(
            snapshotPath = snapshotFile.absolutePath,
            totalEvents = 0,
            everythingEmpty = true,
            snapshottedAt = snapshottedAt,
        )
    }

    /**
     * WebView 把 cookie 抛回来后调本方法：抽 uid → 写 store。
     * 返 false = cookie 不含可识别 uid (登录未完成 / 仅游客态)，上层 surface 引导。
     */
    fun acceptLoginCookie(cookie: String, displayName: String? = null): Boolean {
        val uid = apiClient.extractUid(cookie) ?: return false
        credentialsStore.saveCredentials(cookie = cookie, uid = uid, displayName = displayName)
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
