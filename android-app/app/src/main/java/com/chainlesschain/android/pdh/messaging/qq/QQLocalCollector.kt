package com.chainlesschain.android.pdh.messaging.qq

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 13.5 v0.2 — orchestrates a single QQ sync end-to-end on Android.
 *
 * Pipeline (mirrors [com.chainlesschain.android.pdh.social.wechat.WeChatLocalCollector]
 * but **simpler** — no frida step):
 *
 *   1. Read uin + imei from [QQCredentialsStore]
 *   2. (No frida step — IMEI is the only "key", already in store)
 *   3. [QQDbExtractor.extract] → staging JSON file on disk
 *   4. Return [SnapshotResult] so the caller (HubLocalViewModel) can hand
 *      the path to `LocalCcRunner.syncAdapter("messaging-qq", path)`
 *
 * **STATUS**: Phase 13.5 v0.2 — orchestrator + DbExtractor are real impl.
 * Real-device E2E is Phase 13.5.6 (needs root QQ device). On Win dev box
 * the suExec / openDatabase paths return NoRoot / SourceDbMissing
 * naturally (no su binary, no QQ DB).
 *
 * Failure modes (sealed result so HubLocalViewModel can pattern-match on
 * each and surface a distinct banner):
 *   - [SnapshotResult.NoCredentials] — user hasn't entered uin/imei yet;
 *     UI launches the QQ login dialog
 *   - [SnapshotResult.NoRoot] — device not rooted; UI shows "改用桌面端"
 *     banner with a deep-link to the desktop quickstart (similar to
 *     WeChat 12.10's no-root path)
 *   - [SnapshotResult.ExtractFailed] — DB copy / open / dump failed
 *   - [SnapshotResult.Failed] — catch-all with reason code
 *   - [SnapshotResult.Ok] — counts + path + snapshottedAt
 */
@Singleton
class QQLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: QQCredentialsStore,
    private val dbExtractor: QQDbExtractor,
) {

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val contactCount: Int,
            val groupCount: Int,
            val messageCount: Int,
            val totalEvents: Int,
            val snapshottedAt: Long,
        ) : SnapshotResult()

        object NoCredentials : SnapshotResult()
        object NoRoot : SnapshotResult()
        data class ExtractFailed(val reason: String, val message: String? = null) : SnapshotResult()
        data class Failed(val reason: String, val message: String? = null) : SnapshotResult()
    }

    suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext SnapshotResult.NoCredentials
        }

        when (val r = dbExtractor.extract()) {
            is QQDbExtractor.ExtractResult.Ok -> {
                credentialsStore.recordSync(r.extractedAtMs, r.totalRows)
                SnapshotResult.Ok(
                    snapshotPath = r.stagingJsonPath,
                    contactCount = r.contactCount,
                    groupCount = r.groupCount,
                    messageCount = r.messageCount,
                    totalEvents = r.totalRows,
                    snapshottedAt = r.extractedAtMs,
                )
            }
            QQDbExtractor.ExtractResult.NoCredentials -> {
                // Shouldn't happen given the hasCredentials gate above, but
                // defend against state desync (cred store cleared mid-extract).
                Timber.w("QQLocalCollector: extract returned NoCredentials despite hasCredentials=true")
                SnapshotResult.NoCredentials
            }
            QQDbExtractor.ExtractResult.NoRoot -> SnapshotResult.NoRoot
            QQDbExtractor.ExtractResult.SourceDbMissing -> {
                credentialsStore.recordError(-2, "qq-db-not-found")
                SnapshotResult.ExtractFailed(
                    "source-db-missing",
                    "QQ 数据库不存在 — uin 错？或 QQ 未登录此账号",
                )
            }
            is QQDbExtractor.ExtractResult.CopyFailed -> {
                credentialsStore.recordError(-3, r.message)
                SnapshotResult.ExtractFailed("copy-failed", r.message)
            }
            is QQDbExtractor.ExtractResult.Failed -> {
                credentialsStore.recordError(-99, r.message)
                SnapshotResult.ExtractFailed(r.reason, r.message)
            }
        }
    }

    companion object {
        /**
         * Must equal SNAPSHOT_SCHEMA_VERSION in
         * `packages/personal-data-hub/lib/adapters/messaging-qq/index.js`.
         * Bump in lockstep — verify with `grep -n SNAPSHOT_SCHEMA_VERSION`
         * across the two files.
         */
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
