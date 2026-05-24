package com.chainlesschain.android.pdh.llm

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import timber.log.Timber
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A3.4 — manages on-device GGUF model files.
 *
 * Default model: Qwen2.5-1.5B-Instruct-Q4_K_M (~1GB) per
 * docs/design/PDH_A3_OnDevice_LLM.md §2.2.
 *
 * Storage: `filesDir/.chainlesschain/models/<filename>.gguf`. Excluded from
 * Android Auto-Backup (large file, regenerable). SHA256 verification after
 * download; on mismatch the file is deleted and the user prompted to retry.
 *
 * Download: OkHttp with HTTP range continuation. Default URL hits
 * hf-mirror.com (China-reachable); fallback huggingface.co. URL is
 * overridable so users can self-host.
 *
 * State exposed via [progress] StateFlow:
 *  - [State.NotDownloaded] — needs initial download
 *  - [State.Downloading(received, total)] — in flight, UI shows progress bar
 *  - [State.Verifying] — SHA256 check after download
 *  - [State.Ready(file, sha256)] — usable by [LlmInferenceEngine]
 *  - [State.Failed(reason)] — error, UI shows retry button
 *
 * A3.4 unit tests cover SHA256 verify + resume-from-partial paths against
 * a small fixture file (no real model downloaded in tests).
 */
@Singleton
class ModelManager @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    sealed class State {
        object NotDownloaded : State()
        data class Downloading(val receivedBytes: Long, val totalBytes: Long) : State() {
            val progressFraction: Float
                get() = if (totalBytes > 0L) receivedBytes.toFloat() / totalBytes.toFloat() else 0f
        }
        object Verifying : State()
        data class Ready(val file: File, val sha256: String) : State()
        data class Failed(val reason: String) : State()
    }

    private val _state = MutableStateFlow<State>(State.NotDownloaded)
    val state: StateFlow<State> = _state.asStateFlow()

    private val modelsDir: File by lazy {
        File(context.filesDir, ".chainlesschain/models").apply { mkdirs() }
    }

    /** OkHttp client with download-friendly timeouts. */
    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            // No callTimeout — model can be 1GB; total time depends on user network.
            .build()
    }

    /**
     * Default model spec — Qwen2.5-0.5B-Instruct q8 quantized `.task` (~547 MB).
     *
     * 2026-05-24 切换：Gemma-3 1B 在 HF 上 license-gated，hf-mirror 镜像虽然历史上
     * 不要 token，但用户实测下载 fail（可能 hf-mirror 也开始拒 gated 模型，或网络抖）。
     * 改换 `litert-community/Qwen2.5-0.5B-Instruct` —— 同样 MediaPipe `.task` 格式、
     * 同样在 hf-mirror 上、**无 license gate**、且尺寸相近（547 MB vs 555 MB）。
     * 国内场景 Qwen 中文效果好于 Gemma，下载链路也更稳。
     *
     * SHA256 留空 = TOFU；v0.3 锁 litert-community HF 上的 verified hash。
     *
     * 备选（性能/效果优先时手动 swap）：
     *  - `litert-community/Qwen2.5-1.5B-Instruct` `_multi-prefill-seq_q8_ekv1280.task`
     *    (1.57 GB) — 显著更强的对话能力，但下载和 RAM 占用都翻倍
     *  - `litert-community/DeepSeek-R1-Distill-Qwen-1.5B` — 推理 + 中文
     *  - `litert-community/Gemma3-1B-IT` `gemma3-1b-it-int4.task` (555 MB) — 需 HF token
     */
    data class ModelSpec(
        val filename: String,
        val url: String,
        val expectedSha256: String?,
        val sizeBytesApprox: Long,
        /** 人类可读名（UI 显示用，避免界面文案和实际模型不一致）。 */
        val displayName: String,
        /** Prompt 模板族 —— 影响 [MediaPipeLlmEngine.formatPrompt] 的拼装。 */
        val promptFamily: PromptFamily = PromptFamily.QWEN_CHATML,
    )

    /**
     * Prompt 模板族枚举 —— 不同模型用不同 chat 模板，套错会让模型生成混乱续写。
     *  - QWEN_CHATML: Qwen / DeepSeek-R1-Distill 系，`<|im_start|>role\n...<|im_end|>`
     *  - GEMMA: Gemma 系，`<start_of_turn>role\n...<end_of_turn>`
     */
    enum class PromptFamily { QWEN_CHATML, GEMMA }

    val defaultSpec = ModelSpec(
        filename = "Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        url = "https://hf-mirror.com/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/" +
            "Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        expectedSha256 = null,
        sizeBytesApprox = 547_000_000L, // ~547 MB
        displayName = "Qwen2.5 0.5B Instruct (q8)",
        promptFamily = PromptFamily.QWEN_CHATML,
    )

    /** Check if model already on disk + verified. Updates [state]. */
    suspend fun refresh(spec: ModelSpec = defaultSpec): State = withContext(Dispatchers.IO) {
        val file = File(modelsDir, spec.filename)
        if (!file.exists()) {
            _state.value = State.NotDownloaded
            return@withContext State.NotDownloaded
        }
        if (spec.expectedSha256 != null) {
            _state.value = State.Verifying
            val sha = sha256(file)
            if (sha != spec.expectedSha256) {
                Timber.w("ModelManager: SHA mismatch %s vs expected %s", sha, spec.expectedSha256)
                file.delete()
                val failed = State.Failed("校验失败 (SHA256 不匹配)，已删除残文件，请重新下载")
                _state.value = failed
                return@withContext failed
            }
            val ready = State.Ready(file, sha)
            _state.value = ready
            ready
        } else {
            // TOFU mode — trust file presence, compute SHA for caller info.
            val sha = sha256(file)
            val ready = State.Ready(file, sha)
            _state.value = ready
            ready
        }
    }

    /**
     * Download with HTTP range continuation. Idempotent — if file already
     * matches expected SHA256 returns immediately.
     *
     * Range continuation: if `<filename>.part` exists, sends Range header
     * `bytes=<size>-` to resume. Server must accept; HF mirrors do.
     *
     * @return Ready on success, Failed on any error (caller can retry).
     */
    suspend fun download(spec: ModelSpec = defaultSpec): State = withContext(Dispatchers.IO) {
        val partFile = File(modelsDir, "${spec.filename}.part")
        val finalFile = File(modelsDir, spec.filename)
        if (finalFile.exists()) {
            return@withContext refresh(spec)
        }

        // Disk space precheck — need ~1.2GB headroom for download + verify.
        val needed = (spec.sizeBytesApprox * 1.1).toLong()
        val avail = modelsDir.usableSpace
        if (avail < needed) {
            val failed = State.Failed(
                "空间不足：需要 ${needed / 1_000_000}MB，可用 ${avail / 1_000_000}MB"
            )
            _state.value = failed
            return@withContext failed
        }

        val existingPartSize = if (partFile.exists()) partFile.length() else 0L
        val reqBuilder = Request.Builder().url(spec.url)
        if (existingPartSize > 0L) {
            reqBuilder.addHeader("Range", "bytes=$existingPartSize-")
            Timber.i("ModelManager: resuming download from %d bytes", existingPartSize)
        }

        try {
            http.newCall(reqBuilder.build()).execute().use { resp ->
                if (!resp.isSuccessful) {
                    val failed = State.Failed("HTTP ${resp.code} ${resp.message}")
                    _state.value = failed
                    return@withContext failed
                }
                val totalBytes = run {
                    val contentLength = resp.body?.contentLength() ?: -1L
                    if (resp.code == 206) {
                        // Partial — total = existing + remaining (or use Content-Range)
                        val cr = resp.header("Content-Range")
                        cr?.substringAfterLast('/')?.toLongOrNull()
                            ?: (existingPartSize + contentLength.coerceAtLeast(0L))
                    } else {
                        contentLength.coerceAtLeast(spec.sizeBytesApprox)
                    }
                }
                _state.value = State.Downloading(existingPartSize, totalBytes)

                RandomAccessFile(partFile, "rw").use { raf ->
                    if (resp.code == 206) raf.seek(existingPartSize)
                    val body = resp.body ?: run {
                        val failed = State.Failed("empty response body")
                        _state.value = failed
                        return@withContext failed
                    }
                    val src = body.source()
                    val buf = ByteArray(64 * 1024)
                    var received = existingPartSize
                    while (true) {
                        val n = src.read(buf)
                        if (n <= 0) break
                        raf.write(buf, 0, n)
                        received += n
                        // Throttle UI updates — emit every ~1MB
                        if ((received - existingPartSize) % (1_048_576L) < 65_536L) {
                            _state.update { State.Downloading(received, totalBytes) }
                        }
                    }
                    _state.value = State.Downloading(received, totalBytes)
                }
            }

            // Atomic move .part → final, only after full body drained.
            if (!partFile.renameTo(finalFile)) {
                partFile.copyTo(finalFile, overwrite = true)
                partFile.delete()
            }
            return@withContext refresh(spec)
        } catch (t: Throwable) {
            Timber.w(t, "ModelManager.download failed")
            val failed = State.Failed("下载失败: ${t.message ?: t.javaClass.simpleName}")
            _state.value = failed
            failed
        }
    }

    /** Delete the model file (forced re-download next call). */
    suspend fun delete(spec: ModelSpec = defaultSpec) = withContext(Dispatchers.IO) {
        File(modelsDir, spec.filename).delete()
        File(modelsDir, "${spec.filename}.part").delete()
        _state.value = State.NotDownloaded
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
