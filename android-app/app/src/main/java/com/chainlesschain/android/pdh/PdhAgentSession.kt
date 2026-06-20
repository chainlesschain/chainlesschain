package com.chainlesschain.android.pdh

import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.feature.localterminal.PtyEnvironment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import timber.log.Timber
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 2 (module 101) — a persistent `cc agent` stream-json duplex session for
 * the PDH single-input-box Chat. Unlike [LocalCcRunner] (one-shot `cc hub`),
 * this keeps `cc agent --input-format stream-json --output-format stream-json`
 * alive: writes one NDJSON user event per turn to stdin, reads NDJSON agent
 * events from stdout, and surfaces them as [PdhAgentEvent].
 *
 * PDH bridge wiring: injects `CHAINLESSCHAIN_PDH_PORT` so the in-APK cc agent
 * auto-discovers the App's own PDH bridge (same process, [PdhBridgeServer] on
 * 18510) and gains the `mcp__pdh__*` collect tools. The env fast-path (not the
 * `--pdh` flag) is used so an older cc bundle without pdh-bridge.js still runs
 * the chat (the env var is simply ignored); a refreshed bundle additionally
 * gets the PDH tools. Discovery also works via the lockfile the bridge writes
 * under the cc HOME, so the env is belt-and-suspenders.
 *
 * Uses a raw [ProcessBuilder] (not a PTY) because stream-json is a clean byte
 * duplex — a TTY would echo/mangle the NDJSON. Mirrors LocalCcRunner's W^X /
 * SELinux workaround: execve `mksh` and pass `cc` as a script argument.
 *
 * Android-bound (cc subprocess) → the chat runs on-device with the shipped
 * bundle; the PDH tool calls light up after a bundle refresh.
 */
@Singleton
class PdhAgentSession @Inject constructor(
    private val bootstrapper: LocalFilesystemBootstrapper,
    private val ptyEnvironment: PtyEnvironment,
) {

    /** Parsed cc-agent stream-json output events (liberal — unknown types ignored). */
    sealed class PdhAgentEvent {
        /** Assistant text (delta or full chunk). */
        data class Text(val text: String) : PdhAgentEvent()
        /** A tool the agent is invoking (e.g. mcp__pdh__collect_files). */
        data class ToolUse(val name: String, val input: String?) : PdhAgentEvent()
        /** A tool's result content. */
        data class ToolResult(val content: String) : PdhAgentEvent()
        /** Turn finished — final text (may be empty if already streamed). */
        data class Result(val text: String, val isError: Boolean) : PdhAgentEvent()
        /** Session/transport error. */
        data class Error(val message: String) : PdhAgentEvent()
        /** Process exited. */
        data class Exit(val code: Int) : PdhAgentEvent()
    }

    private val _events = MutableSharedFlow<PdhAgentEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<PdhAgentEvent> = _events.asSharedFlow()

    private var process: Process? = null
    private var writer: OutputStreamWriter? = null
    private var readerJob: Job? = null
    private var exitJob: Job? = null

    /** True once [start] has a live process. */
    val isRunning: Boolean get() = process?.isAlive == true

    /**
     * Boots the cc filesystem and spawns the agent. Returns failure if the
     * bootstrap or spawn fails. Safe to call once; call [close] before re-start.
     */
    suspend fun start(scope: CoroutineScope, bridgePort: Int = DEFAULT_BRIDGE_PORT): Result<Unit> =
        withContext(Dispatchers.IO) {
            if (isRunning) return@withContext Result.success(Unit)
            val ensure = bootstrapper.bootstrap()
            if (ensure.isFailure) {
                return@withContext Result.failure(
                    ensure.exceptionOrNull() ?: IllegalStateException("bootstrap-failed"),
                )
            }
            val ccPath = File(bootstrapper.prefixDir, "bin/cc")
            val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")

            // W^X: execve mksh (a whitelisted .so symlink), pass cc as a script arg.
            val command = listOf(
                mkshPath.absolutePath,
                ccPath.absolutePath,
                "agent",
                "--input-format", "stream-json",
                "--output-format", "stream-json",
            )
            // PDH bridge auto-discovery for the in-APK agent (env fast-path).
            val envList = ptyEnvironment
                .envp(extra = mapOf(ENV_PDH_PORT to bridgePort.toString()))
                .toList()

            val proc = try {
                ProcessBuilder(command).apply {
                    val envMap = environment()
                    envMap.clear()
                    for (kv in envList) {
                        val eq = kv.indexOf('=')
                        if (eq > 0) envMap[kv.substring(0, eq)] = kv.substring(eq + 1)
                    }
                    redirectErrorStream(false)
                    directory(bootstrapper.homeDir)
                }.start()
            } catch (t: Throwable) {
                Timber.tag(TAG).e(t, "spawn cc agent failed")
                return@withContext Result.failure(t)
            }

            process = proc
            writer = OutputStreamWriter(proc.outputStream, Charsets.UTF_8)

            readerJob = scope.launch(Dispatchers.IO) {
                val reader = BufferedReader(InputStreamReader(proc.inputStream, Charsets.UTF_8))
                try {
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        val parsed = parseLine(line!!) ?: continue
                        _events.emit(parsed)
                    }
                } catch (t: Throwable) {
                    Timber.tag(TAG).w(t, "stdout reader stopped")
                } finally {
                    runCatching { reader.close() }
                }
            }
            exitJob = scope.launch(Dispatchers.IO) {
                val code = runCatching { proc.waitFor() }.getOrDefault(-1)
                _events.emit(PdhAgentEvent.Exit(code))
            }
            Result.success(Unit)
        }

    /** Send one user turn (NDJSON `{"type":"user","text":…}`). No-op if not running. */
    suspend fun send(text: String): Boolean = withContext(Dispatchers.IO) {
        val w = writer ?: return@withContext false
        if (!isRunning) return@withContext false
        val payload = JSONObject().put("type", "user").put("text", text).toString()
        try {
            w.write(payload)
            w.write("\n")
            w.flush()
            true
        } catch (t: Throwable) {
            Timber.tag(TAG).w(t, "send failed")
            false
        }
    }

    /** Stops the agent and releases the process. */
    suspend fun close() = withContext(Dispatchers.IO) {
        runCatching { writer?.close() }
        runCatching { process?.destroy() }
        readerJob?.cancel()
        exitJob?.cancel()
        process = null
        writer = null
        readerJob = null
        exitJob = null
    }

    companion object {
        private const val TAG = "PdhAgentSession"
        const val ENV_PDH_PORT = "CHAINLESSCHAIN_PDH_PORT"
        const val DEFAULT_BRIDGE_PORT = 18510

        /**
         * Pure: one NDJSON stream-json output line → a [PdhAgentEvent], or null
         * to skip (blank / unknown / control events). Liberal field reading so
         * minor cc-side schema drift doesn't break the chat.
         */
        fun parseLine(line: String): PdhAgentEvent? {
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed[0] != '{') return null
            val obj = try {
                JSONObject(trimmed)
            } catch (_: Throwable) {
                return null
            }
            return when (obj.optString("type")) {
                "text", "assistant", "assistant_delta" -> {
                    val t = textOf(obj)
                    if (t.isEmpty()) null else PdhAgentEvent.Text(t)
                }
                "tool_use" -> PdhAgentEvent.ToolUse(
                    name = obj.optString("name").ifEmpty { obj.optString("tool") },
                    input = obj.opt("input")?.toString(),
                )
                "tool_result" -> PdhAgentEvent.ToolResult(
                    content = obj.optString("content").ifEmpty { obj.optString("text") },
                )
                "result" -> PdhAgentEvent.Result(
                    text = textOf(obj),
                    isError = obj.optBoolean("is_error", false) ||
                        obj.optString("subtype").contains("error"),
                )
                "error" -> PdhAgentEvent.Error(
                    obj.optString("message").ifEmpty { obj.optString("error").ifEmpty { "error" } },
                )
                else -> null // system/init/token_usage/etc. — not surfaced
            }
        }

        /** Pull assistant text from the several shapes cc may emit. */
        private fun textOf(obj: JSONObject): String {
            obj.optString("text").takeIf { it.isNotEmpty() }?.let { return it }
            obj.optString("content").takeIf { it.isNotEmpty() }?.let { return it }
            val msg = obj.optJSONObject("message") ?: return ""
            msg.optString("content").takeIf { it.isNotEmpty() }?.let { return it }
            val arr = msg.optJSONArray("content") ?: return ""
            val sb = StringBuilder()
            for (i in 0 until arr.length()) {
                val block = arr.optJSONObject(i) ?: continue
                if (block.optString("type") == "text") sb.append(block.optString("text"))
            }
            return sb.toString()
        }
    }
}
