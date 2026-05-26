package com.chainlesschain.android.pdh.social.weibo

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
 * Phase 7.4 — orchestrator for the Android in-APK root Weibo collector
 * (path B). Implements the shared [LocalRootCollector] interface.
 *
 * **v0.1 assumes 明文 SQLite**. If real-device probe (P7.3 §3) reveals
 * SQLCipher, the `Failed(reason = "likely-sqlcipher")` branch surfaces
 * a banner pointing to P7.3 §3.4-3.6 frida hook path — user runs that
 * to extract the key, then v0.2 ships a WeiboFridaInjector module
 * (mirror of WeChat 12.10 pattern).
 *
 * Coexists with [WeiboLocalCollector] (path A, cookies + m.weibo.cn
 * HTTP). Path B reads `/data/data/com.sina.weibo/databases/` `*.db` files
 * directly via root — no internet, no signing.
 *
 * Output: staging JSON consumed by `cc hub sync-adapter social-weibo
 * --input <path>` (snapshot mode, schemaVersion=1).
 */
@Singleton
class WeiboRootDbCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: WeiboRootCredentialsStore,
    private val extractor: WeiboRootDbExtractor,
) : LocalRootCollector {

    override suspend fun snapshot(): LocalSnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext LocalSnapshotResult.NoCredentials
        }
        val uid = credentialsStore.getUid()
        if (uid == null) {
            Timber.w("WeiboRootDbCollector: hasCredentials=true but getUid()=null — state desync")
            return@withContext LocalSnapshotResult.NoCredentials
        }

        when (val r = extractor.extract()) {
            is WeiboRootDbExtractor.ExtractResult.Ok -> {
                credentialsStore.recordSync(r.extractedAtMs, r.totalRows)
                val counts = mutableMapOf<String, Int>()
                counts["post"] = r.postCount
                counts["favourite"] = r.favouriteCount
                counts["follow"] = r.followCount
                val diagnostic = mutableMapOf<String, String>()
                diagnostic["uid"] = uid
                diagnostic["dbFilename"] = r.dbFilename
                diagnostic["hadPostTable"] = r.hadPostTable.toString()
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
            WeiboRootDbExtractor.ExtractResult.NoCredentials -> {
                LocalSnapshotResult.NoCredentials
            }
            WeiboRootDbExtractor.ExtractResult.NoRoot -> {
                credentialsStore.recordError(REASON_NO_ROOT, "su not available")
                LocalSnapshotResult.NoRoot
            }
            WeiboRootDbExtractor.ExtractResult.SourceDbMissing -> {
                credentialsStore.recordError(
                    REASON_SOURCE_MISSING,
                    "weibo-db-not-found (uid=$uid) — 探测 DB filename 未匹配 candidate list (P7.3 §3 待跟)",
                )
                LocalSnapshotResult.ExtractFailed(
                    reason = "source-db-missing",
                    message = "微博 databases/ 内未找到候选 DB 文件 — v0.1 仅尝试 weibo.db / mblog.db / feed.db / user.db / home_feed.db / weibo_pro.db / status.db。请运行真机 schema 探测 (P7.3 §3) 把实际文件名加入候选列表。(uid=$uid)",
                )
            }
            is WeiboRootDbExtractor.ExtractResult.CopyFailed -> {
                credentialsStore.recordError(REASON_COPY_FAILED, r.message)
                LocalSnapshotResult.ExtractFailed(
                    reason = "copy-failed",
                    message = r.message,
                )
            }
            is WeiboRootDbExtractor.ExtractResult.Failed -> {
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
