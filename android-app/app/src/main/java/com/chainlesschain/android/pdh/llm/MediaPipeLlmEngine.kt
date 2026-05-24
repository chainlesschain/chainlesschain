package com.chainlesschain.android.pdh.llm

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.1 A3.3 v0.2 — MediaPipe LLM Inference Task backend.
 *
 * 推文 §"无网也能用" 真接通的 engine 层。替换原 v0.1 kotlinllamacpp 计划
 * (per `pdh_llm_native_dep_audit.md`: 三候选坐标 0 artifact，自编不可行)，
 * 改用 Google 已发布的 `com.google.mediapipe:tasks-genai` (Google Maven，arm64
 * 预编译 .so) + Gemma-3 1B int4 `.task` 模型 (HF litert-community)。
 *
 * ## 架构
 *
 *  1. ModelManager 提供 .task 文件路径 (~555 MB, gemma3-1b-it-int4.task)
 *  2. MediaPipeLlmEngine.ensureLoaded() 调 `LlmInference.createFromOptions`
 *     (反射 wire — 避免 build-time class-resolution lock 让 nativeReady
 *     在没装 .so 的 host JVM 测试场景可早返 false)
 *  3. chat(messages) → 拼 Gemma chat-template → llmInference.generateResponse
 *  4. dispose() 释放 native ctx
 *
 * ## Why MediaPipe vs llama.cpp Kotlin 绑定？
 *
 * 三 llama.cpp Kotlin/JNA Android 候选 (kotlinllamacpp / Llamatik / llama-cpp-kt)
 * 全无 Maven Central / JitPack 发布。MediaPipe tasks-genai 是 Google 官方
 * 已发布、有 arm64-v8a .so 预编译的 Android 端 LLM 推理任务，对接成本 ≪
 * 自编 llama.cpp NDK。模型选 Gemma-3 1B int4：555 MB 单文件，纯 .task
 * 格式(模型+tokenizer 一体)，适配推文 "~1GB" 上限。
 *
 * ## 反射加载
 *
 * `LlmInference.createFromOptions(context, options)` 是 MediaPipe class，本
 * dep 既然加在 build.gradle.kts 上，编译期就有。但单测想覆盖 native lib
 * unavailable 路径 (JVM only) 仍可用 `nativeLoadedOverride = false` 强 fail
 * fast，不依赖 `System.loadLibrary` 真打到 .so。
 *
 * ## v0.3 follow-up
 *
 *  - SSE streaming via `llmInference.generateResponseAsync(prompt, listener)`
 *    (MediaPipe 支持 ProgressListener 流式) — 推文 §"实时打字效果"
 *  - GPU backend opt-in (默认 CPU; MediaPipe 在某些机型支持 GPU/NNAPI)
 *  - Token counting (现 estimateChars/4)
 *
 * 详见 docs/design/PDH_A3_OnDevice_LLM.md §3 (待 follow-up update)。
 */
@Singleton
class MediaPipeLlmEngine @Inject constructor(
    private val modelManager: ModelManager,
    @ApplicationContext private val context: Context,
) : LlmInferenceEngine {

    override val name: String = "mediapipe-genai"

    /** Whether the MediaPipe .so loaded. Probed lazily on first call. */
    @Volatile private var nativeLoaded: Boolean? = null

    /** Test seam — short-circuit nativeReady without resolving the lib. */
    internal var nativeLoadedOverride: Boolean? = null

    private val sessionMutex = Mutex()

    /**
     * Cached LlmInference handle. Type is Any to avoid hard-linking the
     * MediaPipe class in tests / JVM-only builds.
     */
    @Volatile private var sessionRef: Any? = null
    @Volatile private var loadedModelPath: String? = null
    /**
     * Cached `setMaxTokens` value the live [sessionRef] was built with.
     * MediaPipe bakes the context window into the LlmInference handle at
     * `createFromOptions` time — there is NO per-call override — so if the
     * caller bumps maxTokens between chats we must close + rebuild the
     * session. Was missed pre-fix-B: first chat baked 512 (old default), all
     * later chats silently kept 512 even after [LocalLlmServer] started
     * passing 4096. See trap #22.
     */
    @Volatile private var loadedMaxTokens: Int = -1

    override val nativeReady: Boolean
        get() = nativeLoadedOverride ?: probeNative()

    /**
     * One-shot probe of MediaPipe class availability. Cached after first call.
     * Reflective so JVM tests without the AAR + .so don't blow up at class
     * load time — instead just see nativeReady=false.
     */
    private fun probeNative(): Boolean {
        nativeLoaded?.let { return it }
        return try {
            Class.forName("com.google.mediapipe.tasks.genai.llminference.LlmInference")
            nativeLoaded = true
            true
        } catch (_: Throwable) {
            Timber.w("MediaPipeLlmEngine: tasks-genai class not on classpath — nativeReady=false")
            nativeLoaded = false
            false
        }
    }

    override suspend fun health(): LlmInferenceEngine.HealthStatus = withContext(Dispatchers.IO) {
        if (!nativeReady) {
            return@withContext LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "MediaPipe tasks-genai 未在 classpath (JVM/CI 测试模式或 dep 未加)",
            )
        }
        val modelState = try {
            modelManager.refresh()
        } catch (t: Throwable) {
            Timber.w(t, "MediaPipeLlmEngine.health: ModelManager.refresh threw")
            return@withContext LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "ModelManager 读模型态失败: ${t.message ?: t.javaClass.simpleName}",
            )
        }
        when (modelState) {
            is ModelManager.State.Ready -> LlmInferenceEngine.HealthStatus(
                ready = sessionRef != null,
                modelLoaded = true,
                modelName = modelState.file.name,
                reason = if (sessionRef == null) "模型文件就绪，等首次 chat 调用 lazy load native ctx" else null,
            )
            is ModelManager.State.NotDownloaded -> LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "Gemma-3 1B .task 未下载 — 请到 LLM 设置页触发下载",
            )
            is ModelManager.State.Downloading -> LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "模型下载中：${(modelState.progressFraction * 100).toInt()}% (${modelState.receivedBytes}/${modelState.totalBytes} bytes)",
            )
            is ModelManager.State.Verifying -> LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "校验 SHA256 中…",
            )
            is ModelManager.State.Failed -> LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "模型态错误：${modelState.reason}",
            )
        }
    }

    override suspend fun chat(
        messages: List<LlmInferenceEngine.ChatMessage>,
        opts: LlmInferenceEngine.ChatOptions,
    ): LlmInferenceEngine.ChatResponse = withContext(Dispatchers.IO) {
        if (!nativeReady) {
            throw LlmInferenceException(
                "MediaPipe tasks-genai 未加载 — Win 编译 OK 但 runtime fail-fast (probably running in JVM unit test)",
            )
        }
        sessionMutex.withLock {
            // Fix C — prompt-length guard BEFORE native predict.
            //
            // MediaPipe tasks-genai (libllm_inference_engine_jni.so) does NOT
            // surface OUT_OF_RANGE as a recoverable Java exception. When prompt
            // tokens > setMaxTokens budget, native predictSync throws an
            // IllegalStateException THEN immediately calls NewByteArray without
            // clearing the pending exception → CheckJNI fires JniAbort → SIGABRT
            // the whole app. We cannot catch this from Kotlin — by the time
            // control returns we are already dead. The only safe path is to
            // refuse the prompt up front and let the user retry with a tighter
            // question or switch to a cloud LLM. estimateChars/4 mirrors the
            // existing token estimator used for ChatResponse.promptTokens.
            val prompt = formatPrompt(messages)
            val estPromptTokens = prompt.length / 4
            val ctxBudget = opts.maxTokens
            val safetyMargin = 128
            if (estPromptTokens > ctxBudget - safetyMargin) {
                throw LlmInferenceException(
                    "本机 LLM prompt 过长 (~$estPromptTokens token，上下文窗口 $ctxBudget)。" +
                        "请缩小问题范围，或在「设置 > AI 后端」切换到「安卓云端 / PC 本机」LLM。"
                )
            }
            ensureLoadedLocked(opts)
            val startMs = System.currentTimeMillis()
            val output = try {
                generateResponseReflective(sessionRef!!, prompt)
            } catch (t: Throwable) {
                throw LlmInferenceException(
                    "MediaPipe generateResponse failed: ${t.message ?: t.javaClass.simpleName}",
                    t,
                )
            }
            val durationMs = System.currentTimeMillis() - startMs
            LlmInferenceEngine.ChatResponse(
                text = output,
                // v0.3 wire MediaPipe TaskMetric.tokens if exposed; for now estimate.
                promptTokens = prompt.length / 4,
                completionTokens = output.length / 4,
                totalDurationMs = durationMs,
            )
        }
    }

    /**
     * v0.3 dispose — close LlmInference handle. Reflective to avoid hard link
     * in tests. Called from Application.onTerminate or VM.onCleared.
     */
    suspend fun dispose() = sessionMutex.withLock {
        sessionRef?.let { ref ->
            try {
                val closeMethod = ref.javaClass.methods.firstOrNull { it.name == "close" }
                closeMethod?.invoke(ref)
            } catch (t: Throwable) {
                Timber.w(t, "MediaPipeLlmEngine.dispose: close threw")
            }
        }
        sessionRef = null
        loadedModelPath = null
        loadedMaxTokens = -1
    }

    /** Caller MUST hold [sessionMutex]. */
    private suspend fun ensureLoadedLocked(opts: LlmInferenceEngine.ChatOptions) {
        val modelState = modelManager.refresh()
        val ready = modelState as? ModelManager.State.Ready ?: throw LlmInferenceException(
            "模型文件未就绪 (state=${modelState.javaClass.simpleName})",
        )
        val targetPath = ready.file.absolutePath
        // Fix B — invalidate cached session when maxTokens changes too, not just
        // model path. MediaPipe bakes the context window in at create time;
        // ignoring opts changes meant the first chat permanently locked the
        // engine to whatever maxTokens it happened to be called with.
        if (sessionRef != null &&
            loadedModelPath == targetPath &&
            loadedMaxTokens == opts.maxTokens
        ) return
        if (sessionRef != null) {
            try {
                val closeMethod = sessionRef!!.javaClass.methods.firstOrNull { it.name == "close" }
                closeMethod?.invoke(sessionRef)
            } catch (_: Throwable) { /* best effort */ }
            sessionRef = null
        }
        sessionRef = try {
            createLlmInferenceReflective(targetPath, opts)
        } catch (t: Throwable) {
            throw LlmInferenceException("MediaPipe LlmInference.createFromOptions failed: ${t.message ?: t.javaClass.simpleName}", t)
        }
        loadedModelPath = targetPath
        loadedMaxTokens = opts.maxTokens
    }

    /**
     * Reflectively builds LlmInferenceOptions + creates LlmInference. Mirrors:
     *
     * ```
     * val opts = LlmInferenceOptions.builder()
     *     .setModelPath(path).setMaxTopK(40).setMaxTokens(maxTokens)
     *     .setTemperature(temperature).build()
     * LlmInference.createFromOptions(context, opts)
     * ```
     *
     * Reflection keeps the engine class loadable when the AAR isn't on the
     * test classpath. [probeNative] gates entry so we never reach here without
     * the runtime classes present.
     */
    private fun createLlmInferenceReflective(modelPath: String, opts: LlmInferenceEngine.ChatOptions): Any {
        val optsClass = Class.forName("com.google.mediapipe.tasks.genai.llminference.LlmInference\$LlmInferenceOptions")
        val builderClass = Class.forName("com.google.mediapipe.tasks.genai.llminference.LlmInference\$LlmInferenceOptions\$Builder")
        val inferenceClass = Class.forName("com.google.mediapipe.tasks.genai.llminference.LlmInference")

        val builder = optsClass.getMethod("builder").invoke(null)
        builderClass.getMethod("setModelPath", String::class.java).invoke(builder, modelPath)
        // setMaxTopK is a Builder method on LlmInferenceOptions.
        runCatching {
            builderClass.getMethod("setMaxTopK", Int::class.javaPrimitiveType).invoke(builder, 40)
        }
        runCatching {
            builderClass.getMethod("setMaxTokens", Int::class.javaPrimitiveType).invoke(builder, opts.maxTokens)
        }
        runCatching {
            builderClass.getMethod("setTemperature", Float::class.javaPrimitiveType).invoke(builder, opts.temperature)
        }
        val options = builderClass.getMethod("build").invoke(builder)
        return inferenceClass.getMethod("createFromOptions", Context::class.java, optsClass)
            .invoke(null, context, options)
    }

    private fun generateResponseReflective(sessionRef: Any, prompt: String): String {
        val method = sessionRef.javaClass.methods.firstOrNull {
            it.name == "generateResponse" && it.parameterTypes.size == 1 && it.parameterTypes[0] == String::class.java
        } ?: throw LlmInferenceException("LlmInference.generateResponse(String) method not found")
        return method.invoke(sessionRef, prompt) as String
    }

    /**
     * Chat template 由 [ModelManager.ModelSpec.promptFamily] 决定。
     *  - QWEN_CHATML: `<|im_start|>role\n{content}<|im_end|>\n…<|im_start|>assistant\n`
     *    Qwen / DeepSeek-R1-Distill 系（含本机默认 Qwen2.5-0.5B-Instruct）
     *  - GEMMA: `<start_of_turn>role\n{content}<end_of_turn>\n…<start_of_turn>model\n`
     *    Gemma 系（备选 Gemma3-1B-IT 时）
     *
     * 套错模板模型不会硬错，但会把模板字面 token 当输入，输出风格混乱、漏停。
     */
    private fun formatPrompt(messages: List<LlmInferenceEngine.ChatMessage>): String =
        when (modelManager.defaultSpec.promptFamily) {
            ModelManager.PromptFamily.QWEN_CHATML -> formatQwenChatML(messages)
            ModelManager.PromptFamily.GEMMA -> formatGemma(messages)
        }

    private fun formatQwenChatML(messages: List<LlmInferenceEngine.ChatMessage>): String {
        val sb = StringBuilder()
        for (m in messages) {
            val role = when (m.role) {
                "assistant", "model" -> "assistant"
                "system" -> "system"
                else -> "user"
            }
            sb.append("<|im_start|>").append(role).append("\n")
                .append(m.content).append("<|im_end|>\n")
        }
        sb.append("<|im_start|>assistant\n")
        return sb.toString()
    }

    private fun formatGemma(messages: List<LlmInferenceEngine.ChatMessage>): String {
        val sb = StringBuilder()
        for (m in messages) {
            val gemmaRole = when (m.role) {
                "assistant", "model" -> "model"
                "system" -> "user" // Gemma 3 lacks system role; prepend as user.
                else -> "user"
            }
            sb.append("<start_of_turn>").append(gemmaRole).append("\n")
                .append(m.content).append("<end_of_turn>\n")
        }
        sb.append("<start_of_turn>model\n")
        return sb.toString()
    }
}
