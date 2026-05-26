package com.chainlesschain.android.pdh.social.xiaohongshu

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
 * Phase 7.5 — orchestrator for the Android in-APK root Xhs collector
 * (path B). Implements the shared [LocalRootCollector] interface.
 *
 * **v0.1 期望低成功率** per plan §6.5: Xhs DB 几乎确定 SQLCipher 加密 +
 * libshield.so 反 frida. v0.1 ship 是 user-explicit "Mode B 全面 5 平台"
 * override; 真机 most-likely 命中 `likely-sqlcipher` banner 跳 v2.0 路径。
 *
 * Coexists with [XhsLocalCollector] (path A, cookies + X-S 签名 HTTP +
 * WebView prefetch). Path B reads `/data/data/com.xingin.xhs/databases/
 * *.db` directly via root — no internet, no signing.
 *
 * **v2.0 transition**: when `Failed(reason = "likely-sqlcipher")` fires,
 * v0.1 UI banner points to plan §6.5 / `PDH_Mode_B_Phase_7_Plan.md` for
 * the frida + libshield neuter + SQLCipher key derivation path.
 *
 * Output: staging JSON consumed by `cc hub sync-adapter
 * social-xiaohongshu --input <path>` (snapshot mode, schemaVersion=1).
 */
@Singleton
class XhsRootDbCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: XhsRootCredentialsStore,
    private val extractor: XhsRootDbExtractor,
) : LocalRootCollector {

    override suspend fun snapshot(): LocalSnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext LocalSnapshotResult.NoCredentials
        }
        val userId = credentialsStore.getUid()
        if (userId == null) {
            Timber.w("XhsRootDbCollector: hasCredentials=true but getUid()=null — state desync")
            return@withContext LocalSnapshotResult.NoCredentials
        }

        when (val r = extractor.extract()) {
            is XhsRootDbExtractor.ExtractResult.Ok -> {
                credentialsStore.recordSync(r.extractedAtMs, r.totalRows)
                val counts = mutableMapOf<String, Int>()
                counts["note"] = r.noteCount
                counts["liked"] = r.likedCount
                counts["follow"] = r.followCount
                val diagnostic = mutableMapOf<String, String>()
                diagnostic["userId"] = userId
                diagnostic["dbFilename"] = r.dbFilename
                diagnostic["hadNoteTable"] = r.hadNoteTable.toString()
                diagnostic["hadLikedTable"] = r.hadLikedTable.toString()
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
            XhsRootDbExtractor.ExtractResult.NoCredentials -> {
                LocalSnapshotResult.NoCredentials
            }
            XhsRootDbExtractor.ExtractResult.NoRoot -> {
                credentialsStore.recordError(REASON_NO_ROOT, "su not available")
                LocalSnapshotResult.NoRoot
            }
            XhsRootDbExtractor.ExtractResult.SourceDbMissing -> {
                credentialsStore.recordError(
                    REASON_SOURCE_MISSING,
                    "xhs-db-not-found (userId=$userId) — 探测 DB filename 未匹配 candidate list (P7.5.0 待跟)",
                )
                LocalSnapshotResult.ExtractFailed(
                    reason = "source-db-missing",
                    message = "小红书 databases/ 内未找到候选 DB 文件 — v0.1 仅尝试 xhs.db / redbook.db / notes.db / discovery.db / user.db / xhs_cache.db / red.db。请运行真机 schema 探测 (P7.5.0) 把实际文件名加入候选列表。(userId=$userId)",
                )
            }
            is XhsRootDbExtractor.ExtractResult.CopyFailed -> {
                credentialsStore.recordError(REASON_COPY_FAILED, r.message)
                LocalSnapshotResult.ExtractFailed(
                    reason = "copy-failed",
                    message = r.message,
                )
            }
            is XhsRootDbExtractor.ExtractResult.Failed -> {
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
