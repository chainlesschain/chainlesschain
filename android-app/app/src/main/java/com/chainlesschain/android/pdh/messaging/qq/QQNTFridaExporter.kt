package com.chainlesschain.android.pdh.messaging.qq

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
 * module 101 QQNT 采集方案 Phase 1 — Method C frida online decrypt for QQNT.
 *
 * Borrows QQ's own keyed SQLCipher connection (`sqlcipher_export`) to write a
 * **plaintext** copy of `nt_msg.db` (+ group_info/profile_info) — the same trick
 * the user ran manually to produce their `*_decrypted.db`. Mirrors
 * [com.chainlesschain.android.pdh.social.wechat.WeChatFridaInjector]'s staging +
 * spawn + stdout-parse + cleanup, but parses `{"kind":"export"}` lines instead
 * of a key.
 *
 * Flow: stage `frida-inject-<abi>` + `qqnt-sqlcipher-export.js` to
 * `/data/local/tmp` (W^X: can't exec from filesDir) → pidof QQ → mkdir dec →
 * spawn frida-inject → collect exported plaintext paths until timeout.
 *
 * **Honest scope**: QQ ships `libmsaoaidsec` (anti-debug, Douyin family). When
 * attach is blocked we return [Result.AntiFridaSuspected] rather than fighting
 * it. Requires QQ foregrounded into 「消息」 so the IM plugin has queried nt_msg.db
 * (else the keyed connection never appears → [Result.NoExport]).
 *
 * Test seams ([assetReader]/[suExec]/[pidof]/[isSuAvailable]/[spawn]) let unit
 * tests drive the orchestration without a device.
 */
@Singleton
class QQNTFridaExporter @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    sealed class Result {
        /** Plaintext copies written under /data/local/tmp/dec (absolute paths). */
        data class Ok(val plaintextPaths: List<String>) : Result()
        object NoRoot : Result()
        object AppNotRunning : Result()
        object BinaryMissing : Result()
        object AntiFridaSuspected : Result()
        object NoExport : Result()
        data class Failed(val reason: String, val message: String? = null) : Result()
    }

    suspend fun export(timeoutMs: Long = 45_000): Result = withContext(Dispatchers.IO) {
        if (!isSuAvailable()) return@withContext Result.NoRoot

        val abi = (Build.SUPPORTED_ABIS.firstOrNull() ?: "")
        val binAsset = if (abi.contains("arm64") || abi.contains("aarch64")) {
            "frida/frida-inject-arm64"
        } else {
            "frida/frida-inject-arm"
        }
        val binBytes = assetReader(binAsset) ?: return@withContext Result.BinaryMissing
        val jsBytes = assetReader(AGENT_JS) ?: return@withContext Result.BinaryMissing

        val pid = pidof(QQ_PKG) ?: return@withContext Result.AppNotRunning

        // 1. Stage binary + agent to /data/local/tmp (exec-allowed under W^X).
        val localBin = "$TMP/cc-fj"
        val localJs = "$TMP/cc-qqnt-export.js"
        if (!stage(binBytes, localBin, exec = true) || !stage(jsBytes, localJs, exec = false)) {
            return@withContext Result.Failed("stage-failed", "could not copy frida assets to $TMP")
        }
        suExec("rm -rf $DEC && mkdir -p $DEC && chmod 777 $DEC", 5_000)

        // 2. Spawn frida-inject and collect {"kind":"export"} lines.
        val cmd = "$localBin -p $pid -s $localJs --runtime=v8"
        val exported = LinkedHashSet<String>()
        var sawReady = false
        var sawHook = false
        try {
            val proc = spawn(cmd)
            val deadline = System.currentTimeMillis() + timeoutMs
            proc.inputStream.bufferedReader().use { reader ->
                while (System.currentTimeMillis() < deadline) {
                    val line = reader.readLine() ?: break
                    val obj = parseJsonLine(line) ?: continue
                    when (obj.optString("kind")) {
                        "ready" -> sawReady = true
                        "hook" -> sawHook = true
                        "export" -> if (obj.optInt("rc", -1) == 0) {
                            obj.optString("out").takeIf { it.isNotBlank() }?.let { exported.add(it) }
                        }
                    }
                    // nt_msg is the one we need; stop once it's out.
                    if (exported.any { it.contains("nt_msg") }) break
                }
            }
            try { proc.destroyForcibly() } catch (_: Throwable) {}
        } catch (t: Throwable) {
            Timber.w(t, "QQNTFridaExporter: spawn/read failed")
            return@withContext Result.Failed("spawn-failed", t.message)
        } finally {
            // never leave an attached frida-inject (anti-detection + battery).
            suExec("pkill -9 -f cc-qqnt-export.js ; rm -f $localJs", 5_000)
        }

        when {
            exported.isNotEmpty() -> Result.Ok(exported.toList())
            // injected + hooked but no keyed connection seen → QQ not in 消息页
            sawReady || sawHook -> Result.NoExport
            // never even got ready → almost certainly anti-frida blocked the attach
            else -> Result.AntiFridaSuspected
        }
    }

    private fun stage(bytes: ByteArray, dst: String, exec: Boolean): Boolean {
        // asset → app filesDir → su cp to /data/local/tmp (app can't write tmp directly).
        val tmpLocal = File(context.filesDir, ".qqnt-stage").apply { if (exists()) delete() }
        return try {
            tmpLocal.writeBytes(bytes)
            val mode = if (exec) "0755" else "0644"
            val ok = suExec("cp ${tmpLocal.absolutePath} $dst && chmod $mode $dst", 15_000)
            tmpLocal.delete()
            ok
        } catch (t: Throwable) {
            Timber.w(t, "QQNTFridaExporter.stage failed for $dst")
            false
        }
    }

    private fun parseJsonLine(line: String): JSONObject? {
        val s = line.trim()
        val i = s.indexOf('{')
        if (i < 0) return null
        return try { JSONObject(s.substring(i)) } catch (_: Throwable) { null }
    }

    // ── test seams ───────────────────────────────────────────────────────────

    internal var assetReader: (path: String) -> ByteArray? = { path ->
        try { context.assets.open(path).use { it.readBytes() } } catch (_: Throwable) { null }
    }

    internal var isSuAvailable: () -> Boolean = {
        try {
            val p = ProcessBuilder("su", "-c", "id -u").redirectErrorStream(true).start()
            val ok = p.waitFor(3_000, TimeUnit.MILLISECONDS) && p.exitValue() == 0
            if (ok) p.inputStream.bufferedReader().readText().trim().let { it == "0" || it.contains("uid=0") }
            else { p.destroyForcibly(); false }
        } catch (_: Throwable) { false }
    }

    internal var pidof: (pkg: String) -> Int? = { pkg ->
        try {
            val p = ProcessBuilder("su", "-c", "pidof $pkg").redirectErrorStream(true).start()
            p.waitFor(5_000, TimeUnit.MILLISECONDS)
            p.inputStream.bufferedReader().readText().trim().split(Regex("\\s+"))
                .firstOrNull()?.toIntOrNull()
        } catch (_: Throwable) { null }
    }

    internal var suExec: (cmd: String, timeoutMs: Long) -> Boolean = { cmd, timeoutMs ->
        try {
            val p = ProcessBuilder("su", "-c", cmd).redirectErrorStream(true).start()
            if (p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) p.exitValue() == 0
            else { p.destroyForcibly(); false }
        } catch (_: Throwable) { false }
    }

    internal var spawn: (cmd: String) -> Process = { cmd ->
        ProcessBuilder("su", "-c", cmd).redirectErrorStream(true).start()
    }

    companion object {
        const val QQ_PKG = "com.tencent.mobileqq"
        private const val TMP = "/data/local/tmp"
        const val DEC = "/data/local/tmp/dec"
        private const val AGENT_JS = "frida/qqnt-sqlcipher-export.js"
    }
}
