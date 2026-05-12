package com.chainlesschain.android.feature.ai.data.voice

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import timber.log.Timber
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Android v1.1 issue #19 W4c — ggml 模型下载器。
 *
 * 把 [WhisperModel] 的 ggml 文件从 HuggingFace 拖到 app private filesDir
 * (`<filesDir>/whisper-models/<filename>`)。下载过程支持：
 *   - **进度回调**：StateFlow [downloadState] 流转 [DownloadState] (Idle /
 *     Downloading / Success / Failed)；UI 直接 collect 即可。
 *   - **协程取消**：调用方协程 cancel 时下载停止 + 删 .tmp 文件；StateFlow
 *     置回 Idle。
 *   - **原子写**：先写 `.tmp` 临时文件，**File.length() 校验通过后** rename
 *     到正式路径。中途 crash 不会留 partial 让 `isModelInstalled` 误判 OK。
 *   - **断点续传 不支持**：模型最大 466MB (Small)，全量重下可接受；HF 不一定
 *     都支持 Range header。W4d+ 可加。
 *
 * **不做 SHA-256 校验**：HuggingFace 不在 raw download URL 暴露 hash；下载完
 * 用 [WhisperModel.sizeMB] (±10%) 校验文件大小够 sanity-check；后续 W4d
 * native [WhisperNative.initContext] 加载失败时返 0 也是兜底。
 *
 * 关联文件：
 *   - [WhisperAsrEngine.isModelInstalled] 检查 [modelFile] 路径是否存在 +
 *     大小匹配。
 *   - W4d 后 [WhisperAsrEngine.transcribe] 调 [modelFile].absolutePath 传
 *     [WhisperNative.initContext]。
 */
@Singleton
class WhisperModelDownloader @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    /**
     * 当前下载状态 — UI collect 显示按钮 / 进度条 / 错误提示。
     * 单 active session (同时只允许一个模型下载)；新 download 调用 reset 旧状态。
     */
    private val _downloadState = MutableStateFlow<DownloadState>(DownloadState.Idle)
    val downloadState: StateFlow<DownloadState> = _downloadState.asStateFlow()

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            // 模型大；不限读 timeout 让 Android 系统 throttle 决定
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
    }

    /**
     * 返回 [model] ggml 文件应落在的路径（可能不存在）。
     *
     * 位置：`<context.filesDir>/whisper-models/<model.ggmlFilename>`。filesDir 用户
     * 清缓存不会删；卸载 app 才删 — 适合长期持有的大文件。
     */
    fun modelFile(model: WhisperModel): File =
        File(File(context.filesDir, MODELS_SUBDIR), model.ggmlFilename)

    /**
     * 检查 [model] 模型文件是否已下载完整。
     *
     * 判定：路径存在 + length() ≥ 90% × sizeMB × 1024² (留 10% 容差因为 HF 上
     * ggml 体积略有浮动，量化版本一致性而 metadata 大致估)。
     */
    fun isModelInstalled(model: WhisperModel): Boolean {
        val file = modelFile(model)
        if (!file.exists()) return false
        val expectedMin = model.sizeMB.toLong() * 1024L * 1024L * 9L / 10L
        return file.length() >= expectedMin
    }

    /**
     * 下载 [model] 到 [modelFile] 路径。同步 suspend，调用方放 `viewModelScope`
     * 或 [Dispatchers.IO] 协程；取消即停。
     *
     * 已安装则**立刻 short-circuit 返成功**（不重下）；UI 想强制重下需先
     * [delete] 再调本函数。
     *
     * @throws IOException 网络 / 磁盘错误（StateFlow 也置 Failed）
     */
    suspend fun downloadModel(model: WhisperModel): Result<File> = withContext(Dispatchers.IO) {
        if (isModelInstalled(model)) {
            Timber.i("WhisperModelDownloader: %s already installed, skip", model.name)
            _downloadState.value = DownloadState.Success(modelFile(model))
            return@withContext Result.success(modelFile(model))
        }

        val targetDir = File(context.filesDir, MODELS_SUBDIR).apply {
            if (!exists() && !mkdirs()) {
                val err = "Cannot create $absolutePath"
                _downloadState.value = DownloadState.Failed(err)
                return@withContext Result.failure(IOException(err))
            }
        }
        val targetFile = File(targetDir, model.ggmlFilename)
        val tmpFile = File(targetDir, "${model.ggmlFilename}.tmp")
        // 上次中断残留要清
        if (tmpFile.exists() && !tmpFile.delete()) {
            Timber.w("WhisperModelDownloader: stale tmp %s could not be deleted", tmpFile)
        }

        val url = HUGGINGFACE_BASE_URL + model.ggmlFilename
        Timber.i("WhisperModelDownloader: GET %s → %s", url, tmpFile)

        _downloadState.value = DownloadState.Downloading(model, 0f, 0L, model.sizeMB.toLong() * 1024L * 1024L)

        val request = Request.Builder().url(url).build()

        try {
            httpClient.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    val err = "HTTP ${resp.code} for $url"
                    _downloadState.value = DownloadState.Failed(err)
                    return@withContext Result.failure(IOException(err))
                }
                val body = resp.body
                    ?: run {
                        val err = "Empty body for $url"
                        _downloadState.value = DownloadState.Failed(err)
                        return@withContext Result.failure(IOException(err))
                    }

                val contentLength = body.contentLength().let { if (it > 0) it else model.sizeMB.toLong() * 1024L * 1024L }
                var bytesWritten = 0L

                tmpFile.outputStream().use { out ->
                    body.byteStream().use { input ->
                        val buf = ByteArray(BUFFER_BYTES)
                        while (true) {
                            // 协程取消 check (cooperative)
                            if (!kotlinx.coroutines.currentCoroutineContext().isActive) {
                                tmpFile.delete()
                                _downloadState.value = DownloadState.Idle
                                return@withContext Result.failure(
                                    IOException("Download cancelled"),
                                )
                            }
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            bytesWritten += n
                            val progress = if (contentLength > 0) {
                                (bytesWritten.toFloat() / contentLength).coerceIn(0f, 1f)
                            } else 0f
                            _downloadState.value = DownloadState.Downloading(
                                model = model,
                                progress = progress,
                                bytesDownloaded = bytesWritten,
                                bytesTotal = contentLength,
                            )
                        }
                    }
                }
            }

            // sanity-check 大小
            val expectedMin = model.sizeMB.toLong() * 1024L * 1024L * 9L / 10L
            if (tmpFile.length() < expectedMin) {
                tmpFile.delete()
                val err = "Downloaded size ${tmpFile.length()}b < expected min ${expectedMin}b"
                _downloadState.value = DownloadState.Failed(err)
                return@withContext Result.failure(IOException(err))
            }

            // atomic rename — POSIX rename(2) atomic in same fs
            if (targetFile.exists() && !targetFile.delete()) {
                Timber.w("WhisperModelDownloader: stale target %s could not be deleted", targetFile)
            }
            if (!tmpFile.renameTo(targetFile)) {
                val err = "Rename $tmpFile → $targetFile failed"
                _downloadState.value = DownloadState.Failed(err)
                return@withContext Result.failure(IOException(err))
            }

            Timber.i(
                "WhisperModelDownloader: %s installed at %s (size=%d)",
                model.name, targetFile, targetFile.length(),
            )
            _downloadState.value = DownloadState.Success(targetFile)
            Result.success(targetFile)
        } catch (e: IOException) {
            tmpFile.delete()
            _downloadState.value = DownloadState.Failed(e.message ?: e.javaClass.simpleName)
            Timber.e(e, "WhisperModelDownloader: download failed")
            Result.failure(e)
        }
    }

    /**
     * 删 [model] 文件 (释放空间 / 用户主动重置)。
     */
    fun deleteModel(model: WhisperModel): Boolean {
        val file = modelFile(model)
        if (!file.exists()) return true
        val ok = file.delete()
        if (ok) _downloadState.value = DownloadState.Idle
        Timber.i("WhisperModelDownloader: delete %s → %s", file, ok)
        return ok
    }

    /**
     * 当前下载状态。
     */
    sealed class DownloadState {
        data object Idle : DownloadState()
        data class Downloading(
            val model: WhisperModel,
            val progress: Float, // 0.0 ~ 1.0
            val bytesDownloaded: Long,
            val bytesTotal: Long,
        ) : DownloadState()
        data class Success(val file: File) : DownloadState()
        data class Failed(val reason: String) : DownloadState()
    }

    companion object {
        const val MODELS_SUBDIR = "whisper-models"
        // HF resolve URL 不需 auth，公开模型
        private const val HUGGINGFACE_BASE_URL =
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"
        private const val BUFFER_BYTES = 64 * 1024
    }
}
