package com.chainlesschain.android.pdh.llm

import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.1 A3.3 — kotlinllamacpp (llama.cpp Kotlin binding) backend skeleton.
 *
 * 推文承诺路径："手机里的小 AI 直接用这些数据回答你的问题——全程不联网、不
 * 上云" 真接通：本类把 llama.cpp 的 native context 暴露为 LlmInferenceEngine
 * 接口，让 LocalLlmServer Ktor /api/chat 端点 (cc OllamaClient → 本机
 * 127.0.0.1:18484) 调用进来。
 *
 * ## 架构
 *  1. ModelManager 提供 GGUF 文件路径 (~1GB Qwen2.5-1.5B-Q4_K_M)
 *  2. KotlinLlamaCppEngine 加载 model into native context (loadModel)
 *  3. chat() 把 ChatMessage[] stitch 成 Qwen2.5 prompt 模板 → native infer
 *  4. health() 报 native lib + model 双就绪
 *  5. dispose() 释放 native context (vm 销毁时)
 *
 * ## Native interop (JNI)
 *
 * 用 [LlamaNative] (本文件内 object) 暴露 4 external 方法 — 对接
 * `com.github.ljcamargo:kotlinllamacpp:0.4.0` libllama.so 符号 (链接 native
 * lib 名 `kotlinllamacpp` 或 `llama`)。System.loadLibrary 包 try-catch：
 *
 *  - 真机 (有 .so) → 正常 load → ready=true 后 chat 真出答案
 *  - JVM 单测 / CI (无 .so) → loadLibrary 抛 UnsatisfiedLinkError → catch
 *    住，[nativeLoaded] = false → health() 报 "native lib unavailable"
 *
 * 本类的 unit test 模式：注入 `var nativeLoadedOverride: Boolean? = null`
 * 让测试 stub 为 true/false 而无须实际 .so。
 *
 * ## v0.2 follow-up
 *
 * - 真正 wire JitPack `com.github.ljcamargo:kotlinllamacpp:0.4.0` (依赖
 *   Mac/Linux ./gradlew publishToMavenLocal 验证坐标)；当前 build.gradle
 *   未声明，所以本类的 native 调用在 JVM mode 都返 fail-fast — 这是 §2.1
 *   骨架的设计，符合 Win-startable scope
 * - SSE streaming /api/chat (推文 §"实时打字效果" v0.2 可选)
 * - Token usage 真统计 (现在 promptTokens / completionTokens 估算)
 *
 * 详见 [`docs/design/PDH_A3_OnDevice_LLM.md`] §3 架构图。
 */
@Singleton
class KotlinLlamaCppEngine @Inject constructor(
    private val modelManager: ModelManager,
    @ApplicationContext private val context: android.content.Context,
) : LlmInferenceEngine {

    override val name: String = "kotlinllamacpp"

    /**
     * §2.1 A3.4 — cheap synchronous read of native lib load state. Reads the
     * same `NATIVE_LOADED` flag the suspend `health()` does, but without the
     * ModelManager file I/O. The UI's ModelStatusBanner uses this at init to
     * decide between "🟢 端侧 AI 已就绪" and "⏳ 等待 v0.2 推理引擎" copy when
     * the model itself is downloaded but the JitPack/Maven .so isn't bundled.
     */
    override val nativeReady: Boolean get() = isNativeLoaded

    /** Guard the native context — llama.cpp single-threaded per ctx. */
    private val nativeMutex = Mutex()

    /**
     * Native context handle. 0 = not loaded. Set by [ensureLoaded] under
     * [nativeMutex]. v0.1 单 ctx (不支持并行多对话)；v0.2 if user 多 chat 并
     * 行问题再考虑 ctx pool.
     */
    @Volatile private var contextHandle: Long = 0L

    /** Cached path to currently-loaded GGUF file. */
    @Volatile private var loadedModelPath: String? = null

    /** Test seam — set to true/false to override native check in unit tests. */
    internal var nativeLoadedOverride: Boolean? = null

    private val isNativeLoaded: Boolean
        get() = nativeLoadedOverride ?: LlamaNative.NATIVE_LOADED

    override suspend fun health(): LlmInferenceEngine.HealthStatus = withContext(Dispatchers.IO) {
        if (!isNativeLoaded) {
            return@withContext LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "native lib unavailable (kotlinllamacpp .so 未加载 — Win/CI 模式无 JNI dep；真机需 v0.2 dep 接通)",
            )
        }
        val modelState = try {
            modelManager.refresh()
        } catch (t: Throwable) {
            Timber.w(t, "KotlinLlamaCppEngine.health: ModelManager.refresh threw")
            return@withContext LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "ModelManager 读模型态失败: ${t.message ?: t.javaClass.simpleName}",
            )
        }
        when (modelState) {
            is ModelManager.State.Ready -> LlmInferenceEngine.HealthStatus(
                ready = contextHandle != 0L,
                modelLoaded = true,
                modelName = modelState.file.name,
                reason = if (contextHandle == 0L) "模型文件就绪，等首次 chat 调用 lazy load native ctx" else null,
            )
            is ModelManager.State.NotDownloaded -> LlmInferenceEngine.HealthStatus(
                ready = false,
                modelLoaded = false,
                modelName = null,
                reason = "GGUF 模型文件未下载 — 请到 LLM 设置页触发下载",
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
        if (!isNativeLoaded) {
            throw LlmInferenceException(
                "native lib 未加载 — kotlinllamacpp .so 缺失 (v0.2 真机接通；Win 编译 OK 但 runtime fail-fast)",
            )
        }
        nativeMutex.withLock {
            ensureLoadedLocked()
            val prompt = formatPrompt(messages)
            val startMs = System.currentTimeMillis()
            val output = try {
                LlamaNative.chat(
                    ctx = contextHandle,
                    prompt = prompt,
                    maxTokens = opts.maxTokens,
                    temperature = opts.temperature,
                )
            } catch (t: Throwable) {
                throw LlmInferenceException(
                    "native chat failed: ${t.message ?: t.javaClass.simpleName}",
                    t,
                )
            }
            val durationMs = System.currentTimeMillis() - startMs
            LlmInferenceEngine.ChatResponse(
                text = output,
                // v0.2 替换为 native 真返回 token 计数。当前估算 = chars/4。
                promptTokens = prompt.length / 4,
                completionTokens = output.length / 4,
                totalDurationMs = durationMs,
            )
        }
    }

    /** v0.2 — VM 销毁时调；释放 native ctx 防内存泄漏。 */
    suspend fun dispose() = nativeMutex.withLock {
        if (contextHandle != 0L) {
            try {
                LlamaNative.freeContext(contextHandle)
            } catch (t: Throwable) {
                Timber.w(t, "KotlinLlamaCppEngine.dispose: native free threw")
            }
            contextHandle = 0L
            loadedModelPath = null
        }
    }

    /** Caller MUST hold [nativeMutex]. */
    private suspend fun ensureLoadedLocked() {
        val modelState = modelManager.refresh()
        val ready = modelState as? ModelManager.State.Ready ?: throw LlmInferenceException(
            "模型文件未就绪 (state=${modelState.javaClass.simpleName})",
        )
        val targetPath = ready.file.absolutePath
        if (contextHandle != 0L && loadedModelPath == targetPath) return  // already loaded
        if (contextHandle != 0L) {
            // Different model path → free + reload (rare; user re-installed)
            try { LlamaNative.freeContext(contextHandle) } catch (_: Throwable) { /* best effort */ }
            contextHandle = 0L
        }
        contextHandle = try {
            LlamaNative.loadModel(targetPath, nThreads = DEFAULT_THREADS)
        } catch (t: Throwable) {
            throw LlmInferenceException("native loadModel failed: ${t.message ?: t.javaClass.simpleName}", t)
        }
        loadedModelPath = targetPath
    }

    /**
     * Qwen2.5-1.5B-Instruct chat template:
     *   <|im_start|>system\n{system}<|im_end|>
     *   <|im_start|>user\n{user}<|im_end|>
     *   <|im_start|>assistant\n
     */
    private fun formatPrompt(messages: List<LlmInferenceEngine.ChatMessage>): String {
        val sb = StringBuilder()
        for (m in messages) {
            sb.append("<|im_start|>").append(m.role).append("\n")
                .append(m.content).append("<|im_end|>\n")
        }
        sb.append("<|im_start|>assistant\n")
        return sb.toString()
    }

    companion object {
        // Dimensity 7025-Ultra (Xiaomi 24115RA8EC): 4 perf cores. Leave 1
        // for UI thread + OS, give llama 3。 v0.2 可动态读 CPU 核数。
        private const val DEFAULT_THREADS = 3
    }
}

/**
 * JNI bridge to libllama (kotlinllamacpp's native side). 4 external functions
 * declared but loaded conditionally — System.loadLibrary in companion init
 * try-catch lets the class compile without the .so present.
 *
 * Symbol mapping (v0.2 confirm against actual kotlinllamacpp build)：
 *  - Java_..._loadModel(path: String, nThreads: Int): Long
 *  - Java_..._chat(ctx: Long, prompt: String, maxTokens: Int, temperature: Float): String
 *  - Java_..._freeContext(ctx: Long): Unit
 *
 * For tests: KotlinLlamaCppEngine.nativeLoadedOverride = false → 跳过 native
 * 调用，chat() 走 fail-fast 路径，无须 stub external functions。
 */
internal object LlamaNative {
    /**
     * Whether the native library loaded successfully. Set in init block
     * (one-shot). All native methods below will throw UnsatisfiedLinkError
     * if called while this is false — caller [KotlinLlamaCppEngine] gates
     * on [NATIVE_LOADED] before invoking.
     */
    val NATIVE_LOADED: Boolean = try {
        System.loadLibrary("kotlinllamacpp")
        true
    } catch (t: UnsatisfiedLinkError) {
        Timber.w("LlamaNative: System.loadLibrary(kotlinllamacpp) failed (expected on Win/CI without .so): %s", t.message)
        false
    } catch (t: Throwable) {
        Timber.w(t, "LlamaNative: System.loadLibrary failed unexpectedly")
        false
    }

    @JvmStatic external fun loadModel(modelPath: String, nThreads: Int): Long
    @JvmStatic external fun chat(ctx: Long, prompt: String, maxTokens: Int, temperature: Float): String
    @JvmStatic external fun freeContext(ctx: Long)
}
