package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.executor.SkillExecutor
import com.chainlesschain.android.feature.ai.cowork.skills.model.*
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import io.mockk.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for SkillInvoker — public facade for cross-feature skill invocation.
 */
class SkillInvokerTest {

    private lateinit var mockExecutor: SkillExecutor
    private lateinit var registry: SkillRegistry
    private lateinit var invoker: SkillInvoker

    @Before
    fun setUp() {
        mockExecutor = mockk()
        registry = SkillRegistry()
        invoker = SkillInvoker(mockExecutor, registry)

        // Register test skills
        registry.register(Skill(
            metadata = SkillMetadata(name = "summarize", description = "Summarize text", category = SkillCategory.GENERAL),
            instructions = "Summarize the input text.",
            source = SkillSource.BUNDLED
        ))
        registry.register(Skill(
            metadata = SkillMetadata(name = "code-review", description = "Review code", category = SkillCategory.CODE),
            instructions = "Review the code.",
            source = SkillSource.BUNDLED
        ))
        registry.register(Skill(
            metadata = SkillMetadata(name = "disabled-skill", description = "Disabled"),
            instructions = "Should not be available.",
            source = SkillSource.BUNDLED,
            enabled = false
        ))
    }

    @Test
    fun `invoke with string input calls executor`() = runBlocking {
        coEvery { mockExecutor.execute("summarize", mapOf("input" to "Long text")) } returns
                SkillResult(success = true, output = "Short summary")

        val result = invoker.invoke("summarize", "Long text")
        assertTrue(result.success)
        assertEquals("Short summary", result.output)
    }

    @Test
    fun `invoke with map input calls executor`() = runBlocking {
        val input = mapOf<String, Any>("code" to "fun test()", "language" to "kotlin")
        coEvery { mockExecutor.execute("code-review", input) } returns
                SkillResult(success = true, output = "Looks good!")

        val result = invoker.invoke("code-review", input)
        assertTrue(result.success)
        assertEquals("Looks good!", result.output)
    }

    @Test
    fun `getSkillsForCategory returns skills in category`() {
        val codeSkills = invoker.getSkillsForCategory(SkillCategory.CODE)
        assertEquals(1, codeSkills.size)
        assertEquals("code-review", codeSkills[0].name)
    }

    @Test
    fun `isAvailable returns true for registered enabled skill`() {
        assertTrue(invoker.isAvailable("summarize"))
    }

    @Test
    fun `isAvailable returns false for disabled skill`() {
        assertFalse(invoker.isAvailable("disabled-skill"))
    }

    @Test
    fun `isAvailable returns false for non-existent skill`() {
        assertFalse(invoker.isAvailable("nonexistent"))
    }

    @Test
    fun `listAvailable returns invocable skill names`() {
        val available = invoker.listAvailable()
        assertTrue(available.contains("summarize"))
        assertTrue(available.contains("code-review"))
        assertFalse(available.contains("disabled-skill"))
    }
}
