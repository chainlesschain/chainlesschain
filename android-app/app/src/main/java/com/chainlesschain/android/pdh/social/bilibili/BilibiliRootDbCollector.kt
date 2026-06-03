package com.chainlesschain.android.pdh.social.bilibili

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
 * Phase 7.2 — orchestrator for the Android in-APK root Bilibili collector
 * (path B). Implements the shared [LocalRootCollector] interface,
 * returning the canonical [LocalSnapshotResult].
 *
 * **Plan §6.4 recommendation**: SKIP — path A (SESSDATA cookie + api.
 * bilibili.com) is already the optimal route. v0.1 ships anyway for
 * fallback / offline / heavy-throttle scenarios. UI button still
 * renders so the user can choose.
 *
 * Coexists with [BilibiliLocalCollector] (path A, cookies + WBI signing
 * + api.bilibili.com endpoints). Path B reads
 * `/data/data/tv.danmaku.bili/databases/` `*.db` files directly via root — no
 * internet, no signing, no anti-bot risk.
 *
 * Pipeline:
 *   1. credentialsStore.hasCredentials() — short-circuit NoCredentials
 *   2. extractor.extract() — su + cohort + parse + JSON
 *   3. recordSync / recordError on credentialsStore
 *   4. Map ExtractResult to canonical LocalSnapshotResult
 *
 * Output: staging JSON consumed by `cc hub sync-adapter social-bilibili
 * --input <path>` (snapshot mode, schemaVersion=1 — shared with path A
 * and path C `social-bilibili-adb`).
 */
@Singleton
class BilibiliRootDbCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: BilibiliRootCredentialsStore,
    private val extractor: BilibiliRootDbExtractor,
) : LocalRootCollector {

    override suspend fun snapshot(): LocalSnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext LocalSnapshotResult.NoCredentials
        }
        val uid = credentialsStore.getUid()
        if (uid == null) {
            Timber.w("BilibiliRootDbCollector: hasCredentials=true but getUid()=null — state desync")
            return@withContext LocalSnapshotResult.NoCredentials
        }

        when (val r = extractor.extract()) {
            is BilibiliRootDbExtractor.ExtractResult.Ok -> {
                credentialsStore.recordSync(r.extractedAtMs, r.totalRows)
                val counts = mutableMapOf<String, Int>()
                counts["history"] = r.historyCount
                counts["favourite"] = r.favouriteCount
                counts["follow"] = r.followCount
                val diagnostic = mutableMapOf<String, String>()
                diagnostic["uid"] = uid
                diagnostic["dbFilename"] = r.dbFilename
                diagnostic["hadHistoryTable"] = r.hadHistoryTable.toString()
                diagnostic["hadFavouriteTable"] = r.hadFavouriteTable.toString()
                diagnostic["hadFollowTable"] = r.hadFollowTable.toString()
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
            BilibiliRootDbExtractor.ExtractResult.NoCredentials -> {
                LocalSnapshotResult.NoCredentials
            }
            BilibiliRootDbExtractor.ExtractResult.NoRoot -> {
                credentialsStore.recordError(REASON_NO_ROOT, "su not available")
                LocalSnapshotResult.NoRoot
            }
            BilibiliRootDbExtractor.ExtractResult.SourceDbMissing -> {
                credentialsStore.recordError(
                    REASON_SOURCE_MISSING,
                    "bilibili-db-not-found (uid=$uid) — 探测 DB filename 未匹配 candidate list (P7.2.0 待跟)",
                )
                LocalSnapshotResult.ExtractFailed(
                    reason = "source-db-missing",
                    message = "B 站 databases/ 内未找到候选 DB 文件 — v0.1 仅尝试 bili.db / biliCommunity.db / bplus.db / history.db / favourite.db / follow.db。请运行真机 schema 探测 (P7.2.0) 把实际文件名加入候选列表。(uid=$uid)",
                )
            }
            is BilibiliRootDbExtractor.ExtractResult.CopyFailed -> {
                credentialsStore.recordError(REASON_COPY_FAILED, r.message)
                LocalSnapshotResult.ExtractFailed(
                    reason = "copy-failed",
                    message = r.message,
                )
            }
            is BilibiliRootDbExtractor.ExtractResult.Failed -> {
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
