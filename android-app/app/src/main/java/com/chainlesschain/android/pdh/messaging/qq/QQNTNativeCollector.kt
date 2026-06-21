package com.chainlesschain.android.pdh.messaging.qq

import android.content.Context
import com.chainlesschain.android.pdh.LocalCcRunner
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import java.util.concurrent.TimeUnit
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
        object NoRoot : Result()
        object NotLoggedIn : Result() // nt_msg.db not found
        object NoMatch : Result() // self uid not among candidates
        data class Failed(val reason: String) : Result()
    }

    suspend fun snapshot(): Result = withContext(Dispatchers.IO) {
        if (!isSuAvailable()) return@withContext Result.NoRoot

        val staging = File(context.cacheDir, "qqnt-native").apply { mkdirs() }
        val encDb = File(staging, "nt_msg.enc.db").also { if (it.exists()) it.delete() }
        val uidsFile = File(staging, "uids.txt").also { if (it.exists()) it.delete() }

        try {
            // 1. locate + stage the encrypted nt_msg.db (chmod 644 → app uid readable).
            val staged = suExec(
                "D=\$(find /data/data/com.tencent.mobileqq/databases/nt_db -name nt_msg.db 2>/dev/null | head -1); " +
                    "[ -n \"\$D\" ] && cp \"\$D\" '${encDb.absolutePath}' && chmod 644 '${encDb.absolutePath}'",
                30_000,
            )
            if (!staged || !encDb.exists() || encDb.length() <= 1024) {
                return@withContext Result.NotLoggedIn
            }

            // 2. gather u_ uid candidates (the self uid is brute-matched by the
            //    bundle). Slow scan over QQ's files — bounded by a budget.
            suExec(
                "find /data/data/com.tencent.mobileqq -type f 2>/dev/null | " +
                    "while read f; do strings -a \"\$f\" 2>/dev/null; done | " +
                    "grep -oE 'u_[A-Za-z0-9_-]{15,30}' | sort -u > '${uidsFile.absolutePath}' ; " +
                    "chmod 644 '${uidsFile.absolutePath}' 2>/dev/null",
                240_000,
            )
            if (!uidsFile.exists() || uidsFile.length() == 0L) {
                return@withContext Result.Failed("no uid candidates gathered from QQ data")
            }

            // 3. decrypt + parse + ingest in the cc bundle.
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
            // wipe the encrypted DB + uid list — never persist.
            try { staging.deleteRecursively() } catch (_: Throwable) { /* best-effort */ }
        }
    }

    /** Test seam. */
    internal var isSuAvailable: () -> Boolean = {
        try {
            val p = ProcessBuilder("su", "-c", "id -u").redirectErrorStream(true).start()
            val ok = p.waitFor(3_000, TimeUnit.MILLISECONDS) && p.exitValue() == 0
            if (ok) p.inputStream.bufferedReader().readText().trim().let { it == "0" || it.contains("uid=0") }
            else { p.destroyForcibly(); false }
        } catch (_: Throwable) { false }
    }

    /** Test seam. */
    internal var suExec: (cmd: String, timeoutMs: Long) -> Boolean = { cmd, timeoutMs ->
        try {
            val p = ProcessBuilder("su", "-c", cmd).redirectErrorStream(true).start()
            if (p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) p.exitValue() == 0
            else { p.destroyForcibly(); false }
        } catch (t: Throwable) {
            Timber.w(t, "QQNTNativeCollector.suExec threw")
            false
        }
    }
}
