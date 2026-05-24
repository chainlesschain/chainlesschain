package com.chainlesschain.android.pdh.llm

import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import timber.log.Timber
import java.io.IOException
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A3.2 — Kotlin-hosted Ollama-compat HTTP server on 127.0.0.1.
 *
 * Routes:
 *  - POST /api/chat → relay to [LlmInferenceEngine.chat], shape per
 *    https://github.com/ollama/ollama/blob/main/docs/api.md#chat-request-non-streaming
 *  - GET  /api/tags → list of "available models" (only the currently loaded
 *    engine, mirroring Ollama's /api/tags shape so OllamaClient.health() works)
 *
 * Why Ollama-compat: zero JS changes. packages/personal-data-hub/lib/
 * llm-client.js's OllamaClient hits this endpoint via CC_HUB_OLLAMA_URL env
 * (set by LocalCcRunner.askQuestion). See docs/design/PDH_A3_OnDevice_LLM.md
 * §3 architecture diagram.
 *
 * Port: starts at 18484 (Ollama 11434 % 10000 + 8000 — avoids collision with
 * a "real" Ollama instance the user might be running for testing). Falls
 * forward through 18484..18493 to find a free port. Captured into
 * [boundPort] for LocalCcRunner to read.
 */
@Singleton
class LocalLlmServer @Inject constructor(
    private val engine: LlmInferenceEngine,
) {
    private val basePort = 18484
    private val maxPortAttempts = 10

    @Volatile private var serverRef: AtomicReference<Any?> = AtomicReference(null)
    @Volatile private var actualPort: Int = -1

    /** Currently bound port, or -1 if not started. */
    val boundPort: Int get() = actualPort

    /** http://127.0.0.1:<port>, or null if not started. */
    val baseUrl: String? get() = actualPort.takeIf { it > 0 }?.let { "http://127.0.0.1:$it" }

    /**
     * Start the embedded server on the first available port in
     * [basePort, basePort+maxPortAttempts). Idempotent — if already running
     * returns the existing port.
     *
     * Blocking on bind only (millis). The Ktor engine itself runs on its own
     * coroutine pool. Safe to call from app startup / main thread for
     * lightweight bind validation.
     */
    @Synchronized
    fun start(): Result<Int> {
        if (actualPort > 0) {
            return Result.success(actualPort)
        }
        var lastErr: Throwable? = null
        for (offset in 0 until maxPortAttempts) {
            val candidate = basePort + offset
            if (!isPortAvailable(candidate)) continue
            try {
                val srv = embeddedServer(CIO, host = "127.0.0.1", port = candidate) {
                    install(ContentNegotiation) { json() }
                    routing {
                        get("/api/tags") {
                            val health = engine.health()
                            call.respond(
                                TagsResponse(
                                    models = if (health.modelLoaded && health.modelName != null) {
                                        listOf(TagModel(name = health.modelName, model = health.modelName))
                                    } else {
                                        emptyList()
                                    },
                                ),
                            )
                        }
                        post("/api/chat") {
                            val req = try {
                                call.receive<ChatRequest>()
                            } catch (t: Throwable) {
                                call.respond(
                                    HttpStatusCode.BadRequest,
                                    ChatErrorResponse(error = "malformed request: ${t.message}"),
                                )
                                return@post
                            }
                            handleChat(req, call::respond)
                        }
                    }
                }
                srv.start(wait = false)
                actualPort = candidate
                serverRef.set(srv)
                Timber.i("LocalLlmServer: started on 127.0.0.1:%d (engine=%s)", candidate, engine.name)
                return Result.success(candidate)
            } catch (t: Throwable) {
                lastErr = t
                Timber.w(t, "LocalLlmServer: bind on port %d failed, trying next", candidate)
            }
        }
        return Result.failure(
            IOException(
                "LocalLlmServer: no free port in [$basePort, ${basePort + maxPortAttempts}). " +
                    "Last: ${lastErr?.message ?: "n/a"}"
            )
        )
    }

    /** Idempotent stop. */
    @Synchronized
    fun stop() {
        val srv = serverRef.getAndSet(null) ?: return
        actualPort = -1
        try {
            // ApplicationEngine has stop(gracePeriodMillis, timeoutMillis); use minimal grace.
            val method = srv.javaClass.methods.firstOrNull { it.name == "stop" && it.parameterTypes.size == 2 }
            method?.invoke(srv, 100L, 500L)
                ?: Timber.w("LocalLlmServer: stop method not found on engine; leaking server ref")
        } catch (t: Throwable) {
            Timber.w(t, "LocalLlmServer: stop threw")
        }
    }

    private suspend fun handleChat(
        req: ChatRequest,
        respond: suspend (Any) -> Unit,
    ) {
        val messages = req.messages.orEmpty().map {
            LlmInferenceEngine.ChatMessage(role = it.role, content = it.content)
        }
        if (messages.isEmpty()) {
            respond(ChatErrorResponse(error = "messages array required and non-empty"))
            return
        }
        // MediaPipe `setMaxTokens` is the TOTAL context window (prompt + response),
        // not the output budget. Ollama's `num_ctx` matches that semantic; mapping
        // from `num_predict` (which is OUTPUT-only) was wrong and defaulted to 512,
        // causing MediaPipe `OUT_OF_RANGE: CalculatorGraph::Run() failed` → JNI
        // abort → SIGABRT (whole-process crash) the moment a PDH-gathered prompt
        // exceeded a handful of facts. See trap #22.
        val ctxWindow = req.options?.numCtx ?: 4096
        val opts = LlmInferenceEngine.ChatOptions(
            temperature = req.options?.temperature ?: 0.2f,
            maxTokens = ctxWindow,
            numCtx = ctxWindow,
        )
        try {
            val resp = engine.chat(messages, opts)
            respond(
                ChatSuccessResponse(
                    model = engine.name,
                    message = ChatRoleContent(role = "assistant", content = resp.text),
                    done = true,
                    promptEvalCount = resp.promptTokens,
                    evalCount = resp.completionTokens,
                    totalDuration = resp.totalDurationMs * 1_000_000L, // ms → ns per Ollama convention
                ),
            )
        } catch (e: LlmInferenceException) {
            // Ollama returns 200 with error field. cc OllamaClient detects this
            // as a failed call (no message.content). Surfaces clean to UI.
            respond(ChatErrorResponse(error = e.message ?: "inference failed"))
        } catch (t: Throwable) {
            Timber.e(t, "LocalLlmServer.chat: unexpected throwable")
            respond(ChatErrorResponse(error = "internal: ${t.message ?: t.javaClass.simpleName}"))
        }
    }

    private fun isPortAvailable(port: Int): Boolean = try {
        ServerSocket(port).use { it.localPort == port }
    } catch (_: IOException) {
        false
    }

    // ─── Ollama-compatible wire format ──────────────────────────────────────
    //
    // Mirrors https://github.com/ollama/ollama/blob/main/docs/api.md (chat /
    // tags). Fields are nullable where Ollama accepts absence; defaults
    // match Ollama's behavior so cc OllamaClient sees identical responses.

    @Serializable
    private data class ChatRequest(
        val model: String? = null,
        val messages: List<ChatRoleContent>? = null,
        val stream: Boolean? = false,
        val options: ChatOptionsBody? = null,
    )

    @Serializable
    private data class ChatRoleContent(val role: String, val content: String)

    @Serializable
    private data class ChatOptionsBody(
        val temperature: Float? = null,
        @kotlinx.serialization.SerialName("num_predict") val numPredict: Int? = null,
        @kotlinx.serialization.SerialName("num_ctx") val numCtx: Int? = null,
    )

    @Serializable
    private data class ChatSuccessResponse(
        val model: String,
        val message: ChatRoleContent,
        val done: Boolean,
        @kotlinx.serialization.SerialName("prompt_eval_count") val promptEvalCount: Int = 0,
        @kotlinx.serialization.SerialName("eval_count") val evalCount: Int = 0,
        @kotlinx.serialization.SerialName("total_duration") val totalDuration: Long = 0,
    )

    @Serializable
    private data class ChatErrorResponse(val error: String)

    @Serializable
    private data class TagsResponse(val models: List<TagModel>)

    @Serializable
    private data class TagModel(val name: String, val model: String)
}
