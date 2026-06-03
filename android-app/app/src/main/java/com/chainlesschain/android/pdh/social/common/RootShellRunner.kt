package com.chainlesschain.android.pdh.social.common

import timber.log.Timber
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase B0 — su exec abstraction lifted from WeChatDbExtractor /
 * QQDbExtractor (which had near-identical `defaultSuExec` +
 * `defaultIsSuAvailable` implementations).
 *
 * Both legacy collectors keep their local `internal var suExec`/`var
 * isSuAvailable` seams in place — do NOT migrate them. New 6 platforms
 * inject this Singleton instead.
 *
 * Design notes:
 *  - `isSuAvailable` is sync (3-second timeout) because [LocalRootCollector]
 *    callers must decide quickly whether to short-circuit with NoRoot
 *    or proceed to the DB cohort copy.
 *  - `exec` returns Boolean (succeeded) not stdout — for the cohort-copy
 *    pipeline we only care about exit code. Platforms that need stdout
 *    (e.g. for `su -c id -u` to verify uid=0) use [execAndCapture].
 *  - Stderr is merged into stdout via `redirectErrorStream(true)` so a
 *    single read drains both — `proc.waitFor` on Win has historically
 *    hung when stderr buffer fills (see [[android-process-reader-thread-eof-race]]
 *    for the parallel reader-thread fix on multi-MB output; the cohort
 *    copy script is tiny so single-shot read is fine here).
 *  - Test seam: callers override [defaultRunner] to inject a fake
 *    `RootShellRunner` in JVM tests without forking real `su`.
 */
interface RootShellRunner {
    /**
     * Probe root availability via `su -c id -u`. Returns true iff the
     * command completes within 3s with exit 0 AND stdout contains
     * `uid=0` (some Magisk-su variants print "uid=0(root)..." while
     * others print just "0").
     */
    fun isSuAvailable(): Boolean

    /**
     * Run [cmd] under `su -c`. Returns true iff completed within
     * [timeoutMs] with exit code 0. Stderr is merged into stdout and
     * logged at WARN level on failure (last 500 chars).
     */
    fun exec(cmd: String, timeoutMs: Long = 30_000L): Boolean

    /**
     * Same as [exec] but returns combined stdout/stderr. Returns null
     * if the process didn't complete in [timeoutMs] OR if the spawn
     * itself threw. Use for cases where the script's stdout is the
     * payload (e.g. `base64 /data/data/.../foo.db`).
     */
    fun execAndCapture(cmd: String, timeoutMs: Long = 30_000L): String?
}

/**
 * Default implementation — forks `su` via ProcessBuilder. On non-rooted
 * devices `Runtime.exec("su")` historically silent-failed under MIUI
 * (Trap 4 in [[android-wechat-collector-phase-12-10]]); we defend by
 * checking exit code AND parsing stdout for `uid=0` (some su variants
 * exit 0 even on a denied prompt).
 */
@Singleton
class DefaultRootShellRunner @Inject constructor() : RootShellRunner {

    override fun isSuAvailable(): Boolean = try {
        val proc = ProcessBuilder("su", "-c", "id -u")
            .redirectErrorStream(true)
            .start()
        val finished = proc.waitFor(3_000, TimeUnit.MILLISECONDS)
        if (!finished) {
            proc.destroyForcibly()
            false
        } else {
            val ok = proc.exitValue() == 0
            if (ok) {
                val out = proc.inputStream.bufferedReader().readText().trim()
                out == "0" || out.contains("uid=0")
            } else {
                false
            }
        }
    } catch (t: Throwable) {
        Timber.d(t, "DefaultRootShellRunner: su availability probe failed")
        false
    }

    override fun exec(cmd: String, timeoutMs: Long): Boolean = try {
        val proc = ProcessBuilder("su", "-c", cmd)
            .redirectErrorStream(true)
            .start()
        val finished = proc.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished) {
            proc.destroyForcibly()
            false
        } else {
            val ok = proc.exitValue() == 0
            if (!ok) {
                val tail = proc.inputStream.bufferedReader().readText().take(500)
                Timber.w("DefaultRootShellRunner: exec failed (exit=${proc.exitValue()}): %s", tail)
            }
            ok
        }
    } catch (t: Throwable) {
        Timber.w(t, "DefaultRootShellRunner: exec threw")
        false
    }

    override fun execAndCapture(cmd: String, timeoutMs: Long): String? = try {
        val proc = ProcessBuilder("su", "-c", cmd)
            .redirectErrorStream(true)
            .start()
        val finished = proc.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished) {
            proc.destroyForcibly()
            null
        } else {
            val out = proc.inputStream.bufferedReader().readText()
            if (proc.exitValue() != 0) {
                Timber.w("DefaultRootShellRunner: execAndCapture exit=${proc.exitValue()}: %s", out.take(500))
                null
            } else {
                out
            }
        }
    } catch (t: Throwable) {
        Timber.w(t, "DefaultRootShellRunner: execAndCapture threw")
        null
    }
}
