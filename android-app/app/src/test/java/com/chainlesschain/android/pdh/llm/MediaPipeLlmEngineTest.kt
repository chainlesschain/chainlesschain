package com.chainlesschain.android.pdh.llm

import android.content.Context
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * §2.1 A3.3 v0.2 — MediaPipeLlmEngine unit cover.
 *
 * 重点验证 fail-fast 路径：JVM 模式没有 MediaPipe AAR 在测试 classpath，
 * `probeNative` 应返回 false，所有 chat() 调用应抛 LlmInferenceException 且
 * 信息可读。`nativeLoadedOverride` 测试 seam 同 KotlinLlamaCppEngine 模式。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MediaPipeLlmEngineTest {

    private lateinit var modelManager: ModelManager
    private lateinit var context: Context

    @Before
    fun setUp() {
        modelManager = mockk(relaxed = false)
        context = mockk(relaxed = true)
    }

    private fun newEngine(): MediaPipeLlmEngine =
        MediaPipeLlmEngine(modelManager, context)

    @Test
    fun `name is mediapipe-genai`() {
        assertEquals("mediapipe-genai", newEngine().name)
    }

    @Test
    fun `isLocal is true (on-device by construction)`() {
        assertTrue(newEngine().isLocal)
    }

    @Test
    fun `nativeReady=false when MediaPipe class not on classpath`() {
        // Default JVM unit-test classpath does NOT include the tasks-genai AAR's
        // runtime classes. probeNative should detect this via Class.forName and
        // return false without throwing.
        val engine = newEngine().apply { nativeLoadedOverride = null }
        assertFalse(engine.nativeReady)
    }

    @Test
    fun `nativeReady follows nativeLoadedOverride when set`() {
        val e1 = newEngine().apply { nativeLoadedOverride = true }
        assertTrue(e1.nativeReady)
        val e2 = newEngine().apply { nativeLoadedOverride = false }
        assertFalse(e2.nativeReady)
    }

    @Test
    fun `health reports nativeReady=false reason when classpath missing`() = runTest {
        val engine = newEngine().apply { nativeLoadedOverride = false }
        val h = engine.health()
        assertFalse(h.ready)
        assertFalse(h.modelLoaded)
        assertNull(h.modelName)
        assertNotNull(h.reason)
        assertTrue(
            h.reason!!.contains("MediaPipe", ignoreCase = true) ||
                h.reason!!.contains("JVM", ignoreCase = true) ||
                h.reason!!.contains("classpath", ignoreCase = true),
            "reason should mention MediaPipe / JVM / classpath but was: ${h.reason}",
        )
    }

    @Test
    fun `health reports model-not-downloaded when ModelManager NotDownloaded`() = runTest {
        coEvery { modelManager.refresh(any()) } returns ModelManager.State.NotDownloaded
        val engine = newEngine().apply { nativeLoadedOverride = true }
        val h = engine.health()
        assertFalse(h.ready)
        assertFalse(h.modelLoaded)
        assertNotNull(h.reason)
        assertTrue(h.reason!!.contains(".task") || h.reason!!.contains("未下载"))
    }

    @Test
    fun `health reports model-ready but lazy-load when ModelManager Ready`() = runTest {
        val fakeFile = File("/tmp/gemma3-1b-it-int4.task")
        coEvery { modelManager.refresh(any()) } returns ModelManager.State.Ready(
            file = fakeFile, sha256 = "abc",
        )
        val engine = newEngine().apply { nativeLoadedOverride = true }
        val h = engine.health()
        // sessionRef is null (chat never called) so ready=false but modelLoaded=true
        assertFalse(h.ready)
        assertTrue(h.modelLoaded)
        assertEquals("gemma3-1b-it-int4.task", h.modelName)
    }

    @Test
    fun `health reports downloading state with fraction`() = runTest {
        coEvery { modelManager.refresh(any()) } returns ModelManager.State.Downloading(
            receivedBytes = 250_000_000L, totalBytes = 500_000_000L,
        )
        val engine = newEngine().apply { nativeLoadedOverride = true }
        val h = engine.health()
        assertFalse(h.ready)
        assertNotNull(h.reason)
        assertTrue(h.reason!!.contains("50%") || h.reason!!.contains("250"))
    }

    @Test
    fun `chat throws LlmInferenceException when nativeReady=false`() = runTest {
        val engine = newEngine().apply { nativeLoadedOverride = false }
        try {
            engine.chat(
                listOf(LlmInferenceEngine.ChatMessage(role = "user", content = "test")),
            )
            fail("Expected LlmInferenceException")
        } catch (e: LlmInferenceException) {
            assertTrue(
                e.message?.contains("MediaPipe", ignoreCase = true) == true ||
                    e.message?.contains("未加载", ignoreCase = true) == true,
                "exception message should mention MediaPipe/未加载 but was: ${e.message}",
            )
        }
    }
}
