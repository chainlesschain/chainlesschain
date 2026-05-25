package com.chainlesschain.android.pdh.llm

import android.content.Context
import io.mockk.coEvery
import io.mockk.every
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
        // formatPrompt() reads `modelManager.defaultSpec.promptFamily` on every
        // chat() — stub once here so individual tests don't repeat it. Strict
        // mockk (relaxed=false) otherwise throws MockKException as soon as the
        // property is touched, masking the actual code path we're trying to
        // assert (guard, ensureLoadedLocked, etc.).
        every { modelManager.defaultSpec } returns ModelManager.ModelSpec(
            filename = "test.task",
            urls = emptyList(),
            expectedSha256 = null,
            sizeBytesApprox = 0L,
            displayName = "test",
            promptFamily = ModelManager.PromptFamily.QWEN_CHATML,
        )
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

    /**
     * Fix C — trap #22 regression guard.
     *
     * Reproduces the contact-question crash: PDH-gathered prompt (~5000+
     * estimated tokens) hits MediaPipe with a session built for maxTokens=512.
     * Before the fix this would reach `nativePredictSync` → OUT_OF_RANGE →
     * SIGABRT. After the fix the engine must short-circuit in Kotlin with a
     * readable [LlmInferenceException]. Test runs in pure JVM — the guard
     * triggers BEFORE `ensureLoadedLocked`, so no MediaPipe class load needed.
     */
    @Test
    fun `chat refuses oversized prompt before calling native (fix C, trap 22)`() = runTest {
        val engine = newEngine().apply { nativeLoadedOverride = true }
        // ~5000 estimated tokens (20_000 chars / 4); ctx window 512 → must refuse.
        val bigContent = "x".repeat(20_000)
        try {
            engine.chat(
                messages = listOf(LlmInferenceEngine.ChatMessage(role = "user", content = bigContent)),
                opts = LlmInferenceEngine.ChatOptions(maxTokens = 512),
            )
            fail("Expected LlmInferenceException for oversized prompt")
        } catch (e: LlmInferenceException) {
            val msg = e.message.orEmpty()
            assertTrue(
                msg.contains("过长") || msg.contains("token") || msg.contains("上下文"),
                "guard message should explain overflow but was: $msg",
            )
        }
    }

    /**
     * Counterpart — normal-size prompt with generous ctx window must flow past
     * the guard. JVM has no real MediaPipe so the call still fails downstream
     * (in `ensureLoadedLocked` → ModelManager mock), but the message must NOT
     * mention 过长 — confirming the guard didn't over-trigger.
     */
    @Test
    fun `chat allows normal-size prompt past guard (fix C false-positive check)`() = runTest {
        coEvery { modelManager.refresh(any()) } returns ModelManager.State.NotDownloaded
        val engine = newEngine().apply { nativeLoadedOverride = true }
        try {
            engine.chat(
                messages = listOf(LlmInferenceEngine.ChatMessage(role = "user", content = "hi there")),
                opts = LlmInferenceEngine.ChatOptions(maxTokens = 4096),
            )
            fail("Expected LlmInferenceException from ensureLoadedLocked (no model)")
        } catch (e: LlmInferenceException) {
            val msg = e.message.orEmpty()
            assertFalse(
                msg.contains("过长"),
                "guard should not refuse short prompt under 4096-token ctx, but said: $msg",
            )
        }
    }

    /**
     * Fix C v2 — CJK-aware token estimator regression guard.
     *
     * Repro of 2026-05-25 08:41:29 SIGABRT: "提问" tab fed ~3500 Chinese
     * contact characters into the LLM. Original `chars/4` estimator said
     * ~875 "tokens" (well under 3968 threshold), so guard passed and native
     * tokenized to 4199 → JNI abort. After the CJK-aware fix, 3500 CJK chars
     * estimate as ~4200 tokens → guard refuses → readable exception instead
     * of SIGABRT.
     */
    @Test
    fun `chat refuses oversized CJK prompt that the old chars-by-4 estimator would miss`() = runTest {
        val engine = newEngine().apply { nativeLoadedOverride = true }
        // 3500 Chinese chars — old estimator says 875 token, new says ~4200.
        val cjk = "联系人".repeat(1167) // 3501 CJK chars
        try {
            engine.chat(
                messages = listOf(LlmInferenceEngine.ChatMessage(role = "user", content = cjk)),
                opts = LlmInferenceEngine.ChatOptions(maxTokens = 4096),
            )
            fail("Expected LlmInferenceException — CJK guard should refuse")
        } catch (e: LlmInferenceException) {
            val msg = e.message.orEmpty()
            assertTrue(
                msg.contains("过长") && msg.contains("token"),
                "guard message should explain CJK token overflow but was: $msg",
            )
        }
    }

    @Test
    fun `estimateTokens CJK char counts ~1_2 per char`() {
        val engine = newEngine()
        // 100 CJK chars → ~120 tokens (1.2 per char)
        assertEquals(120, engine.estimateTokens("中".repeat(100)))
        // 1000 CJK chars → ~1200 tokens
        assertEquals(1200, engine.estimateTokens("联系人".repeat(333) + "联"))
    }

    @Test
    fun `estimateTokens ASCII char counts ~0_25 per char rounded up`() {
        val engine = newEngine()
        // 100 ASCII chars → 25 tokens (chars / 4)
        assertEquals(25, engine.estimateTokens("a".repeat(100)))
        // 3 ASCII chars rounds up to 1 token (not 0)
        assertEquals(1, engine.estimateTokens("abc"))
    }

    @Test
    fun `estimateTokens mixed CJK plus ASCII sums correctly`() {
        val engine = newEngine()
        // "你好 world" — 2 CJK + 1 space + 5 ASCII = 2.4 + 1.5 = 3.9 → 3 + 2 = 5 (cjk*12/10 + (other+3)/4)
        // cjk=2 → 2*12/10 = 2
        // other=6 → (6+3)/4 = 2
        // total = 4
        assertEquals(4, engine.estimateTokens("你好 world"))
    }

    @Test
    fun `estimateTokens covers CJK punctuation halfwidth fullwidth`() {
        val engine = newEngine()
        // 「」、。 are in U+3000..U+303F or U+FF00..U+FFEF — must count as CJK
        assertTrue(engine.estimateTokens("「测试」。") > 4)
    }
}
