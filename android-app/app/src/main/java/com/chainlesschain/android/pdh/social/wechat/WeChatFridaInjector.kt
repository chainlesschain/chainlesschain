package com.chainlesschain.android.pdh.social.wechat

import android.content.Context
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 12.10.4 — extracts the SQLCipher key from a live WeChat process
 * via a bundled `frida-inject` binary.
 *
 * Architecture (Approach A from design doc §3.2.1; sjqz `tools/wechat/
 * capture_key_v6.py` proves the hook strategy on real devices):
 *
 *   1. Locate `assets/frida/frida-inject-{arm64,arm}` and
 *      `assets/frida/wechat-key-hook.js`. If the binary isn't shipped
 *      (v0.1 — Win dev box can't verify), return [KeyResult.BinaryMissing].
 *   2. Copy both to `/data/local/tmp/` via `su -c cp` + chmod 0755 on the
 *      binary. We use `/data/local/tmp/` not the app filesDir because
 *      Android 10+'s W^X prevents exec from filesDir
 *      (see memory `android_native_lib_extract_w_x.md`).
 *   3. `su -c "pidof com.tencent.mm"` — if WeChat isn't running,
 *      return [KeyResult.PidofFailed] so the UI can prompt the user.
 *   4. Spawn `su -c "/data/local/tmp/frida-inject -p <pid>
 *      -s /data/local/tmp/wechat-key-hook.js --runtime=v8"`.
 *   5. Read stdout line-by-line. The agent dual-emits via `send()` AND
 *      `console.log(JSON.stringify(...))` so frida-inject's CLI behavior
 *      around send() messages doesn't matter — we parse any JSON line
 *      with `kind=="key"`.
 *   6. On the first valid key event: destroy the frida-inject process
 *      (it persists otherwise, and a long-running attached process trips
 *      WeChat anti-detection).
 *   7. On timeout (default 30s), kill and return [KeyResult.HookTimedOut].
 *      The agent has its own 30s internal poll for module-load, so we
 *      give the same window externally.
 *
 * **Hook coverage** (per `wechat-key-hook.js` — byte-mirror of desktop
 * `packages/personal-data-hub/lib/adapters/wechat/frida-agent/`):
 *
 *   - sqlite3_key       — args[1]=key, args[2]=len (v1 signature)
 *   - sqlite3_key_v2    — args[2]=key, args[3]=len (db name in args[1])
 *   - wcdb_setkey       — assumed v1 sig
 *   - WCDBKeyDerive     — assumed v1 sig
 *   - mangled C++ (WCDB::Database::setCipherKey) — emits error, fallback
 *
 * Tried on both `libWCDB.so` and `libwcdb.so` (case-drift across WeChat
 * versions per sjqz audit; first hit wins).
 *
 * **STATUS**: real impl. v0.1 ships agent JS + Kotlin orchestration; v0.2
 * adds the frida-inject native binaries to `assets/frida/` once a real-device
 * pass on Xiaomi + Magisk + WeChat 8.0.50+ proves the injection attaches
 * (Phase 12.10.6 milestone).
 *
 * Test seam: [suExec] / [isSuAvailable] / [spawnProcess] / [assetReader]
 * are vars so unit tests can inject fakes without forking actual su.
 */
@Singleton
class WeChatFridaInjector @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    sealed class KeyResult {
        data class Ok(val dbKeyHex: String, val durationMs: Long, val source: String) : KeyResult()
        object NoRoot : KeyResult()
        object BinaryMissing : KeyResult()
        object PidofFailed : KeyResult()
        object HookTimedOut : KeyResult()
        data class InjectFailed(val exitCode: Int, val stderr: String) : KeyResult()
    }

    /**
     * Extract the SQLCipher key for the given uin. Returns within
     * [timeoutMs] either with the key or a failure code.
     *
     * @param uin User WeChat UIN — currently unused at the frida layer
     *            (the hook captures the key for whichever DB WeChat opens
     *            next), but we accept it so the API matches CredentialsStore's
     *            view of identity + future per-uin DB filtering.
     * @param timeoutMs Total time to wait for a key event. The agent JS
     *                  has its own 30s module-load poll; we set the
     *                  external timeout slightly higher (default 35s).
     */
    suspend fun extractKey(uin: String, timeoutMs: Long = 35_000): KeyResult =
        withContext(Dispatchers.IO) {
            val started = System.currentTimeMillis()

            if (!isSuAvailable()) {
                Timber.w("WeChatFridaInjector.extractKey: su not available")
                return@withContext KeyResult.NoRoot
            }

            val arch = primaryArch()
            val binaryAsset = "frida/frida-inject-$arch"
            val agentAsset = "frida/wechat-key-hook.js"

            if (!assetReader.exists(binaryAsset)) {
                Timber.w(
                    "WeChatFridaInjector.extractKey: assets/$binaryAsset missing — " +
                        "v0.2 ships the binary; v0.1 returns BinaryMissing here",
                )
                return@withContext KeyResult.BinaryMissing
            }
            if (!assetReader.exists(agentAsset)) {
                Timber.e("WeChatFridaInjector.extractKey: assets/$agentAsset missing — APK corrupt?")
                return@withContext KeyResult.BinaryMissing
            }

            // 1. Stage binary + agent in app cache (Java-readable), then
            //    su cp into /data/local/tmp/ for exec.
            val cacheStaging = File(context.cacheDir, "frida-staging").also { it.mkdirs() }
            val stagedBinary = File(cacheStaging, "frida-inject")
            val stagedAgent = File(cacheStaging, "wechat-key-hook.js")
            try {
                assetReader.copyTo(binaryAsset, stagedBinary)
                assetReader.copyTo(agentAsset, stagedAgent)
            } catch (t: Throwable) {
                Timber.e(t, "WeChatFridaInjector.extractKey: asset stage failed")
                return@withContext KeyResult.InjectFailed(
                    exitCode = -1,
                    stderr = "stage-failed: ${t.message}",
                )
            }

            val tmpBinary = "/data/local/tmp/cc-frida-inject"
            val tmpAgent = "/data/local/tmp/cc-wechat-key-hook.js"
            val stageScript = buildString {
                append("cp ${stagedBinary.absolutePath} $tmpBinary")
                append(" && chmod 0755 $tmpBinary")
                append(" && cp ${stagedAgent.absolutePath} $tmpAgent")
                append(" && chmod 0644 $tmpAgent")
            }
            if (!suExec(stageScript, 15_000)) {
                Timber.w("WeChatFridaInjector.extractKey: su stage to /data/local/tmp failed")
                return@withContext KeyResult.InjectFailed(
                    exitCode = -1,
                    stderr = "su-stage-failed",
                )
            }

            // 2. pidof WeChat
            val wxPid = pidofWechat()
            if (wxPid == null) {
                Timber.w("WeChatFridaInjector.extractKey: WeChat not running (pidof returned nothing)")
                cleanupTmp(tmpBinary, tmpAgent)
                return@withContext KeyResult.PidofFailed
            }
            Timber.i("WeChatFridaInjector.extractKey: attaching to com.tencent.mm pid=$wxPid")

            // 3. Spawn frida-inject + parse stdout for the first key event.
            val injectCmd = "$tmpBinary -p $wxPid -s $tmpAgent --runtime=v8"
            val result = try {
                spawnAndAwaitKey(injectCmd, timeoutMs, started)
            } catch (t: Throwable) {
                Timber.e(t, "WeChatFridaInjector.extractKey: spawn or parse threw")
                KeyResult.InjectFailed(
                    exitCode = -1,
                    stderr = "${t.javaClass.simpleName}: ${t.message}",
                )
            } finally {
                cleanupTmp(tmpBinary, tmpAgent)
                // Wipe app-side staging cache too (binary not key-bearing
                // but keeping disposable copies post-extract is noisy).
                cacheStaging.deleteRecursively()
            }

            result
        }

    /** Public check: is `su` accessible and root-capable? */
    suspend fun isSuAvailable(): Boolean = withContext(Dispatchers.IO) {
        suProbe()
    }

    // ─── stdout parser ──────────────────────────────────────────────────────

    private fun spawnAndAwaitKey(
        injectCmd: String,
        timeoutMs: Long,
        startedMs: Long,
    ): KeyResult {
        val proc = spawnProcess("su", "-c", injectCmd)
        val stderrCollector = StringBuilder()
        val stderrThread = Thread {
            try {
                proc.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) {
                        stderrCollector.appendLine(line)
                    }
                }
            } catch (t: Throwable) {
                Timber.d(t, "WeChatFridaInjector: stderr reader exited")
            }
        }.also { it.start() }

        try {
            val stdoutReader = proc.inputStream.bufferedReader(Charsets.UTF_8)
            val deadline = startedMs + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                // Use ready() to avoid blocking past the deadline.
                if (!stdoutReader.ready()) {
                    if (!proc.isAlive) {
                        // Process exited without sending a key — surface stderr.
                        Thread.sleep(100)  // drain reader thread
                        val exitCode = try { proc.exitValue() } catch (_: IllegalThreadStateException) { -1 }
                        return KeyResult.InjectFailed(
                            exitCode = exitCode,
                            stderr = stderrCollector.toString().take(2_000),
                        )
                    }
                    Thread.sleep(50)
                    continue
                }
                val line = stdoutReader.readLine() ?: continue
                val parsed = parseKeyLine(line)
                if (parsed != null) {
                    val durationMs = System.currentTimeMillis() - startedMs
                    Timber.i(
                        "WeChatFridaInjector: key captured via %s after %dms",
                        parsed.source,
                        durationMs,
                    )
                    return KeyResult.Ok(
                        dbKeyHex = parsed.hex,
                        durationMs = durationMs,
                        source = parsed.source,
                    )
                }
                // Log non-key events at debug for forensics.
                if (line.contains("\"kind\"")) {
                    Timber.d("frida-agent: %s", line.take(300))
                }
            }
            Timber.w(
                "WeChatFridaInjector: no key in %dms (last stderr: %s)",
                timeoutMs,
                stderrCollector.toString().take(500),
            )
            return KeyResult.HookTimedOut
        } finally {
            try {
                if (proc.isAlive) {
                    proc.destroyForcibly()
                    proc.waitFor(2, TimeUnit.SECONDS)
                }
            } catch (t: Throwable) {
                Timber.d(t, "WeChatFridaInjector: process destroy threw")
            }
            try { stderrThread.join(1_000) } catch (_: InterruptedException) { /* ignore */ }
        }
    }

    /**
     * Parse a stdout line for a key event. Returns null if the line is
     * not a JSON object or doesn't represent a captured key.
     *
     * Accepts both the agent's primary `{"kind":"key","hex":"..."}` shape
     * and the frida-inject `[send] {...}` wrapper variant (some versions
     * prefix send messages, some don't — we accept both).
     */
    internal data class ParsedKey(val hex: String, val source: String)

    internal fun parseKeyLine(line: String): ParsedKey? {
        val trimmed = line.trim()
        // Strip frida-inject's `[send] ` prefix if present.
        val jsonStr = when {
            trimmed.startsWith("[send] ") -> trimmed.substring("[send] ".length)
            trimmed.startsWith("{") -> trimmed
            else -> return null
        }
        return try {
            val obj = JSONObject(jsonStr)
            if (obj.optString("kind") != "key") return null
            val hex = obj.optString("hex").lowercase()
            if (hex.length !in setOf(40, 64)) {
                // 40 = SHA-1, 64 = SHA-256 / 32 raw bytes. WeChat uses 64;
                // 40 reserved for hypothetical future. Anything else is
                // suspicious — log and skip rather than persist bad key.
                Timber.w(
                    "WeChatFridaInjector.parseKeyLine: implausible hex length %d in %s",
                    hex.length,
                    jsonStr.take(200),
                )
                return null
            }
            if (!hex.all { it in '0'..'9' || it in 'a'..'f' }) {
                Timber.w("WeChatFridaInjector.parseKeyLine: non-hex chars in %s", jsonStr.take(200))
                return null
            }
            ParsedKey(hex = hex, source = obj.optString("source", "unknown"))
        } catch (t: Throwable) {
            // Not JSON — frida-inject also emits version banners + Module-load
            // messages that aren't JSON. Skip silently.
            null
        }
    }

    // ─── su helpers ─────────────────────────────────────────────────────────

    /** Test seam — override to skip the actual su exec. */
    internal var suExec: (cmd: String, timeoutMs: Long) -> Boolean = ::defaultSuExec

    /** Test seam — override for fake su-probe. */
    internal var suProbe: () -> Boolean = ::defaultSuProbe

    /** Test seam — override for fake asset reads (avoids context.assets in unit tests). */
    internal var assetReader: AssetReader = ContextAssetReader(context)

    /** Test seam — override to return a mocked Process from a fake spawn. */
    internal var spawnProcess: (String, String, String) -> Process = { a, b, c ->
        ProcessBuilder(a, b, c).start()
    }

    private fun defaultSuProbe(): Boolean = try {
        val proc = ProcessBuilder("su", "-c", "id -u").redirectErrorStream(true).start()
        val ok = proc.waitFor(3_000, TimeUnit.MILLISECONDS) && proc.exitValue() == 0
        if (ok) {
            val out = proc.inputStream.bufferedReader().readText().trim()
            out == "0" || out.contains("uid=0")
        } else {
            proc.destroyForcibly()
            false
        }
    } catch (t: Throwable) {
        Timber.d(t, "WeChatFridaInjector: su probe failed")
        false
    }

    private fun defaultSuExec(cmd: String, timeoutMs: Long): Boolean = try {
        val proc = ProcessBuilder("su", "-c", cmd).redirectErrorStream(true).start()
        val finished = proc.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished) {
            proc.destroyForcibly()
            false
        } else {
            val ok = proc.exitValue() == 0
            if (!ok) {
                val tail = proc.inputStream.bufferedReader().readText().take(500)
                Timber.w("WeChatFridaInjector: suExec failed (exit=${proc.exitValue()}): %s", tail)
            }
            ok
        }
    } catch (t: Throwable) {
        Timber.w(t, "WeChatFridaInjector: suExec threw")
        false
    }

    /**
     * Get WeChat's PID via `su -c pidof com.tencent.mm`. Returns the
     * primary PID (first whitespace-separated token); WeChat sub-processes
     * (push / web / etc.) get a different uid and aren't hooked anyway.
     */
    internal fun pidofWechat(): Int? {
        return try {
            val proc = ProcessBuilder("su", "-c", "pidof com.tencent.mm")
                .redirectErrorStream(true)
                .start()
            if (!proc.waitFor(5_000, TimeUnit.MILLISECONDS)) {
                proc.destroyForcibly()
                return null
            }
            val out = proc.inputStream.bufferedReader().readText().trim()
            if (out.isEmpty()) null
            else out.split(Regex("\\s+")).firstOrNull()?.toIntOrNull()
        } catch (t: Throwable) {
            Timber.w(t, "WeChatFridaInjector: pidof threw")
            null
        }
    }

    /** Test seam — override for fake pidof. */
    internal var pidofImpl: () -> Int? = ::pidofWechat

    private fun cleanupTmp(vararg paths: String) {
        // Best-effort cleanup. /data/local/tmp persists across reboots so
        // leaving stale files there is a forensics liability.
        val script = paths.joinToString(" ; ") { "rm -f $it" }
        // Function-type call (var suExec is (String, Long) -> Boolean) — no named args.
        try { suExec(script, 5_000) } catch (_: Throwable) { /* ignore */ }
    }

    // ─── ABI detection ──────────────────────────────────────────────────────

    /**
     * Pick the matching frida-inject binary variant for this device. We
     * ship 2 ABIs (arm64-v8a, armeabi-v7a) which cover ~99.9% of devices
     * shipping Android 9+. armv5/x86/x86_64 fall back to BinaryMissing.
     */
    internal fun primaryArch(): String {
        val abis = Build.SUPPORTED_ABIS
        return when {
            abis.contains("arm64-v8a") -> "arm64"
            abis.contains("armeabi-v7a") -> "arm"
            else -> "unknown"  // Triggers BinaryMissing — no x86 build shipped
        }
    }

    // ─── asset reader (DI seam) ─────────────────────────────────────────────

    interface AssetReader {
        fun exists(path: String): Boolean
        fun copyTo(path: String, dst: File)
    }

    private class ContextAssetReader(private val context: Context) : AssetReader {
        override fun exists(path: String): Boolean {
            // Expression body cannot contain `return` (Kotlin spec) — use block.
            // listAssets parent dir + filter to avoid open() on missing file,
            // which throws FileNotFoundException (caller has to catch).
            return try {
                val parent = path.substringBeforeLast('/', "")
                val name = path.substringAfterLast('/')
                val siblings = context.assets.list(parent) ?: return false
                siblings.contains(name)
            } catch (t: Throwable) {
                Timber.d(t, "WeChatFridaInjector.AssetReader.exists($path) threw")
                false
            }
        }

        override fun copyTo(path: String, dst: File) {
            context.assets.open(path).use { input ->
                dst.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
        }
    }
}
