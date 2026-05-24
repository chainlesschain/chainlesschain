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
 * Download: OkHttp with HTTP range continuation + multi-mirror fallback.
 * [ModelSpec.urls] is an ordered list; on HTTP/IO failure of one mirror
 * the next is attempted with the existing `.part` file's Range continuation.
 * Cross-mirror resume is safe because [ModelSpec.expectedSha256] is pinned —
 * identical bytes guaranteed by SHA verify after the final byte lands.
 *
 * Default mirrors (国内可达 first):
 *   1. hf-mirror.com   — community HF mirror, historically reliable
 *   2. modelscope.cn   — Alibaba official, ICP-filed, stable infra fallback
 *
 * Users can override the list to self-host or add huggingface.co (requires VPN
 * from CN, which is why it is not in the default chain).
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
     * 2026-05-24 v0.3 加固：[urls] 改为 ordered fallback chain (hf-mirror →
     * modelscope)，[expectedSha256] 锁 HF LFS metadata 拿到的 verified hash
     * `e608953f169aeb1bd7b9155fec2559825e08453fc209b84eda3a781ed0452fd2` —
     * hf-mirror 不在 HF 官方控制下，TOFU 模式无法发现镜像被污染；ModelScope
     * 同步同一个 litert-community 仓库（file size 字节级对齐 → 同源 LFS），
     * 共用一个 SHA 即可两边校验通过。
     *
     * 备选（性能/效果优先时手动 swap）：
     *  - `litert-community/Qwen2.5-1.5B-Instruct` `_multi-prefill-seq_q8_ekv1280.task`
     *    (1.57 GB) — 显著更强的对话能力，但下载和 RAM 占用都翻倍
     *  - `litert-community/DeepSeek-R1-Distill-Qwen-1.5B` — 推理 + 中文
     *  - `litert-community/Gemma3-1B-IT` `gemma3-1b-it-int4.task` (555 MB) — 需 HF token
     */
    data class ModelSpec(
        val filename: String,
        /**
         * Ordered list of download URLs. [download] tries each in sequence,
         * resuming via the same `.part` file across mirrors (safe because
         * [expectedSha256] is pinned — any tampered byte aborts at verify).
         */
        val urls: List<String>,
        val expectedSha256: String?,
        val sizeBytesApprox: Long,
        /** 人类可读名（UI 显示用，避免界面文案和实际模型不一致）。 */
        val displayName: String,
        /** Prompt 模板族 —— 影响 [MediaPipeLlmEngine.formatPrompt] 的拼装。 */
        val promptFamily: PromptFamily = PromptFamily.QWEN_CHATML,
    ) {
        /** Primary mirror displayed in the UI "Source: …" label. */
        val primaryUrl: String get() = urls.firstOrNull().orEmpty()
    }

    /**
     * Prompt 模板族枚举 —— 不同模型用不同 chat 模板，套错会让模型生成混乱续写。
     *  - QWEN_CHATML: Qwen / DeepSeek-R1-Distill 系，`<|im_start|>role\n...<|im_end|>`
     *  - GEMMA: Gemma 系，`<start_of_turn>role\n...<end_of_turn>`
     */
    enum class PromptFamily { QWEN_CHATML, GEMMA }

    val defaultSpec = ModelSpec(
        filename = "Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        urls = listOf(
            // Primary — hf-mirror community mirror, no token, fastest path 国内.
            "https://hf-mirror.com/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/" +
                "Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
            // Fallback — ModelScope (Alibaba 官方，ICP 备案，infra 稳定)。same
            // litert-community repo mirrored from HF, byte-identical (546,660,344 B).
            "https://modelscope.cn/api/v1/models/litert-community/Qwen2.5-0.5B-Instruct/repo" +
                "?Revision=master" +
                "&FilePath=Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        ),
        // 2026-05-24 locked from HF LFS metadata. Identical bytes on both mirrors.
        expectedSha256 = "e608953f169aeb1bd7b9155fec2559825e08453fc209b84eda3a781ed0452fd2",
        sizeBytesApprox = 546_660_344L, // exact from HF API
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
     * Download with HTTP range continuation + multi-mirror fallback.
     * Idempotent — if file already matches expected SHA256 returns immediately.
     *
     * Mirror loop: tries each URL in [ModelSpec.urls] in order. On HTTP error
     * (non-2xx) or IO exception the next mirror is attempted. The `.part`
     * file is **preserved** across mirrors and resumed via `Range: bytes=N-`;
     * since [ModelSpec.expectedSha256] is pinned, mismatched bytes from a
     * tampered mirror will fail at verify (file deleted, user prompted retry).
     *
     * @return Ready on success, Failed only after every mirror has failed
     *         (caller can retry — partial bytes preserved for next attempt).
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

        if (spec.urls.isEmpty()) {
            val failed = State.Failed("ModelSpec.urls 为空（spec 配置错误）")
            _state.value = failed
            return@withContext failed
        }

        val mirrorErrors = mutableListOf<String>()
        for ((idx, url) in spec.urls.withIndex()) {
            val label = "镜像 ${idx + 1}/${spec.urls.size}"
            Timber.i("ModelManager: %s 尝试下载 %s", label, url)
            val outcome = tryDownloadFromMirror(url, partFile, spec.sizeBytesApprox)
            when (outcome) {
                is MirrorOutcome.Completed -> {
                    if (!partFile.renameTo(finalFile)) {
                        partFile.copyTo(finalFile, overwrite = true)
                        partFile.delete()
                    }
                    return@withContext refresh(spec)
                }
                is MirrorOutcome.Failed -> {
                    Timber.w("ModelManager: %s 失败 — %s", label, outcome.reason)
                    mirrorErrors += "$label ${outcome.reason}"
                    // partFile 保留，下一个 mirror 接力。
                }
            }
        }

        val failed = State.Failed(
            "所有镜像下载失败 — ${mirrorErrors.joinToString("; ")}"
        )
        _state.value = failed
        failed
    }

    private sealed class MirrorOutcome {
        object Completed : MirrorOutcome()
        data class Failed(val reason: String) : MirrorOutcome()
    }

    private fun tryDownloadFromMirror(
        url: String,
        partFile: File,
        sizeBytesApprox: Long,
    ): MirrorOutcome {
        val existingPartSize = if (partFile.exists()) partFile.length() else 0L
        val reqBuilder = Request.Builder().url(url)
        if (existingPartSize > 0L) {
            reqBuilder.addHeader("Range", "bytes=$existingPartSize-")
            Timber.i("ModelManager: 续传起点 %d bytes", existingPartSize)
        }

        return try {
            http.newCall(reqBuilder.build()).execute().use { resp ->
                if (!resp.isSuccessful) {
                    return MirrorOutcome.Failed("HTTP ${resp.code} ${resp.message}")
                }
                val totalBytes = run {
                    val contentLength = resp.body?.contentLength() ?: -1L
                    if (resp.code == 206) {
                        val cr = resp.header("Content-Range")
                        cr?.substringAfterLast('/')?.toLongOrNull()
                            ?: (existingPartSize + contentLength.coerceAtLeast(0L))
                    } else {
                        contentLength.coerceAtLeast(sizeBytesApprox)
                    }
                }
                _state.value = State.Downloading(existingPartSize, totalBytes)

                RandomAccessFile(partFile, "rw").use { raf ->
                    if (resp.code == 206) raf.seek(existingPartSize)
                    val body = resp.body ?: return MirrorOutcome.Failed("empty response body")
                    val src = body.source()
                    val buf = ByteArray(64 * 1024)
                    var received = existingPartSize
                    while (true) {
                        val n = src.read(buf)
                        if (n <= 0) break
                        raf.write(buf, 0, n)
                        received += n
                        if ((received - existingPartSize) % (1_048_576L) < 65_536L) {
                            _state.update { State.Downloading(received, totalBytes) }
                        }
                    }
                    _state.value = State.Downloading(received, totalBytes)
                }
            }
            MirrorOutcome.Completed
        } catch (t: Throwable) {
            Timber.w(t, "ModelManager.tryDownloadFromMirror IO failure")
            MirrorOutcome.Failed(t.message ?: t.javaClass.simpleName)
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
