package com.chainlesschain.android.pdh.messaging.qq

import android.content.Context
import com.chainlesschain.android.pdh.LocalCcRunner
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * module 101 QQNT 采集方案 — on-device, **frida-free** QQNT collection.
 *
 * QQNT's nt_msg.db (WCDB/SQLCipher) is decrypted by a DERIVED key
 * (`MD5(MD5(uid)+rand)`, no frida — see `cc hub collect-qq` / qq-nt-collect.js).
 * This collector does the device-side staging the bundle can't: su-copy the
 * encrypted nt_msg.db + gather the `u_…` uid candidates into app storage, then
 * invokes `cc hub collect-qq` (runs in the cc bundle's node) to decrypt + parse
 * + ingest into the device vault. No PC, no USB, no frida.
 *
 * Encrypted DB + uid list are wiped after the run (sensitivity=high).
 *
 * NOTE: the uid gather (`find … | strings | grep u_` over QQ's data) is slow
 * (tens of seconds to a few minutes); it runs off the UI thread with a budget.
 */
@Singleton
class QQNTNativeCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val ccRunner: LocalCcRunner,
    private val credentialsStore: QQCredentialsStore,
) {

    sealed class Result {
        data class Ok(val matchedUid: String, val messages: Int, val ingested: Int) : Result()
        object DaemonUnavailable : Result() // Magisk daemon not installed/responding
        object NotLoggedIn : Result() // nt_msg.db not found
        object NoMatch : Result() // self uid not among candidates
        data class Failed(val reason: String) : Result()
    }

    suspend fun snapshot(): Result = withContext(Dispatchers.IO) {
        // The app's own su can't read QQ's data dir on MIUI (kernel cross-app
        // isolation), so delegate the privileged staging to the root Magisk daemon
        // (pdh-qqd.sh, init context — not subject to that block). It reads
        // nt_msg.db + uid candidates and writes them into this app cache.
        val qqd = File(context.cacheDir, "qqd").apply { mkdirs() }
        val request = File(qqd, "request")
        val done = File(qqd, "done").also { it.delete() }
        val error = File(qqd, "error").also { it.delete() }
        val status = File(qqd, "status").also { it.delete() }
        val encDb = File(qqd, "nt_msg.enc.db").also { it.delete() }
        val uidsFile = File(qqd, "uids.txt").also { it.delete() }

        try {
            request.writeText("collect-qq")
            val deadline = System.currentTimeMillis() + DAEMON_TIMEOUT_MS
            var sawStatus = false
            while (System.currentTimeMillis() < deadline) {
                if (done.exists()) break
                if (error.exists()) {
                    val reason = error.readText().trim()
                    return@withContext if (reason.contains("not found")) Result.NotLoggedIn
                    else Result.Failed("daemon: $reason")
                }
                if (status.exists()) sawStatus = true
                Thread.sleep(2_000)
            }
            if (!done.exists()) {
                // No status ever appeared → daemon not installed/running (or not rooted).
                return@withContext if (sawStatus) Result.Failed("daemon timed out") else Result.DaemonUnavailable
            }
            if (!encDb.exists() || encDb.length() <= 1024 || !uidsFile.exists() || uidsFile.length() == 0L) {
                return@withContext Result.Failed("daemon staged incomplete data")
            }

            // decrypt + parse + ingest in the cc bundle.
            val self = credentialsStore.getUin()
            return@withContext when (
                val r = ccRunner.collectQqNative(encDb.absolutePath, uidsFile.absolutePath, self)
            ) {
                is LocalCcRunner.QqCollectResult.Ok ->
                    Result.Ok(r.matchedUid, r.messages, r.ingested)
                is LocalCcRunner.QqCollectResult.NoMatch -> Result.NoMatch
                is LocalCcRunner.QqCollectResult.Failed -> Result.Failed(r.reason)
            }
        } finally {
            // wipe the staged encrypted DB + uids (sensitivity=high); keep the dir.
            try {
                encDb.delete(); uidsFile.delete(); status.delete(); done.delete(); error.delete()
            } catch (_: Throwable) { /* best-effort */ }
        }
    }

    companion object {
        /** The daemon's targeted uid scan takes ~1 min; allow generous margin. */
        private const val DAEMON_TIMEOUT_MS = 300_000L
    }
}
