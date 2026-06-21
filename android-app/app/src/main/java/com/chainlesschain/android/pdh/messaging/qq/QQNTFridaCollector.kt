package com.chainlesschain.android.pdh.messaging.qq

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * module 101 QQNT 采集方案 Phase 1 — end-to-end QQNT collection orchestrator.
 *
 *   1. [QQNTFridaExporter] → Method C plaintext copy of nt_msg.db
 *   2. su cp the plaintext into app storage (chmod 644 so the app uid can read)
 *   3. [QQNTDbExtractor] → messaging-qq staging JSON
 *   4. caller (CollectQqntTool) hands the path to `cc hub sync-adapter messaging-qq`
 *   5. wipe plaintext on /data/local/tmp + app copy (sensitivity=high)
 *
 * No IMEI / no credential gate (unlike legacy <uin>.db): QQNT auth is the live
 * keyed connection borrowed by frida. uin is best-effort (account attribution).
 */
@Singleton
class QQNTFridaCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val exporter: QQNTFridaExporter,
    private val extractor: QQNTDbExtractor,
    private val credentialsStore: QQCredentialsStore,
) {

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val messageCount: Int,
            val snapshottedAt: Long,
        ) : SnapshotResult()

        object NoRoot : SnapshotResult()
        object AppNotRunning : SnapshotResult()
        object AntiFrida : SnapshotResult()
        object NoExport : SnapshotResult()
        data class Failed(val reason: String, val message: String? = null) : SnapshotResult()
    }

    suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
        val export = exporter.export()
        val paths = when (export) {
            is QQNTFridaExporter.Result.Ok -> export.plaintextPaths
            QQNTFridaExporter.Result.NoRoot -> return@withContext SnapshotResult.NoRoot
            QQNTFridaExporter.Result.AppNotRunning -> return@withContext SnapshotResult.AppNotRunning
            QQNTFridaExporter.Result.BinaryMissing ->
                return@withContext SnapshotResult.Failed("frida-binary-missing")
            QQNTFridaExporter.Result.AntiFridaSuspected -> return@withContext SnapshotResult.AntiFrida
            QQNTFridaExporter.Result.NoExport -> return@withContext SnapshotResult.NoExport
            is QQNTFridaExporter.Result.Failed ->
                return@withContext SnapshotResult.Failed(export.reason, export.message)
        }

        val ntMsgPlain = paths.firstOrNull { it.contains("nt_msg") }
            ?: return@withContext SnapshotResult.NoExport

        val staging = File(context.cacheDir, "qqnt-staging").apply { mkdirs() }
        val localDb = File(staging, "nt_msg.plain.db").also { if (it.exists()) it.delete() }
        // chmod 644 (world-readable) lets the app uid read the root-cp'd file —
        // same pattern as QQDbExtractor.copyDbCohortViaSu.
        val copied = suExec(
            "cp '$ntMsgPlain' '${localDb.absolutePath}' && chmod 644 '${localDb.absolutePath}'" +
                " ; if [ -f '$ntMsgPlain-wal' ]; then cp '$ntMsgPlain-wal' '${localDb.absolutePath}-wal' && chmod 644 '${localDb.absolutePath}-wal'; fi",
            30_000,
        )
        if (!copied || !localDb.exists()) {
            cleanup(staging)
            return@withContext SnapshotResult.Failed("copy-failed", "su cp of plaintext nt_msg failed")
        }

        try {
            val uin = credentialsStore.getUin().orEmpty()
            when (val r = extractor.extract(localDb.absolutePath, staging, uin)) {
                is QQNTDbExtractor.Result.Ok -> SnapshotResult.Ok(
                    snapshotPath = r.stagingJsonPath,
                    messageCount = r.messageCount,
                    snapshottedAt = System.currentTimeMillis(),
                )
                is QQNTDbExtractor.Result.Failed -> SnapshotResult.Failed(r.reason, r.message)
            }
        } finally {
            // wipe plaintext copies — keep only the JSON (which the caller ingests
            // then also deletes). plaintext never persists.
            localDb.delete()
            File(staging, "nt_msg.plain.db-wal").takeIf { it.exists() }?.delete()
            suExec("rm -rf ${QQNTFridaExporter.DEC}", 5_000)
        }
    }

    private fun cleanup(staging: File) {
        try { staging.deleteRecursively() } catch (_: Throwable) {}
        suExec("rm -rf ${QQNTFridaExporter.DEC}", 5_000)
    }

    /** Test seam. */
    internal var suExec: (cmd: String, timeoutMs: Long) -> Boolean = { cmd, timeoutMs ->
        try {
            val p = ProcessBuilder("su", "-c", cmd).redirectErrorStream(true).start()
            if (p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) p.exitValue() == 0
            else { p.destroyForcibly(); false }
        } catch (t: Throwable) {
            Timber.w(t, "QQNTFridaCollector.suExec threw")
            false
        }
    }
}
