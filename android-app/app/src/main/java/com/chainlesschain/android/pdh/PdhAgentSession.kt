package com.chainlesschain.android.pdh

import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.feature.localterminal.PtyEnvironment
import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute
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

        // §3.5.9 三类信任卡 — agent 在写工具/事务前发 approval_request 并阻塞
        // (--interactive-approvals);裁决回显 approval_resolved。引导卡来自工具
        // 返回的 assist_required(tool_result 中间态)。计划卡来自 plan_update。
        /** 预览卡 / 审批卡:有副作用工具的审批请求(按 [tool] 名分流)。 */
        data class ApprovalRequest(
            val id: String,
            val tool: String,
            val summary: String,
            val risk: String?,
        ) : PdhAgentEvent()
        /** 审批裁决回显 → UI 收起对应卡。 */
        data class ApprovalResolved(val id: String, val approved: Boolean) : PdhAgentEvent()
        /** 计划卡(Plan Mode):当前计划项 + 阶段。 */
        data class PlanUpdate(val items: List<String>, val phase: String) : PdhAgentEvent()
        /** 引导卡:采集前置缺失,需人在 App 内完成一步(§3.6)。 */
        data class AssistRequired(
            val instruction: String,
            val deepLink: String?,
            val resumeToken: String?,
            val reason: String?,
        ) : PdhAgentEvent()
        /** §3.5.13: cc 已收到并处理某轮反馈(纠正卡)→ UI 确认该轮标记。 */
        data class FeedbackAck(val turnId: String?, val kind: String) : PdhAgentEvent()
        /** §3.5.15: cc 已收到 resume(引导卡)→ UI 收起对应引导卡。 */
        data class ResumeAck(val token: String?, val action: String) : PdhAgentEvent()
    }

    /** §3.5.13 自学习纠正信号类别(人对 AI 某轮回应的反馈)。 */
    enum class FeedbackKind { POSITIVE, NEGATIVE, CORRECTION }

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
                // §3.5.9: emit approval_request + block writes/transactions until
                // the UI sends {"type":"approval",id,approve} — backs the 预览/审批卡.
                add("--interactive-approvals")
                // `cc agent` defaults to provider=ollama (localhost:11434, absent
                // on the device) and ignores config.json's llm.provider — unlike
                // `cc ask`. Pass the user's configured provider+model explicitly
                // so the agent uses the same cloud LLM as the app's AI chat. The
                // API key still arrives via PtyEnvironment env injection.
                addAll(llmArgs())
                // PDH persona: make the agent a personal-data steward (not the
                // default coding assistant) that prefers the mcp__pdh__* tools.
                add("--append-system-prompt"); add(PDH_SYSTEM_PROMPT)
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

    /**
     * Send one user turn (NDJSON `{"type":"user","text":…}`). No-op if not running.
     * §3.5.10 接线4/6: an optional [llm] override routes THIS turn to a different
     * model (e.g. 云 → 局域网 Ollama) without restarting the session; null = use
     * the session default.
     */
    suspend fun send(
        text: String,
        llm: PdhRouteBridge.LlmOverride? = null,
    ): Boolean = sendRaw(
        buildJsonObject {
            put("type", "user")
            put("text", text)
            if (llm != null) {
                put(
                    "llm",
                    buildJsonObject {
                        put("provider", llm.provider)
                        put("model", llm.model)
                        put("baseUrl", llm.baseUrl)
                    },
                )
            }
        },
    )

    /**
     * §3.5.9: approve/deny an `approval_request` (预览卡 / 审批卡) →
     * `{"type":"approval","id":…,"approve":…}`. cc unblocks the gated tool.
     */
    suspend fun sendApproval(id: String, approve: Boolean): Boolean = sendRaw(
        buildJsonObject {
            put("type", "approval")
            put("id", id)
            put("approve", approve)
        },
    )

    /**
     * §3.5.9: plan-card control → `{"type":"plan","action":…}`
     * (`approve` | `reject` | `enter`).
     */
    suspend fun sendPlan(action: String): Boolean = sendRaw(
        buildJsonObject {
            put("type", "plan")
            put("action", action)
        },
    )

    /**
     * §3.5.13: send a self-learning correction signal → `{"type":"feedback",…}`.
     * The cc side feeds it to the end-side learning layer (module 84 OutcomeFeedback
     * / instinct) — that consumption is cc-bound; this is the Android capture+send half.
     */
    suspend fun sendFeedback(
        turnId: String,
        kind: FeedbackKind,
        comment: String? = null,
    ): Boolean = sendRaw(feedbackEvent(turnId, kind, comment))

    /**
     * §3.5.15: structured resume for a 引导卡 → `{"type":"resume","token":…,"action":…}`
     * (`completed` | `skip`). Deterministically tells cc to re-invoke the assist_required
     * tool with the token (vs §3.5.9's user-turn placeholder). cc-side routing is cc-bound.
     */
    suspend fun sendResume(token: String, action: String): Boolean =
        sendRaw(resumeEvent(token, action))

    /** Write one NDJSON input event to the agent's stdin. No-op if not running. */
    private suspend fun sendRaw(obj: JsonObject): Boolean = withContext(Dispatchers.IO) {
        val w = writer ?: return@withContext false
        if (!isRunning) return@withContext false
        try {
            w.write(obj.toString())
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

    /**
     * §3.5.10 接线3: the privacy route this session's cc-agent LLM actually runs
     * on, for the top-bar data-flow badge. Honest 云 vs 自有设备 — the cc-agent
     * chat always uses a network provider (端侧 MediaPipe is a separate, non-cc
     * path), so the badge surfaces whether data leaves the phone.
     */
    fun currentRoute(): LlmRoute =
        routeForProvider(runCatching { llmConfig.getProvider() }.getOrDefault(LLMProvider.OLLAMA))

    companion object {
        private const val TAG = "PdhAgentSession"
        const val ENV_PDH_PORT = "CHAINLESSCHAIN_PDH_PORT"
        const val DEFAULT_BRIDGE_PORT = 18510

        /**
         * §3.5.10 pure: App LLM provider → privacy route. A self-hosted Ollama is
         * your own PC/LAN box (rank 1, 不出私域);every third-party cloud provider
         * leaves the device to a 第三方云 (rank 2). CUSTOM is treated as cloud
         * (conservative — never under-claim privacy). No Android deps, testable.
         */
        fun routeForProvider(p: LLMProvider): LlmRoute = when (p) {
            LLMProvider.OLLAMA -> LlmRoute.PC_LOCAL
            else -> LlmRoute.CLOUD_ANDROID
        }

        /** §3.5.13 pure: build the `{type:feedback}` event (testable). */
        fun feedbackEvent(turnId: String, kind: FeedbackKind, comment: String?): JsonObject =
            buildJsonObject {
                put("type", "feedback")
                put("turn_id", turnId)
                put("kind", kind.name.lowercase())
                if (!comment.isNullOrBlank()) put("comment", comment)
            }

        /** §3.5.15 pure: build the `{type:resume}` event (testable). */
        fun resumeEvent(token: String, action: String): JsonObject =
            buildJsonObject {
                put("type", "resume")
                put("token", token)
                put("action", action)
            }

        /** Appended to cc agent's default prompt so it acts as a PDH steward. */
        val PDH_SYSTEM_PROMPT =
            """
            你是「个人数据助手」——帮用户管理 ta 自己手机上的个人数据。你的本职是用
            mcp__pdh__* 工具采集、查询、分析用户的个人数据(系统数据 / 本地文件 / 各 App
            数据),把散落在各处的数据汇入用户本地的个人数据库(vault),让用户重新掌握
            自己的数据主权。
            - 遇到"采集 / 查询 / 分析个人数据"类请求,优先调用 mcp__pdh__* 工具,而不是当
              通用编程助手或凭空回答。
            - 个人数据有两类来源,常需**结合**使用,不是非此即彼:
              ① 本地库(设备上已存的):collect_app_data_root 直读 App 本地 SQLite、
                 salvage_app_data root 内存打捞 IM —— 拿离线/历史/本地缓存。
              ② API(用 cookie/token 取云端):collect_app_data 批量采、query_app_data 实时查
                 —— 拿最新、本地没存、或需服务端才有的数据。
              先想清这个任务要什么数据、在哪一类来源,再选工具;有些任务要两者结合
              (例:总结「我的微博活动」可能既要本地缓存又要 API 拉最新),就都调、把数据凑齐。
            - 尽量自主、多法尝试与结合,目标是「把任务需要的数据凑齐」:某条路返回
              assist_required 时,先在已 root 的设备上自动换另一条(本地库↔API)再试,
              多法都拿不到才考虑引导用户。能自动完成就别打扰用户。
            - 用户问「我最近发的微博 / 我收藏了啥 / 我关注了谁」这类具体问题时,优先用
              query_app_data 实时查 API(直接拿答案),而不是先批量采集。
            - 只有所有自动方法都失败、确实需要用户配合(登录 / 打开 App / 授权 / root)时,才把
              assist_required 的指引简短转达,等用户完成后重试该工具——这是最后手段,不是第一反应。
            - 诚实:工具采到 0 条或失败就如实告知,绝不编造数据。
            - 隐私:这些是用户的私人数据,只在本机处理,不外传。
            - 用中文、简洁地回复。
            """.trimIndent()

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
                "tool_result" -> {
                    val content = toolResultText(obj)
                    // §3.6/§3.5.9: a tool may return status:assist_required as its
                    // result — surface it as a 引导卡, not a plain tool result.
                    parseAssist(content) ?: PdhAgentEvent.ToolResult(content)
                }
                // §3.5.9 trust cards (--interactive-approvals + plan mode).
                "approval_request" -> PdhAgentEvent.ApprovalRequest(
                    id = str(obj, "id"),
                    tool = str(obj, "tool"),
                    summary = str(obj, "command")
                        .ifEmpty { str(obj, "reason") }
                        .ifEmpty { str(obj, "tool") },
                    risk = str(obj, "risk").ifEmpty { null },
                )
                "approval_resolved" -> PdhAgentEvent.ApprovalResolved(
                    id = str(obj, "id"),
                    approved = bool(obj, "approved"),
                )
                "plan_update" -> PdhAgentEvent.PlanUpdate(
                    items = (obj["items"] as? JsonArray)
                        ?.mapNotNull { (it as? JsonObject)?.let { o -> str(o, "title") } }
                        ?.filter { it.isNotEmpty() }
                        ?: emptyList(),
                    phase = str(obj, "state"),
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
                // §3.5.13/§3.5.15: cc acks the chat's feedback/resume events so
                // the UI can confirm the mark / dismiss the 引导卡 authoritatively.
                "feedback_ack" -> PdhAgentEvent.FeedbackAck(
                    turnId = str(obj, "turn_id").ifEmpty { null },
                    kind = str(obj, "kind"),
                )
                "resume_ack" -> PdhAgentEvent.ResumeAck(
                    token = str(obj, "token").ifEmpty { null },
                    action = str(obj, "action"),
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

        /**
         * Extract a tool_result's textual content. cc (headless-stream) emits the
         * content under `result` as the MCP shape `{content:[{type:text,text:…}]}`
         * — NOT a top-level `content`/`text` field. Concatenate the text blocks;
         * fall back to a plain-string `result`, then to legacy `content`/`text`.
         * Without this the assist_required JSON never reaches [parseAssist] (no
         * 引导卡) and DATA rows are always empty.
         */
        private fun toolResultText(obj: JsonObject): String {
            val result = obj["result"]
            if (result is JsonObject) {
                (result["content"] as? JsonArray)?.let { arr ->
                    val sb = StringBuilder()
                    for (el in arr) {
                        val b = el as? JsonObject ?: continue
                        if (str(b, "type") == "text") sb.append(str(b, "text"))
                    }
                    if (sb.isNotEmpty()) return sb.toString()
                }
            }
            (result as? JsonPrimitive)?.takeIf { it.isString }?.let { return it.content }
            return str(obj, "content").ifEmpty { str(obj, "text") }
        }

        /**
         * §3.6/§3.5.9: a tool_result whose content is a JSON object with
         * `status:"assist_required"` → [PdhAgentEvent.AssistRequired]; else null
         * (a normal tool result). Pure + liberal.
         */
        fun parseAssist(content: String): PdhAgentEvent.AssistRequired? {
            val c = content.trim()
            if (c.isEmpty() || c[0] != '{') return null
            val o = try {
                json.parseToJsonElement(c).jsonObject
            } catch (_: Throwable) {
                return null
            }
            if (str(o, "status") != "assist_required") return null
            return PdhAgentEvent.AssistRequired(
                instruction = str(o, "instruction"),
                deepLink = str(o, "deepLink").ifEmpty { null },
                resumeToken = str(o, "resumeToken").ifEmpty { null },
                reason = str(o, "reason").ifEmpty { null },
            )
        }

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
