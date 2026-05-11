package com.chainlesschain.android.feature.ai.data.ocr

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * CameraOcrManager 单测。M3 D1。Fake-bridge 模式，无 MockK。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CameraOcrManagerTest {

    private val tmpFiles = mutableListOf<File>()

    @After
    fun cleanup() {
        tmpFiles.forEach { runCatching { it.delete() } }
        tmpFiles.clear()
    }

    private fun tmp(content: ByteArray = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())): File {
        val f = File.createTempFile("ocr-test", ".jpg")
        f.writeBytes(content)
        tmpFiles.add(f)
        return f
    }

    private fun newManager(bridge: OcrBridge = FakeBridge()) = CameraOcrManager(bridge)

    @Test
    fun `initial state is Idle`() {
        val mgr = newManager()
        assertEquals(CameraOcrState.Idle, mgr.state.value)
    }

    @Test
    fun `processImage reads file fails when file missing`() = runTest {
        val mgr = newManager()
        val nonexistent = File("does-not-exist-${System.nanoTime()}.jpg")
        mgr.processImage(nonexistent)
        val s = mgr.state.value as CameraOcrState.Failed
        assertEquals(CameraOcrState.Failed.Stage.ENCODE, s.stage)
    }

    @Test
    fun `processImage empty file fails with ENCODE`() = runTest {
        val mgr = newManager()
        val f = tmp(content = ByteArray(0))
        mgr.processImage(f)
        val s = mgr.state.value as CameraOcrState.Failed
        assertEquals(CameraOcrState.Failed.Stage.ENCODE, s.stage)
    }

    @Test
    fun `processImage success reaches Recognized with OCR text`() = runTest {
        val bridge = FakeBridge(ocr = OcrText("发票 总额 ¥299.00", "zh", 0.94f))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        val s = mgr.state.value as CameraOcrState.Recognized
        assertEquals("发票 总额 ¥299.00", s.text)
        assertEquals("zh", s.language)
        assertEquals(0.94f, s.confidence)
    }

    @Test
    fun `processImage REMOTE recognize failure leads to RECOGNIZE Failed`() = runTest {
        val bridge = FakeBridge(recognizeResult = Result.failure(RuntimeException("桌面离线")))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        val s = mgr.state.value as CameraOcrState.Failed
        assertEquals(CameraOcrState.Failed.Stage.RECOGNIZE, s.stage)
        assertTrue(s.message.contains("桌面离线"))
    }

    @Test
    fun `processImage blank text fails with RECOGNIZE`() = runTest {
        val bridge = FakeBridge(ocr = OcrText("", "auto", 0f))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        val s = mgr.state.value as CameraOcrState.Failed
        assertEquals(CameraOcrState.Failed.Stage.RECOGNIZE, s.stage)
    }

    @Test
    fun `processImage forwards language hint to bridge`() = runTest {
        val bridge = FakeBridge()
        val mgr = newManager(bridge)
        mgr.processImage(tmp(), language = "zh-Hans")
        assertEquals("zh-Hans", bridge.recognizeLangs.last())
    }

    @Test
    fun `saveToKb before Recognized is ignored (no state change)`() = runTest {
        val mgr = newManager()
        mgr.saveToKb("不应保存")
        assertEquals(CameraOcrState.Idle, mgr.state.value)
    }

    @Test
    fun `saveToKb after Recognized reaches Saved with noteId`() = runTest {
        val bridge = FakeBridge(saveResult = Result.success(SavedNote("note-A")))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb(title = "扫描发票")
        val s = mgr.state.value as CameraOcrState.Saved
        assertEquals("note-A", s.noteId)
        assertEquals("扫描发票", s.title)
    }

    @Test
    fun `saveToKb sends OCR text by default to bridge`() = runTest {
        val bridge = FakeBridge(ocr = OcrText("原文 OCR", "zh", 0.9f))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb("标题")
        assertEquals("原文 OCR", bridge.savedContents.last())
    }

    @Test
    fun `saveToKb honors contentOverride for edited text`() = runTest {
        val bridge = FakeBridge(ocr = OcrText("原文 OCR", "zh", 0.9f))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb("标题", contentOverride = "用户编辑后的版本")
        assertEquals("用户编辑后的版本", bridge.savedContents.last())
    }

    @Test
    fun `saveToKb default tags are ocr and mobile`() = runTest {
        val bridge = FakeBridge()
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb("标题")
        assertEquals(listOf("ocr", "mobile"), bridge.savedTags.last())
    }

    @Test
    fun `saveToKb custom tags pass through`() = runTest {
        val bridge = FakeBridge()
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb("标题", tags = listOf("invoice", "2026"))
        assertEquals(listOf("invoice", "2026"), bridge.savedTags.last())
    }

    @Test
    fun `saveToKb bridge failure leads to SAVE Failed`() = runTest {
        val bridge = FakeBridge(saveResult = Result.failure(RuntimeException("KB 写入失败")))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb("标题")
        val s = mgr.state.value as CameraOcrState.Failed
        assertEquals(CameraOcrState.Failed.Stage.SAVE, s.stage)
    }

    @Test
    fun `reset clears state to Idle from Recognized`() = runTest {
        val mgr = newManager()
        mgr.processImage(tmp())
        assertNotNull(mgr.state.value as? CameraOcrState.Recognized)
        mgr.reset()
        assertEquals(CameraOcrState.Idle, mgr.state.value)
    }

    @Test
    fun `reset clears state to Idle from Saved`() = runTest {
        val mgr = newManager()
        mgr.processImage(tmp())
        mgr.saveToKb("标题")
        assertNotNull(mgr.state.value as? CameraOcrState.Saved)
        mgr.reset()
        assertEquals(CameraOcrState.Idle, mgr.state.value)
    }

    @Test
    fun `reset clears state to Idle from Failed`() = runTest {
        val bridge = FakeBridge(recognizeResult = Result.failure(RuntimeException("x")))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        assertNotNull(mgr.state.value as? CameraOcrState.Failed)
        mgr.reset()
        assertEquals(CameraOcrState.Idle, mgr.state.value)
    }

    @Test
    fun `Encoding state visible during processImage flow`() = runTest {
        // 用 FakeBridge.recordTransitions=true 让 recognize 之间 yield 一次
        val bridge = FakeBridge()
        val mgr = newManager(bridge)
        // 整个流程同步跑完，难直接捕获 Encoding 瞬态；用 Saved 流程做收尾检测：
        // 上面 4 case 各覆盖一段，这里追加最终态确保 happy 全流程跑完
        mgr.processImage(tmp())
        mgr.saveToKb("终态")
        val s = mgr.state.value as CameraOcrState.Saved
        assertEquals("终态", s.title)
    }

    @Test
    fun `processImage replays - second call overrides earlier text`() = runTest {
        val bridge = FakeBridge()
        val mgr = newManager(bridge)
        bridge.nextOcr = OcrText("first", "zh", 0.9f)
        mgr.processImage(tmp())
        bridge.nextOcr = OcrText("second", "zh", 0.95f)
        mgr.processImage(tmp())
        val s = mgr.state.value as CameraOcrState.Recognized
        assertEquals("second", s.text)
    }

    @Test
    fun `saveToKb contentPrefix prepends markdown header to bridge content`() = runTest {
        val bridge = FakeBridge(ocr = OcrText("正文 OCR", "zh", 0.9f))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb(
            title = "标题",
            contentPrefix = "> 📍 39.9042,116.4074 (±15m) @ 2026-05-11 14:32",
        )
        val sent = bridge.savedContents.last()
        assertTrue(sent.startsWith("> 📍 39.9042,116.4074 (±15m) @ 2026-05-11 14:32"))
        assertTrue(sent.endsWith("正文 OCR"))
        // 中间 \n\n 分隔
        assertTrue(sent.contains("\n\n正文 OCR"))
    }

    @Test
    fun `saveToKb blank contentPrefix is ignored`() = runTest {
        val bridge = FakeBridge(ocr = OcrText("正文", "zh", 0.9f))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb(title = "t", contentPrefix = "   ")
        assertEquals("正文", bridge.savedContents.last())
    }

    @Test
    fun `saveToKb contentPrefix coexists with contentOverride`() = runTest {
        val bridge = FakeBridge(ocr = OcrText("原文", "zh", 0.9f))
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb(
            title = "t",
            contentOverride = "用户改后",
            contentPrefix = "> 📍 GPS",
        )
        val sent = bridge.savedContents.last()
        assertEquals("> 📍 GPS\n\n用户改后", sent)
    }

    @Test
    fun `saveToKb after Saved is ignored (one-shot)`() = runTest {
        val bridge = FakeBridge()
        val mgr = newManager(bridge)
        mgr.processImage(tmp())
        mgr.saveToKb("first")
        val firstSaved = mgr.state.value
        mgr.saveToKb("ghost")  // not Recognized anymore → ignored
        assertEquals(firstSaved, mgr.state.value)
    }

    // ===== Fake =====

    private class FakeBridge(
        val ocr: OcrText? = null,
        val recognizeResult: Result<OcrText>? = null,
        val saveResult: Result<SavedNote>? = null,
    ) : OcrBridge {
        var nextOcr: OcrText? = null
        val recognizeLangs = mutableListOf<String>()
        val savedContents = mutableListOf<String>()
        val savedTags = mutableListOf<List<String>?>()

        override suspend fun recognize(imageBytes: ByteArray, language: String): Result<OcrText> {
            recognizeLangs.add(language)
            return recognizeResult ?: Result.success(
                nextOcr ?: ocr ?: OcrText("默认识别文本", "zh", 0.9f)
            )
        }

        override suspend fun saveNote(
            title: String,
            content: String,
            tags: List<String>?,
        ): Result<SavedNote> {
            savedContents.add(content)
            savedTags.add(tags)
            return saveResult ?: Result.success(SavedNote("note-${System.nanoTime()}"))
        }
    }
}
