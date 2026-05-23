package com.chainlesschain.android.pdh.llm

/**
 * A3.3 — abstraction over the local LLM inference backend.
 *
 * Decouples [LocalLlmServer] from any specific native binding so we can:
 *  - Ship the Ktor server + cc wiring (A3.2 + A3.5) without a real
 *    kotlinllamacpp dep resolved
 *  - Swap engines (kotlinllamacpp / mediapipe-llm / mlc-llm) without
 *    touching server / cc layers
 *  - Unit-test with [NoOpLlmInferenceEngine] in JVM mode (no JNI required)
 *
 * Contract:
 *  - `chat(messages, opts)` returns the full assistant response. Streaming
 *    (SSE) is v0.2 — current Ollama-compat /api/chat with `stream: false`
 *    expects a single non-streaming response, which matches this signature.
 *  - `health()` reports whether the engine is loaded and ready to inference.
 *    The Ktor server probes this on /api/tags so cc can detect "is model
 *    loaded" before queueing user questions.
 *  - `isLocal` is always true for any engine implementing this interface —
 *    by construction it runs on-device. Mirrors LLMClient.isLocal in
 *    packages/personal-data-hub/lib/llm-client.js §"privacy invariant".
 */
interface LlmInferenceEngine {

    /** Human-readable backend label surfaced in /api/tags + audit. */
    val name: String

    /** Always true — implementations run on-device by construction. */
    val isLocal: Boolean get() = true

    /**
     * Whether the underlying native/binding layer is loaded and could in
     * principle run inference (given a model). Surfaces independently of
     * [health] because the latter does file I/O and is suspend; this is a
     * cheap synchronous probe the UI can read from a ViewModel init block.
     *
     * Default `true` for pure-JVM engines. Native-backed impls
     * (KotlinLlamaCppEngine etc.) override to reflect actual .so load state.
     */
    val nativeReady: Boolean get() = true

    /** Whether the engine has loaded its model and can answer questions. */
    suspend fun health(): HealthStatus

    /**
     * Single-shot chat completion. Returns the full assistant message text.
     *
     * @param messages Ordered { role, content } turns. The implementation
     *                 stitches into a prompt per its native chat template.
     * @param opts Optional inference params (temperature / max_tokens / etc).
     * @throws LlmInferenceException for any backend failure. Caller surfaces.
     */
    suspend fun chat(messages: List<ChatMessage>, opts: ChatOptions = ChatOptions()): ChatResponse

    data class ChatMessage(val role: String, val content: String)

    data class ChatOptions(
        val temperature: Float = 0.2f,
        val maxTokens: Int = 512,
        val numCtx: Int = 4096,
    )

    data class ChatResponse(
        val text: String,
        val promptTokens: Int = 0,
        val completionTokens: Int = 0,
        val totalDurationMs: Long = 0L,
    )

    data class HealthStatus(
        val ready: Boolean,
        val modelLoaded: Boolean,
        val modelName: String?,
        val reason: String?,
    )
}

class LlmInferenceException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Default fallback. Reports `ready=false` and refuses chat calls with a
 * clear "engine not wired" message. Used in:
 *  - Hilt module default (until a real engine impl is provided)
 *  - Unit tests for [LocalLlmServer] route shape
 *  - CI compile target (no JitPack/Sonatype resolution required)
 */
object NoOpLlmInferenceEngine : LlmInferenceEngine {
    override val name = "noop-llm"

    override val nativeReady: Boolean = false

    override suspend fun health(): LlmInferenceEngine.HealthStatus =
        LlmInferenceEngine.HealthStatus(
            ready = false,
            modelLoaded = false,
            modelName = null,
            reason = "engine not wired — NoOp fallback (默认 @Binds 已切到 MediaPipeLlmEngine)",
        )

    override suspend fun chat(
        messages: List<LlmInferenceEngine.ChatMessage>,
        opts: LlmInferenceEngine.ChatOptions,
    ): LlmInferenceEngine.ChatResponse {
        throw LlmInferenceException(
            "本机 LLM 推理引擎未就绪 — NoOp fallback (默认 @Binds 已切到 MediaPipeLlmEngine)"
        )
    }
}
