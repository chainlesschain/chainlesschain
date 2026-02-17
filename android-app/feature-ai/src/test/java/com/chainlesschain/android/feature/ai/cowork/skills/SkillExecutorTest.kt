package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.bridge.P2PSkillBridge
import com.chainlesschain.android.feature.ai.cowork.skills.executor.SkillExecutor
import com.chainlesschain.android.feature.ai.cowork.skills.gating.GateResult
import com.chainlesschain.android.feature.ai.cowork.skills.gating.SkillGating
import com.chainlesschain.android.feature.ai.cowork.skills.handler.SkillHandler
import com.chainlesschain.android.feature.ai.cowork.skills.model.*
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import io.mockk.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for SkillExecutor — handler dispatch, LLM fallback, gate checks,
 * and execution routing (local/remote/hybrid).
 */
class SkillExecutorTest {

    private lateinit var registry: SkillRegistry
    private lateinit var gating: SkillGating
    private lateinit var mockHandler: SkillHandler
    private lateinit var mockLlmAdapter: LLMAdapter
    private lateinit var mockP2PBridge: P2PSkillBridge
    private lateinit var executor: SkillExecutor

    @Before
    fun setUp() {
        registry = SkillRegistry()
        gating = mockk()
        mockHandler = mockk()
        mockLlmAdapter = mockk()
        mockP2PBridge = mockk()

        every { mockHandler.skillName } returns "code-review"

        val handlers = mapOf("code-review" to mockHandler)
        executor = SkillExecutor(registry, gating, handlers, mockLlmAdapter, mockP2PBridge)

        // Register skills
        registry.register(Skill(
            metadata = SkillMetadata(
                name = "code-review",
                description = "Review code",
                handler = "CodeReviewHandler",
                executionMode = SkillExecutionMode.LOCAL
            ),
            instructions = "Review this code carefully.",
            source = SkillSource.BUNDLED
        ))
        registry.register(Skill(
            metadata = SkillMetadata(
                name = "git-commit",
                description = "Generate commit",
                executionMode = SkillExecutionMode.LOCAL
            ),
            instructions = "Generate a conventional commit message.",
            source = SkillSource.BUNDLED
        ))
        registry.register(Skill(
            metadata = SkillMetadata(
                name = "browser-automation",
                description = "Automate browser tasks",
                executionMode = SkillExecutionMode.REMOTE
            ),
            instructions = "Automate browser tasks on desktop.",
            source = SkillSource.BUNDLED
        ))
        registry.register(Skill(
            metadata = SkillMetadata(
                name = "web-scraping",
                description = "Scrape web data",
                executionMode = SkillExecutionMode.HYBRID
            ),
            instructions = "Extract data from web pages.",
            source = SkillSource.BUNDLED
        ))
    }

    // ===== Skill Not Found =====

    @Test
    fun `execute returns error for unknown skill`() = runBlocking {
        val result = executor.execute("nonexistent", emptyMap())
        assertFalse(result.success)
        assertTrue(result.error!!.contains("not found"))
    }

    // ===== Gate Check =====

    @Test
    fun `execute returns error when gate check fails`() = runBlocking {
        every { gating.check(any()) } returns GateResult(false, "Not supported on Android")

        val result = executor.execute("code-review", mapOf("code" to "test"))
        assertFalse(result.success)
        assertEquals("Not supported on Android", result.error)
    }

    // ===== Handler Dispatch (LOCAL) =====

    @Test
    fun `execute uses Kotlin handler when available`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockHandler.execute(any(), any(), any()) } returns SkillResult(
            success = true,
            output = "Code review completed"
        )

        val result = executor.execute("code-review", mapOf("code" to "fun test() {}"))
        assertTrue(result.success)
        assertEquals("Code review completed", result.output)

        coVerify { mockHandler.execute(any(), any(), any()) }
    }

    // ===== LLM Prompt Fallback (LOCAL) =====

    @Test
    fun `execute falls back to LLM prompt for skills without handler`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns "feat: add login feature"

        val result = executor.execute("git-commit", mapOf("changes" to "Added login page"))
        assertTrue(result.success)
        assertEquals("feat: add login feature", result.output)

        coVerify { mockLlmAdapter.chat(any(), any(), any(), any()) }
    }

    // ===== REMOTE Execution =====

    @Test
    fun `execute delegates to P2PSkillBridge for REMOTE skills`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockP2PBridge.executeRemote("browser-automation", any()) } returns SkillResult(
            success = true,
            output = "Browser automation completed on desktop"
        )

        val result = executor.execute("browser-automation", mapOf("url" to "https://example.com"))
        assertTrue(result.success)
        assertEquals("Browser automation completed on desktop", result.output)

        coVerify { mockP2PBridge.executeRemote("browser-automation", any()) }
        coVerify(exactly = 0) { mockLlmAdapter.chat(any(), any(), any(), any()) }
    }

    @Test
    fun `REMOTE execution returns error when desktop not connected`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockP2PBridge.executeRemote("browser-automation", any()) } returns SkillResult(
            success = false,
            output = "",
            error = "No desktop peer connected. Connect to a desktop to use this skill."
        )

        val result = executor.execute("browser-automation", mapOf("url" to "https://example.com"))
        assertFalse(result.success)
        assertTrue(result.error!!.contains("desktop"))
    }

    // ===== REMOTE with remoteSkillName =====

    @Test
    fun `REMOTE uses remoteSkillName when available`() = runBlocking {
        // Register a skill with remoteSkillName
        registry.register(Skill(
            metadata = SkillMetadata(
                name = "pc-screenshot",
                description = "Take PC screenshot",
                executionMode = SkillExecutionMode.REMOTE,
                remoteSkillName = "computer-use"
            ),
            instructions = "Take a screenshot of the PC.",
            source = SkillSource.BUNDLED
        ))

        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockP2PBridge.executeRemote("computer-use", any()) } returns SkillResult(
            success = true,
            output = "Screenshot captured"
        )

        val result = executor.execute("pc-screenshot", mapOf("action" to "screenshot"))
        assertTrue(result.success)
        assertEquals("Screenshot captured", result.output)

        // Should call with remoteSkillName, NOT the Android skill name
        coVerify { mockP2PBridge.executeRemote("computer-use", any()) }
        coVerify(exactly = 0) { mockP2PBridge.executeRemote("pc-screenshot", any()) }
    }

    @Test
    fun `REMOTE falls back to skill name when remoteSkillName is null`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockP2PBridge.executeRemote("browser-automation", any()) } returns SkillResult(
            success = true,
            output = "Done"
        )

        val result = executor.execute("browser-automation", mapOf("url" to "https://example.com"))
        assertTrue(result.success)

        // Should use skill.name since remoteSkillName is null
        coVerify { mockP2PBridge.executeRemote("browser-automation", any()) }
    }

    // ===== HYBRID Execution =====

    @Test
    fun `HYBRID executes locally when local succeeds`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } returns "Scraped data: ..."

        val result = executor.execute("web-scraping", mapOf("url" to "https://example.com"))
        assertTrue(result.success)
        assertEquals("Scraped data: ...", result.output)

        // Should NOT have called P2P bridge since local succeeded
        coVerify(exactly = 0) { mockP2PBridge.executeRemote(any(), any()) }
    }

    @Test
    fun `HYBRID falls back to remote when local fails and desktop connected`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        // Local LLM fails
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } throws RuntimeException("LLM unavailable")
        every { mockP2PBridge.isDesktopConnected } returns true
        coEvery { mockP2PBridge.executeRemote("web-scraping", any()) } returns SkillResult(
            success = true,
            output = "Desktop scraped data"
        )

        val result = executor.execute("web-scraping", mapOf("url" to "https://example.com"))
        assertTrue(result.success)
        assertEquals("Desktop scraped data", result.output)

        coVerify { mockP2PBridge.executeRemote("web-scraping", any()) }
    }

    @Test
    fun `HYBRID returns local error when desktop not connected`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } throws RuntimeException("LLM unavailable")
        every { mockP2PBridge.isDesktopConnected } returns false

        val result = executor.execute("web-scraping", mapOf("url" to "https://example.com"))
        assertFalse(result.success)
        assertTrue(result.error!!.contains("LLM unavailable"))
    }

    // ===== Timeout =====

    @Test
    fun `execute handles timeout`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockHandler.execute(any(), any(), any()) } coAnswers {
            kotlinx.coroutines.delay(5000)
            SkillResult(success = true, output = "late")
        }

        val result = executor.execute("code-review", mapOf("code" to "test"), timeoutMs = 100)
        assertFalse(result.success)
        assertTrue(result.error!!.contains("timed out"))
    }

    // ===== Exception Handling =====

    @Test
    fun `execute handles handler exception`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockHandler.execute(any(), any(), any()) } throws RuntimeException("Handler crashed")

        val result = executor.execute("code-review", mapOf("code" to "test"))
        assertFalse(result.success)
        assertTrue(result.error!!.contains("Handler crashed"))
    }

    @Test
    fun `execute handles LLM exception`() = runBlocking {
        every { gating.check(any()) } returns GateResult(true)
        coEvery { mockLlmAdapter.chat(any(), any(), any(), any()) } throws RuntimeException("LLM unavailable")

        val result = executor.execute("git-commit", mapOf("changes" to "test"))
        assertFalse(result.success)
        assertTrue(result.error!!.contains("LLM unavailable"))
    }
}
