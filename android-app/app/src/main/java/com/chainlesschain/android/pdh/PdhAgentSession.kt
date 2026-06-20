package com.chainlesschain.android.pdh

import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
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
    private val llmConfig: LLMConfigManager,
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
    private var stderrJob: Job? = null
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
            val command = buildList {
                add(mkshPath.absolutePath)
                add(ccPath.absolutePath)
                add("agent")
                add("--input-format"); add("stream-json")
                add("--output-format"); add("stream-json")
                // `cc agent` defaults to provider=ollama (localhost:11434, absent
                // on the device) and ignores config.json's llm.provider — unlike
                // `cc ask`. Pass the user's configured provider+model explicitly
                // so the agent uses the same cloud LLM as the app's AI chat. The
                // API key still arrives via PtyEnvironment env injection.
                addAll(llmArgs())
            }
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
            // Read stderr too — cc prints the real failure reason there (e.g.
            // "✖ Failed: fetch failed" / "API key required …"). PdhAgentSession
            // otherwise only reads the NDJSON stdout, so the cause was lost and
            // the UI could only show a generic "turn ended with error".
            stderrJob = scope.launch(Dispatchers.IO) {
                val errReader = BufferedReader(InputStreamReader(proc.errorStream, Charsets.UTF_8))
                try {
                    var line: String?
                    while (errReader.readLine().also { line = it } != null) {
                        val l = line!!.trim()
                        if (l.isEmpty()) continue
                        if (l.contains("Failed") || l.contains("error", ignoreCase = true) ||
                            l.contains("required") || l.startsWith("✖")
                        ) {
                            _events.emit(PdhAgentEvent.Error(l.take(300)))
                        }
                    }
                } catch (t: Throwable) {
                    Timber.tag(TAG).w(t, "stderr reader stopped")
                } finally {
                    runCatching { errReader.close() }
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
        val payload = buildJsonObject {
            put("type", "user")
            put("text", text)
        }.toString()
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
        stderrJob?.cancel()
        exitJob?.cancel()
        process = null
        writer = null
        readerJob = null
        stderrJob = null
        exitJob = null
    }

    /**
     * `--provider/--model` for `cc agent`, from the app's LLM config so the
     * agent uses the same cloud LLM the user set in AI settings (cross-device,
     * no reliance on a hand-written config.json). Empty when unknown — then cc
     * falls back to its own resolution. The API key arrives via env injection.
     */
    private fun llmArgs(): List<String> = try {
        val provider = ccProviderName(llmConfig.getProvider())
        val model = llmConfig.getCurrentModel().trim()
        if (provider != null && model.isNotEmpty()) {
            listOf("--provider", provider, "--model", model)
        } else {
            emptyList()
        }
    } catch (t: Throwable) {
        Timber.tag(TAG).w(t, "llmArgs failed; cc agent uses its own LLM resolution")
        emptyList()
    }

    /** App [LLMProvider] -> cc CLI provider name (packages/cli llm-providers.js). */
    private fun ccProviderName(p: LLMProvider): String? = when (p) {
        LLMProvider.OPENAI -> "openai"
        LLMProvider.DEEPSEEK -> "deepseek"
        LLMProvider.CLAUDE -> "anthropic"
        LLMProvider.DOUBAO -> "volcengine"
        LLMProvider.QWEN -> "qwen"
        LLMProvider.ERNIE -> "ernie"
        LLMProvider.CHATGLM -> "chatglm"
        LLMProvider.MOONSHOT -> "moonshot"
        LLMProvider.SPARK -> "spark"
        LLMProvider.GEMINI -> "gemini"
        LLMProvider.OLLAMA -> "ollama"
        LLMProvider.CUSTOM -> null
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
        private val json = Json { ignoreUnknownKeys = true }

        fun parseLine(line: String): PdhAgentEvent? {
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed[0] != '{') return null
            val obj = try {
                json.parseToJsonElement(trimmed).jsonObject
            } catch (_: Throwable) {
                return null
            }
            return when (str(obj, "type")) {
                "text", "assistant", "assistant_delta" -> {
                    val t = textOf(obj)
                    if (t.isEmpty()) null else PdhAgentEvent.Text(t)
                }
                "tool_use" -> PdhAgentEvent.ToolUse(
                    name = str(obj, "name").ifEmpty { str(obj, "tool") },
                    input = obj["input"]?.toString(),
                )
                "tool_result" -> PdhAgentEvent.ToolResult(
                    content = str(obj, "content").ifEmpty { str(obj, "text") },
                )
                "result" -> PdhAgentEvent.Result(
                    // cc agent puts the final answer in the `result` field
                    // (not `text`); fall back to the streamed text shapes.
                    text = str(obj, "result").ifEmpty { textOf(obj) },
                    isError = bool(obj, "is_error") || str(obj, "subtype").contains("error"),
                )
                "error" -> PdhAgentEvent.Error(
                    str(obj, "message").ifEmpty { str(obj, "error").ifEmpty { "error" } },
                )
                else -> null // system/init/token_usage/etc. — not surfaced
            }
        }

        /** String value of a JSON field (string primitives only), else "". */
        private fun str(obj: JsonObject, key: String): String =
            (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""

        /** Boolean value of a JSON field, else false. */
        private fun bool(obj: JsonObject, key: String): Boolean =
            (obj[key] as? JsonPrimitive)?.booleanOrNull ?: false

        /** Pull assistant text from the several shapes cc may emit. */
        private fun textOf(obj: JsonObject): String {
            str(obj, "text").takeIf { it.isNotEmpty() }?.let { return it }
            str(obj, "content").takeIf { it.isNotEmpty() }?.let { return it }
            val msg = obj["message"] as? JsonObject ?: return ""
            str(msg, "content").takeIf { it.isNotEmpty() }?.let { return it }
            val arr = msg["content"] as? JsonArray ?: return ""
            val sb = StringBuilder()
            for (el in arr) {
                val block = el as? JsonObject ?: continue
                if (str(block, "type") == "text") sb.append(str(block, "text"))
            }
            return sb.toString()
        }
    }
}
