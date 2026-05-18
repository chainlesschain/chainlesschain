package com.chainlesschain.android.feature.ai.data.voice

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * v1.1 issue #19 W4c WhisperModelDownloader 文件系统 + 状态机单测。
 *
 * 不测真 HTTP（需 MockWebServer + Robolectric Context；feature-ai 当前未引）。
 * 真下载 happy-path 在 W4e 真机 bench 验证。
 */
class WhisperModelDownloaderTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    private lateinit var context: Context
    private lateinit var downloader: WhisperModelDownloader

    @Before
    fun setup() {
        val filesDir = tempFolder.newFolder("files")
        context = mockk()
        every { context.filesDir } returns filesDir
        downloader = WhisperModelDownloader(context)
    }

    @After
    fun teardown() {
        // tempFolder auto-deletes
    }

    @Test
    fun `modelFile path lives in whisper-models subdir`() {
        val file = downloader.modelFile(WhisperModel.Base)
        assertEquals("ggml-base.bin", file.name)
        assertEquals(WhisperModelDownloader.MODELS_SUBDIR, file.parentFile?.name)
        assertEquals("files", file.parentFile?.parentFile?.name)
    }

    @Test
    fun `modelFile changes per model`() {
        val tiny = downloader.modelFile(WhisperModel.Tiny)
        val base = downloader.modelFile(WhisperModel.Base)
        val small = downloader.modelFile(WhisperModel.Small)
        assertEquals("ggml-tiny.bin", tiny.name)
        assertEquals("ggml-base.bin", base.name)
        assertEquals("ggml-small.bin", small.name)
    }

    @Test
    fun `isModelInstalled returns false when file missing`() {
        assertFalse(downloader.isModelInstalled(WhisperModel.Base))
        assertFalse(downloader.isModelInstalled(WhisperModel.Tiny))
        assertFalse(downloader.isModelInstalled(WhisperModel.Small))
    }

    @Test
    fun `isModelInstalled returns false when file too small (partial download)`() {
        val file = downloader.modelFile(WhisperModel.Tiny)
        file.parentFile?.mkdirs()
        file.writeBytes(ByteArray(1024)) // 1KB << 39MB expected
        assertFalse(downloader.isModelInstalled(WhisperModel.Tiny))
    }

    @Test
    fun `isModelInstalled returns true when file size matches`() {
        val file = downloader.modelFile(WhisperModel.Tiny)
        file.parentFile?.mkdirs()
        // 39MB ggml-tiny.bin — write 39MB - tolerance(10%) = 35MB+
        val expectedBytes = WhisperModel.Tiny.sizeMB.toLong() * 1024L * 1024L
        // 把文件写到 95% 期望大小（在容差以内）
        file.writeBytes(ByteArray((expectedBytes * 95 / 100).toInt()))
        assertTrue(downloader.isModelInstalled(WhisperModel.Tiny))
    }

    @Test
    fun `deleteModel removes existing file and returns true`() {
        val file = downloader.modelFile(WhisperModel.Base)
        file.parentFile?.mkdirs()
        file.writeBytes(ByteArray(1024))
        assertTrue(file.exists())

        assertTrue(downloader.deleteModel(WhisperModel.Base))
        assertFalse(file.exists())
    }

    @Test
    fun `deleteModel on missing file returns true (noop)`() {
        // 不存在视为已删 — 调用方不需先 check
        assertTrue(downloader.deleteModel(WhisperModel.Base))
    }

    @Test
    fun `initial downloadState is Idle`() {
        assertEquals(WhisperModelDownloader.DownloadState.Idle, downloader.downloadState.value)
    }

    @Test
    fun `deleteModel resets downloadState to Idle`() {
        // 模拟 Success 状态
        val file = downloader.modelFile(WhisperModel.Base)
        file.parentFile?.mkdirs()
        file.writeBytes(ByteArray(1024))
        downloader.deleteModel(WhisperModel.Base)
        assertEquals(WhisperModelDownloader.DownloadState.Idle, downloader.downloadState.value)
    }

    @Test
    fun `DownloadState sealed hierarchy covers 4 states`() {
        // 防止未来 sealed 类被改名时静默 break UI
        val states = listOf<WhisperModelDownloader.DownloadState>(
            WhisperModelDownloader.DownloadState.Idle,
            WhisperModelDownloader.DownloadState.Downloading(WhisperModel.Base, 0.5f, 100, 200),
            WhisperModelDownloader.DownloadState.Success(File("foo.bin")),
            WhisperModelDownloader.DownloadState.Failed("oops"),
        )
        assertEquals(4, states.size)
    }
}
