package com.chainlesschain.android.pdh.social.douyin

import android.content.Context
import com.chainlesschain.android.pdh.social.common.LocalRootCollector
import com.chainlesschain.android.pdh.social.common.LocalSnapshotResult
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 2b — orchestrator for the Android in-APK root Douyin collector
 * (path B). Implements the shared [LocalRootCollector] interface from
 * the root database extractor, returning the canonical [LocalSnapshotResult].
 *
 * Coexists with [DouyinLocalCollector] (v0.2 cookies + profile path):
 *
 *   path A (existing)  — [DouyinLocalCollector] — cookies + WebView +
 *                        passport/account/info/v2 (no signing needed,
 *                        v0.2 surface = profile only; v0.3 history /
 *                        favourite / like blocked on X-Bogus)
 *
 *   path B (this file) — [DouyinRootDbCollector] — su + cohort copy +
 *                        SQLite parse of msg + SIMPLE_USER (abrignoni
 *                        DFIR schema, byte-parity with Node-side
 *                        social-douyin-adb). **No frida**, **no
 *                        libmsaoaidsec.so bypass** — we don't attach to
 *                        Douyin's process, we just read its files.
 *
 * Pipeline:
 *   1. credentialsStore.hasCredentials() — short-circuit NoCredentials
 *   2. extractor.extract() — does the full su + cohort + parse + JSON
 *   3. recordSync / recordError on credentialsStore for UI state
 *   4. Map ExtractResult to canonical LocalSnapshotResult
 *
 * Output: staging JSON path consumed by `cc hub sync-adapter
 * social-douyin --input <path>` (snapshot mode, same as path A — both
 * paths funnel into the same social-douyin adapter).
 */
@Singleton
class DouyinRootDbCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: DouyinRootCredentialsStore,
    private val extractor: DouyinRootDbExtractor,
) : LocalRootCollector {

    /**
     * Snapshot via the path-B root + db extraction route. The hub-level
     * UI calls this when the user clicks "本机 root 同步抖音" (the
     * Android-side equivalent of `cc hub douyin-adb-sync` for desktop).
     *
     * Returns a [LocalSnapshotResult] consumable by HubLocalViewModel's
     * generic when-block (the same pattern WeChat / QQ legacy collectors
     * have, but with the canonical shape from B0).
     */
    override suspend fun snapshot(): LocalSnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext LocalSnapshotResult.NoCredentials
        }
        val uid = credentialsStore.getUid()
        if (uid == null) {
            // hasCredentials() returned true but getUid() returned null —
            // EncryptedSharedPreferences state desync (rare, but possible
            // under master-key rotation). Treat as NoCredentials and the
            // UI re-prompts.
            Timber.w("DouyinRootDbCollector: hasCredentials=true but getUid()=null — state desync")
            return@withContext LocalSnapshotResult.NoCredentials
        }

        when (val r = extractor.extract()) {
            is DouyinRootDbExtractor.ExtractResult.Ok -> {
                credentialsStore.recordSync(r.extractedAtMs, r.totalRows)
                val counts = mutableMapOf<String, Int>()
                counts["message"] = r.messageCount
                counts["contact"] = r.contactCount
                val diagnostic = mutableMapOf<String, String>()
                diagnostic["uid"] = uid
                diagnostic["hadMsgTable"] = r.hadMsgTable.toString()
                diagnostic["hadSimpleUserTable"] = r.hadSimpleUserTable.toString()
                if (r.schemaDriftWarnings.isNotEmpty()) {
                    diagnostic["schemaDrift"] = r.schemaDriftWarnings.joinToString(" | ")
                }
                LocalSnapshotResult.Ok(
                    snapshotPath = r.stagingJsonPath,
                    totalEvents = r.totalRows,
                    perCategoryCounts = counts,
                    snapshottedAt = r.extractedAtMs,
                    diagnosticFields = diagnostic,
                )
            }
            DouyinRootDbExtractor.ExtractResult.NoCredentials -> {
                // Defensive: extract() shouldn't return NoCredentials when we
                // already validated above, but state can desync.
                LocalSnapshotResult.NoCredentials
            }
            DouyinRootDbExtractor.ExtractResult.NoRoot -> {
                credentialsStore.recordError(REASON_NO_ROOT, "su not available")
                LocalSnapshotResult.NoRoot
            }
            DouyinRootDbExtractor.ExtractResult.SourceDbMissing -> {
                credentialsStore.recordError(
                    REASON_SOURCE_MISSING,
                    "douyin-im-db-not-found (uid=$uid)",
                )
                LocalSnapshotResult.ExtractFailed(
                    reason = "source-db-missing",
                    message = "抖音 IM 数据库未找到 — 请在抖音 App 内登录并打开任一聊天会话后重试 (uid=$uid)",
                )
            }
            is DouyinRootDbExtractor.ExtractResult.CopyFailed -> {
                credentialsStore.recordError(REASON_COPY_FAILED, r.message)
                LocalSnapshotResult.ExtractFailed(
                    reason = "copy-failed",
                    message = r.message,
                )
            }
            is DouyinRootDbExtractor.ExtractResult.Failed -> {
                credentialsStore.recordError(REASON_GENERIC_FAILED, r.message)
                LocalSnapshotResult.ExtractFailed(
                    reason = r.reason,
                    message = r.message,
                )
            }
        }
    }

    companion object {
        // recordError codes — UI doesn't read these directly, but cc audit
        // / debug commands surface them for triage.
        private const val REASON_NO_ROOT = -10
        private const val REASON_SOURCE_MISSING = -20
        private const val REASON_COPY_FAILED = -30
        private const val REASON_GENERIC_FAILED = -99
    }
}
