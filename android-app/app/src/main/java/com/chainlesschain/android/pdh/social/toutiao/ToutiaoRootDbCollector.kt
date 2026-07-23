package com.chainlesschain.android.pdh.social.toutiao

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
 * Phase 7.1 — orchestrator for the Android in-APK root Toutiao collector
 * (path B). Implements the shared [LocalRootCollector] interface from
 * the root database extractor, returning the canonical [LocalSnapshotResult].
 *
 * Coexists with [ToutiaoLocalCollector] (path A, cookies + passport +
 * SignBridge-signed endpoints):
 *
 *   path A — [ToutiaoLocalCollector] — cookies + WebView + passport
 *            endpoint (passport/account/info/v2 = no signing, plus 3
 *            _signature-signed endpoints via [ToutiaoSignBridge])
 *
 *   path B (this file) — [ToutiaoRootDbCollector] — su + cohort copy +
 *            SQLite parse of read_history / collection_article /
 *            search_history (字节系明文 framework, no frida, no
 *            libmsaoaidsec.so bypass). **Truly offline of PC** — works
 *            without internet or paired desktop.
 *
 * Pipeline:
 *   1. credentialsStore.hasCredentials() — short-circuit NoCredentials
 *   2. extractor.extract() — su + cohort + parse + JSON
 *   3. recordSync / recordError on credentialsStore for UI state
 *   4. Map ExtractResult to canonical LocalSnapshotResult
 *
 * Output: staging JSON path consumed by `cc hub sync-adapter
 * social-toutiao --input <path>` (snapshot mode, schemaVersion=1 —
 * shared with path C `social-toutiao-adb`).
 */
@Singleton
class ToutiaoRootDbCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: ToutiaoRootCredentialsStore,
    private val extractor: ToutiaoRootDbExtractor,
) : LocalRootCollector {

    override suspend fun snapshot(): LocalSnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext LocalSnapshotResult.NoCredentials
        }
        val uid = credentialsStore.getUid()
        if (uid == null) {
            Timber.w("ToutiaoRootDbCollector: hasCredentials=true but getUid()=null — state desync")
            return@withContext LocalSnapshotResult.NoCredentials
        }

        when (val r = extractor.extract()) {
            is ToutiaoRootDbExtractor.ExtractResult.Ok -> {
                credentialsStore.recordSync(r.extractedAtMs, r.totalRows)
                val counts = mutableMapOf<String, Int>()
                counts["read"] = r.readCount
                counts["collection"] = r.collectionCount
                counts["search"] = r.searchCount
                val diagnostic = mutableMapOf<String, String>()
                diagnostic["uid"] = uid
                diagnostic["dbFilename"] = r.dbFilename
                diagnostic["hadReadTable"] = r.hadReadTable.toString()
                diagnostic["hadCollectionTable"] = r.hadCollectionTable.toString()
                diagnostic["hadSearchTable"] = r.hadSearchTable.toString()
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
            ToutiaoRootDbExtractor.ExtractResult.NoCredentials -> {
                LocalSnapshotResult.NoCredentials
            }
            ToutiaoRootDbExtractor.ExtractResult.NoRoot -> {
                credentialsStore.recordError(REASON_NO_ROOT, "su not available")
                LocalSnapshotResult.NoRoot
            }
            ToutiaoRootDbExtractor.ExtractResult.SourceDbMissing -> {
                credentialsStore.recordError(
                    REASON_SOURCE_MISSING,
                    "toutiao-db-not-found (uid=$uid) — 探测 DB filename 未匹配 candidate list (P7.1.0 待跟)",
                )
                LocalSnapshotResult.ExtractFailed(
                    reason = "source-db-missing",
                    message = "头条 databases/ 内未找到候选 DB 文件 — v0.1 仅尝试 article.db / bdtracker_v3.db / applog_stats.db / tnc.db / favorite.db / history.db。请运行真机 schema 探测 (P7.1.0) 把实际文件名加入候选列表。(uid=$uid)",
                )
            }
            is ToutiaoRootDbExtractor.ExtractResult.CopyFailed -> {
                credentialsStore.recordError(REASON_COPY_FAILED, r.message)
                LocalSnapshotResult.ExtractFailed(
                    reason = "copy-failed",
                    message = r.message,
                )
            }
            is ToutiaoRootDbExtractor.ExtractResult.Failed -> {
                credentialsStore.recordError(REASON_GENERIC_FAILED, r.message)
                LocalSnapshotResult.ExtractFailed(
                    reason = r.reason,
                    message = r.message,
                )
            }
        }
    }

    companion object {
        private const val REASON_NO_ROOT = -10
        private const val REASON_SOURCE_MISSING = -20
        private const val REASON_COPY_FAILED = -30
        private const val REASON_GENERIC_FAILED = -99
    }
}
