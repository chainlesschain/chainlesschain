package com.chainlesschain.android.pdh.llm

import android.content.Context
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
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
 * §2.1 A3.3 — KotlinLlamaCppEngine 单测。
 *
 * Native lib (kotlinllamacpp .so) 不可在 JVM 单测中真加载，所以 test 走
 * `nativeLoadedOverride = false` (健康路径 fail-fast)。真机的真 native chat
 * 路径需 Mac/Linux + Android NDK + 真机 instrumented test，v0.2 真接通时
 * 写 androidTest 端覆盖。
 */
class KotlinLlamaCppEngineTest {

    private lateinit var modelManager: ModelManager
    private lateinit var context: Context

    @Before
    fun setUp() {
        modelManager = mockk()
        // ModelManager.refresh() defaults its spec arg to selectedSpec.value;
        // the generated default-arg bridge reads the property before the call
        // is dispatched to mockk, so strict-mode throws on unstubbed access
        // and the engine's try/catch turns the result into a "refresh threw"
        // HealthStatus that bypasses the per-state assertions.
        every { modelManager.selectedSpec } returns MutableStateFlow(
            ModelManager.ModelSpec(
                key = "test-spec",
                filename = "qwen.gguf",
                urls = listOf("https://hf-mirror.com/test/path"),
                expectedSha256 = null,
                sizeBytesApprox = 0L,
                displayName = "Test Spec",
            )
        )
        context = mockk(relaxed = true)
    }

    private fun newEngine(): KotlinLlamaCppEngine = KotlinLlamaCppEngine(modelManager, context)

    @Test
    fun `name reflects backend label`() {
        val engine = newEngine()
        assertEquals("kotlinllamacpp", engine.name)
        assertTrue(engine.isLocal)
    }

    @Test
    fun `health reports native lib unavailable when no so loaded`() = runBlocking {
        val engine = newEngine().apply { nativeLoadedOverride = false }
        val h = engine.health()
        assertFalse(h.ready)
        assertFalse(h.modelLoaded)
        assertNull(h.modelName)
        assertNotNull(h.reason)
        assertTrue(h.reason!!.contains("native lib"))
    }

    @Test
    fun `health reports model NotDownloaded when native loaded but no model`() = runBlocking {
        val engine = newEngine().apply { nativeLoadedOverride = true }
        coEvery { modelManager.refresh(any()) } returns ModelManager.State.NotDownloaded
        val h = engine.health()
        assertFalse(h.ready)
        assertFalse(h.modelLoaded)
        assertNotNull(h.reason)
        assertTrue(h.reason!!.contains("未下载"))
    }

    @Test
    fun `health reports Downloading progress`() = runBlocking {
        val engine = newEngine().apply { nativeLoadedOverride = true }
        coEvery { modelManager.refresh(any()) } returns
            ModelManager.State.Downloading(receivedBytes = 500_000_000L, totalBytes = 1_000_000_000L)
        val h = engine.health()
        assertFalse(h.ready)
        assertFalse(h.modelLoaded)
        assertNotNull(h.reason)
        assertTrue(h.reason!!.contains("50%"))
    }

    @Test
    fun `health reports Ready but ctx still 0 — needs first chat to lazy load`() = runBlocking {
        val engine = newEngine().apply { nativeLoadedOverride = true }
        val fakeFile = File("/tmp/qwen.gguf")
        coEvery { modelManager.refresh(any()) } returns
            ModelManager.State.Ready(file = fakeFile, sha256 = "stub-sha")
        val h = engine.health()
        assertFalse(h.ready, "ready false because contextHandle=0 (lazy load on first chat)")
        assertTrue(h.modelLoaded)
        assertEquals("qwen.gguf", h.modelName)
        assertNotNull(h.reason)
        assertTrue(h.reason!!.contains("等首次 chat 调用"))
    }

    @Test
    fun `health reports Failed model state`() = runBlocking {
        val engine = newEngine().apply { nativeLoadedOverride = true }
        coEvery { modelManager.refresh(any()) } returns
            ModelManager.State.Failed("checksum mismatch")
        val h = engine.health()
        assertFalse(h.ready)
        assertNotNull(h.reason)
        assertTrue(h.reason!!.contains("checksum mismatch"))
    }

    @Test
    fun `chat throws LlmInferenceException when native lib unavailable`() = runBlocking {
        val engine = newEngine().apply { nativeLoadedOverride = false }
        try {
            engine.chat(listOf(LlmInferenceEngine.ChatMessage("user", "hello")))
            fail("expected LlmInferenceException")
        } catch (e: LlmInferenceException) {
            assertTrue(e.message?.contains("native lib") == true)
        }
    }
}
