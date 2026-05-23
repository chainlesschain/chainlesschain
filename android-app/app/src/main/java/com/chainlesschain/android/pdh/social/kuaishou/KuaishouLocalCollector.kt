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
 * v0.1 — Kuaishou snapshot writer.
 *
 * **v0.1 仅持账号 + 写空 events 快照**：快手 web read 接口（`/graphql`
 * visionFeedRecommend / visionProfilePhotoList / visionSearchPhoto）都需
 * `NS_sig3` 签名（快手 anti-bot SDK），没有可靠的纯 Kotlin 实现，比抖音
 * X-Bogus / 头条 _signature 更复杂（multi-stage hash chain）。v0.2 走
 * WebView JS hook 注入或者 NS_sig3 端口。
 *
 * v0.1 output schema (与 packages/personal-data-hub/lib/adapters/
 * social-kuaishou SNAPSHOT_SCHEMA_VERSION = 1 对齐)：
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "account": { "uid": "12345", "displayName": "alice" },
 *     "events": []      ← v0.1 始终 empty；v0.2 加 watch/collect/search
 *   }
 *
 * 因 events=[]，`cc hub sync social-kuaishou` 返 ingested=0，但 account.uid
 * 被持有 → 既能让用户看到"我已登录快手"卡片，又不引入虚假数据。
 *
 * 与 Toutiao v0.1 完全对称（同 dual-mode JS adapter，同空-events 策略）。
 */
@Singleton
class KuaishouLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiClient: KuaishouApiClient,
    private val credentialsStore: KuaishouCredentialsStore,
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

        // v0.1: empty events array. v0.2 will push watch/collect/search events here.
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
        val snapshotFile = File(stagingDir, "social-kuaishou.json")
        try {
            snapshotFile.writeText(root.toString(), Charsets.UTF_8)
        } catch (t: Throwable) {
            Timber.e(t, "KuaishouLocalCollector: snapshot write failed")
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
         * Must equal SNAPSHOT_SCHEMA_VERSION in social-kuaishou/index.js.
         * Bump in lockstep — verify with grep across the two files.
         */
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
