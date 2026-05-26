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
     * 端侧 LLM 模型规格。每条 [ModelSpec] 描述一个可下载的 MediaPipe `.task` 文件
     * 及其 SHA / 镜像链 / prompt 模板族。同一份 [ModelManager] 通过 [selectedSpec]
     * 暴露用户当前选中的一档（默认 0.5B，进阶用户可切到 1.5B）。
     *
     * 历史背景：
     *  - 2026-05-24 从 Gemma-3 1B 切换到 Qwen2.5-0.5B，因 Gemma license-gated。
     *  - 2026-05-26 加入 Qwen2.5-1.5B 作可选档；用户机器好（≥6GB RAM、≥3GB 可用
     *    存储、对中文对话质量要求高）时手动切到 1.5B，效果显著更好。
     */
    data class ModelSpec(
        /** 稳定标识，SharedPreferences 持久化用 key，UI radio onClick 派发也用它。 */
        val key: String,
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
        /**
         * 推荐的最低设备总内存（MB）。UI 用它对低端机展示 RAM 警告（不强制阻止下载，
         * 但提醒用户 1.5B 在 4GB 以下机器上可能 OOM kill）。0.5B 设 2048，1.5B 设 6144。
         */
        val recommendedRamMb: Long = 0L,
    ) {
        /** Primary mirror displayed in the UI "Source: …" label. */
        val primaryUrl: String get() = urls.firstOrNull().orEmpty()

        /** 给 UI label 用：true=SHA 已锁字节级校验；false=TOFU 模式（首次下载后再锁）。 */
        val shaLocked: Boolean get() = !expectedSha256.isNullOrBlank()
    }

    /**
     * Prompt 模板族枚举 —— 不同模型用不同 chat 模板，套错会让模型生成混乱续写。
     *  - QWEN_CHATML: Qwen / DeepSeek-R1-Distill 系，`<|im_start|>role\n...<|im_end|>`
     *  - GEMMA: Gemma 系，`<start_of_turn>role\n...<end_of_turn>`
     */
    enum class PromptFamily { QWEN_CHATML, GEMMA }

    /**
     * Qwen2.5-0.5B q8 — 默认档。
     *
     * 2026-05-24 v0.3 加固：[urls] 改为 ordered fallback chain (hf-mirror →
     * modelscope)，[expectedSha256] 锁 HF LFS metadata 拿到的 verified hash —
     * hf-mirror 不在 HF 官方控制下，TOFU 模式无法发现镜像被污染；ModelScope
     * 同步同一个 litert-community 仓库（file size 字节级对齐 → 同源 LFS），
     * 共用一个 SHA 即可两边校验通过。
     */
    val qwen05bSpec = ModelSpec(
        key = "qwen-0.5b",
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
        recommendedRamMb = 2_048L,
    )

    /**
     * Qwen2.5-1.5B q8 — 进阶档（推文 §"机器好可装更大模型"）。
     *
     * 同 litert-community 系列，对话连贯性 / 推理深度显著优于 0.5B，代价是：
     *  - 文件 ~1.57 GB（vs 547 MB），下载更慢
     *  - 推理峰值内存约 2-3 GB，4 GB 以下机型可能被 OOM killer 杀掉
     *  - prefill 慢约 2-3×，token 生成慢约 2×
     *
     * SHA: 当前 TOFU 模式（expectedSha256 = null）—— 首次真机下载后用 `sha256sum`
     * 拿到字节后再 pin 到这里。pin 之前 ModelScope 镜像污染风险无法字节级排除，但
     * MediaPipe runtime 加载非法 .task 会立即解析失败，攻击面相对窄；这是一个有意识
     * 的权衡（让用户尽早能用上 1.5B，避免阻塞在 SHA 探测）。锁后改 commit message
     * `chore(pdh-android): lock Qwen2.5-1.5B SHA from real device download`。
     */
    val qwen15bSpec = ModelSpec(
        key = "qwen-1.5b",
        filename = "Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        urls = listOf(
            "https://hf-mirror.com/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/" +
                "Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
            "https://modelscope.cn/api/v1/models/litert-community/Qwen2.5-1.5B-Instruct/repo" +
                "?Revision=master" +
                "&FilePath=Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task",
        ),
        // TODO(pdh-android): lock from real device download. See KDoc above.
        expectedSha256 = null,
        sizeBytesApprox = 1_686_000_000L, // ~1.57 GiB approx; locked when SHA locks
        displayName = "Qwen2.5 1.5B Instruct (q8)",
        promptFamily = PromptFamily.QWEN_CHATML,
        recommendedRamMb = 6_144L,
    )

    /** 可选模型列表，UI radio source。0.5B 在前作默认推荐。 */
    val availableSpecs: List<ModelSpec> = listOf(qwen05bSpec, qwen15bSpec)

    /**
     * Back-compat alias — 始终指向 0.5B。
     * 之前的调用方（含 [ModelManagerTest] `defaultSpec has SHA256 locked`）依赖
     * 这个字段恒定不变；当前用户选中的 spec 改读 [selectedSpec]。
     */
    val defaultSpec: ModelSpec get() = qwen05bSpec

    private val prefs by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val _selectedSpec: MutableStateFlow<ModelSpec> by lazy {
        MutableStateFlow(loadSelectedSpec())
    }

    /**
     * 用户当前选中的模型规格。VM 收集这个 flow 派发到 UI；切换时调 [selectSpec]。
     * 默认 [qwen05bSpec]；从 SharedPreferences 恢复，未知 key 回退默认。
     */
    val selectedSpec: StateFlow<ModelSpec> get() = _selectedSpec.asStateFlow()

    private fun loadSelectedSpec(): ModelSpec {
        val key = try {
            prefs.getString(KEY_SELECTED_SPEC, null)
        } catch (t: Throwable) {
            // mockk(relaxed=true) 路径下不会发，但真机首启 prefs 可能尚未提交。
            Timber.w(t, "ModelManager.loadSelectedSpec: prefs read failed; defaulting")
            null
        }
        return availableSpecs.firstOrNull { it.key == key } ?: qwen05bSpec
    }

    /**
     * 用户切换选中的模型档。idempotent — 选当前已选项是 no-op；不在 [availableSpecs]
     * 的 spec 被拒（防御性，避免 UI 端意外传 stale 引用）。
     *
     * 切换不自动触发下载/删除 — 状态机由调用方驱动：UI 切到新档后 [state] 立刻反映
     * 新档的 NotDownloaded/Ready/Failed，用户再点"下载"才落盘。这样允许用户先比较
     * 两档的体积估计，再决定要不要切。
     */
    fun selectSpec(spec: ModelSpec) {
        require(availableSpecs.any { it.key == spec.key }) {
            "spec ${spec.key} not in availableSpecs"
        }
        if (_selectedSpec.value.key == spec.key) return
        try {
            prefs.edit().putString(KEY_SELECTED_SPEC, spec.key).apply()
        } catch (t: Throwable) {
            Timber.w(t, "ModelManager.selectSpec: prefs write failed (continuing in-memory)")
        }
        _selectedSpec.value = spec
    }

    /** Check if model already on disk + verified. Updates [state]. */
    suspend fun refresh(spec: ModelSpec = selectedSpec.value): State = withContext(Dispatchers.IO) {
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
    suspend fun download(spec: ModelSpec = selectedSpec.value): State = withContext(Dispatchers.IO) {
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
    suspend fun delete(spec: ModelSpec = selectedSpec.value) = withContext(Dispatchers.IO) {
        File(modelsDir, spec.filename).delete()
        File(modelsDir, "${spec.filename}.part").delete()
        _state.value = State.NotDownloaded
    }

    companion object {
        private const val PREFS_NAME = "model_manager"
        private const val KEY_SELECTED_SPEC = "selected_spec_key"
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
