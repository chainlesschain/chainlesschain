package com.chainlesschain.android.pdh.social.kuaishou

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
 * Phase 7.6 — orchestrator for the Android in-APK root Kuaishou collector
 * (path B). Implements the shared [LocalRootCollector] interface.
 *
 * **v0.1 期望失败率与 Xhs 并列最高** per plan §6.6: Kuaishou DB 几乎确定
 * SQLCipher 或自研加密 + libmsaoaidsec.so 反 frida 极高强度。v0.1 ship 是
 * user-explicit "Mode B 全面 5 平台" override; 真机 most-likely 命中
 * `likely-sqlcipher` banner 跳 v2.0 路径。
 *
 * Coexists with [KuaishouLocalCollector] (path A, cookies + NS_sig3 签名
 * GraphQL HTTP). Path B reads `/data/data/com.smile.gifmaker/databases/
 * *.db` directly via root — no internet, no NS_sig3 signing.
 *
 * **v2.0 transition**: when `Failed(reason = "likely-sqlcipher")` fires,
 * v0.1 UI banner points to plan §6.6 / `PDH_Mode_B_Phase_7_Plan.md` for
 * the frida + libmsaoaidsec neuter + cipher key derivation path.
 *
 * Output: staging JSON consumed by `cc hub sync-adapter social-kuaishou
 * --input <path>` (snapshot mode, schemaVersion=1).
 */
@Singleton
class KuaishouRootDbCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: KuaishouRootCredentialsStore,
    private val extractor: KuaishouRootDbExtractor,
) : LocalRootCollector {

    override suspend fun snapshot(): LocalSnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext LocalSnapshotResult.NoCredentials
        }
        val uid = credentialsStore.getUid()
        if (uid == null) {
            Timber.w("KuaishouRootDbCollector: hasCredentials=true but getUid()=null — state desync")
            return@withContext LocalSnapshotResult.NoCredentials
        }

        when (val r = extractor.extract()) {
            is KuaishouRootDbExtractor.ExtractResult.Ok -> {
                credentialsStore.recordSync(r.extractedAtMs, r.totalRows)
                val counts = mutableMapOf<String, Int>()
                counts["watch"] = r.watchCount
                counts["collect"] = r.collectCount
                counts["search"] = r.searchCount
                val diagnostic = mutableMapOf<String, String>()
                diagnostic["uid"] = uid
                diagnostic["dbFilename"] = r.dbFilename
                diagnostic["hadWatchTable"] = r.hadWatchTable.toString()
                diagnostic["hadCollectTable"] = r.hadCollectTable.toString()
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
            KuaishouRootDbExtractor.ExtractResult.NoCredentials -> {
                LocalSnapshotResult.NoCredentials
            }
            KuaishouRootDbExtractor.ExtractResult.NoRoot -> {
                credentialsStore.recordError(REASON_NO_ROOT, "su not available")
                LocalSnapshotResult.NoRoot
            }
            KuaishouRootDbExtractor.ExtractResult.SourceDbMissing -> {
                credentialsStore.recordError(
                    REASON_SOURCE_MISSING,
                    "kuaishou-db-not-found (uid=$uid) — 探测 DB filename 未匹配 candidate list (P7.6.0 待跟)",
                )
                LocalSnapshotResult.ExtractFailed(
                    reason = "source-db-missing",
                    message = "快手 databases/ 内未找到候选 DB 文件 — v0.1 仅尝试 kwai.db / kuaishou.db / gif.db / video.db / feed.db / user.db / history.db。请运行真机 schema 探测 (P7.6.0) 把实际文件名加入候选列表。(uid=$uid)",
                )
            }
            is KuaishouRootDbExtractor.ExtractResult.CopyFailed -> {
                credentialsStore.recordError(REASON_COPY_FAILED, r.message)
                LocalSnapshotResult.ExtractFailed(
                    reason = "copy-failed",
                    message = r.message,
                )
            }
            is KuaishouRootDbExtractor.ExtractResult.Failed -> {
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
