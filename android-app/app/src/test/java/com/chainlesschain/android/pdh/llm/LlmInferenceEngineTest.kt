package com.chainlesschain.android.pdh.llm

import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A3.3 unit tests — [LlmInferenceEngine] contract + [NoOpLlmInferenceEngine]
 * default behavior. Pure JVM unit tests, no Android/JNI required.
 */
class LlmInferenceEngineTest {

    @Test
    fun `noop engine name and isLocal`() {
        assertEquals("noop-llm", NoOpLlmInferenceEngine.name)
        assertTrue(NoOpLlmInferenceEngine.isLocal)
    }

    @Test
    fun `noop engine health reports not ready`() = runTest {
        val h = NoOpLlmInferenceEngine.health()
        assertFalse(h.ready)
        assertFalse(h.modelLoaded)
        assertNull(h.modelName)
        assertNotNull(h.reason)
        assertTrue(h.reason!!.contains("未就绪") || h.reason!!.contains("not wired"))
    }

    @Test
    fun `noop engine chat throws LlmInferenceException`() = runTest {
        val ex = assertFails {
            NoOpLlmInferenceEngine.chat(
                listOf(LlmInferenceEngine.ChatMessage("user", "hi")),
            )
        }
        assertTrue(ex is LlmInferenceException)
        assertNotNull(ex.message)
        assertTrue(ex.message!!.contains("未就绪") || ex.message!!.contains("not wired"))
    }

    @Test
    fun `ChatOptions defaults`() {
        val o = LlmInferenceEngine.ChatOptions()
        assertEquals(0.2f, o.temperature)
        assertEquals(512, o.maxTokens)
        assertEquals(4096, o.numCtx)
    }

    @Test
    fun `ChatResponse defaults`() {
        val r = LlmInferenceEngine.ChatResponse(text = "hi")
        assertEquals("hi", r.text)
        assertEquals(0, r.promptTokens)
        assertEquals(0, r.completionTokens)
        assertEquals(0L, r.totalDurationMs)
    }

    @Test
    fun `HealthStatus ready-with-model shape`() {
        val h = LlmInferenceEngine.HealthStatus(
            ready = true,
            modelLoaded = true,
            modelName = "qwen2.5-1.5b-instruct",
            reason = null,
        )
        assertTrue(h.ready)
        assertTrue(h.modelLoaded)
        assertEquals("qwen2.5-1.5b-instruct", h.modelName)
        assertNull(h.reason)
    }
}
