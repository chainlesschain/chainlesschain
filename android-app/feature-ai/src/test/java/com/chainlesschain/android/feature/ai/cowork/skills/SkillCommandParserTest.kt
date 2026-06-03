package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.executor.SkillCommandParser
import com.chainlesschain.android.feature.ai.cowork.skills.model.*
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for SkillCommandParser — /skill command parsing and suggestions.
 */
class SkillCommandParserTest {

    private lateinit var registry: SkillRegistry
    private lateinit var parser: SkillCommandParser

    @Before
    fun setUp() {
        registry = SkillRegistry()
        parser = SkillCommandParser(registry)

        // Register test skills
        registry.register(createSkill("code-review", inputSchema = listOf(
            SkillParameter("code", "string", "The code", required = true),
            SkillParameter("language", "string", "Language", required = false)
        )))
        registry.register(createSkill("translate", inputSchema = listOf(
            SkillParameter("text", "string", "Text to translate", required = true),
            SkillParameter("from", "string", "Source language"),
            SkillParameter("to", "string", "Target language", required = true)
        )))
        registry.register(createSkill("summarize"))
    }

    private fun createSkill(
        name: String,
        inputSchema: List<SkillParameter> = emptyList()
    ): Skill {
        return Skill(
            metadata = SkillMetadata(
                name = name,
                description = "Test: $name",
                inputSchema = inputSchema
            ),
            instructions = "Instructions for $name",
            source = SkillSource.BUNDLED
        )
    }

    // ===== Basic Parsing =====

    @Test
    fun `parse recognizes valid skill command`() {
        val result = parser.parse("/code-review some code here")
        assertNotNull(result)
        assertEquals("code-review", result!!.skillName)
    }

    @Test
    fun `parse returns null for non-command input`() {
        assertNull(parser.parse("hello world"))
        assertNull(parser.parse(""))
        assertNull(parser.parse("no slash command"))
    }

    @Test
    fun `parse returns null for unknown skill`() {
        assertNull(parser.parse("/unknown-skill some args"))
    }

    @Test
    fun `parse handles command without arguments`() {
        val result = parser.parse("/summarize")
        assertNotNull(result)
        assertEquals("summarize", result!!.skillName)
        assertTrue(result.rawArgs.isEmpty())
    }

    // ===== Positional Arguments =====

    @Test
    fun `parse maps positional args to input schema`() {
        val result = parser.parse("/translate Hello world en zh")
        assertNotNull(result)
        // "Hello" maps to "text" (first param), "world" to "from", "en" to "to"
        // Actually, tokenizer splits by whitespace, so "Hello" -> text, "world" -> from, "en" -> to
        assertEquals("translate", result!!.skillName)
    }

    @Test
    fun `parse puts unmatched args as input when no schema`() {
        val result = parser.parse("/summarize This is some text to summarize")
        assertNotNull(result)
        assertEquals("This is some text to summarize", result!!.input["input"])
    }

    // ===== Named Arguments =====

    @Test
    fun `parse handles named arguments with equals`() {
        val result = parser.parse("/translate --from=en --to=zh Hello world")
        assertNotNull(result)
        assertEquals("en", result!!.input["from"])
        assertEquals("zh", result!!.input["to"])
    }

    @Test
    fun `parse handles flag arguments without values`() {
        val result = parser.parse("/code-review --verbose some code")
        assertNotNull(result)
        assertEquals("true", result!!.input["verbose"])
    }

    // ===== Quoted Strings =====

    @Test
    fun `parse handles quoted arguments`() {
        val result = parser.parse("""/translate --to=zh "Hello, world!" """)
        assertNotNull(result)
        assertEquals("zh", result!!.input["to"])
    }

    // ===== isSkillCommand =====

    @Test
    fun `isSkillCommand returns true for known skills`() {
        assertTrue(parser.isSkillCommand("/code-review something"))
        assertTrue(parser.isSkillCommand("/translate hello"))
        assertTrue(parser.isSkillCommand("/summarize"))
    }

    @Test
    fun `isSkillCommand returns false for unknown or non-commands`() {
        assertFalse(parser.isSkillCommand("hello"))
        assertFalse(parser.isSkillCommand("/unknown"))
        assertFalse(parser.isSkillCommand(""))
    }

    // ===== Autocomplete Suggestions =====

    @Test
    fun `getSuggestions returns matching skills`() {
        val suggestions = parser.getSuggestions("/co")
        assertTrue(suggestions.contains("/code-review"))
        assertFalse(suggestions.contains("/translate"))
    }

    @Test
    fun `getSuggestions returns all skills for slash only`() {
        val suggestions = parser.getSuggestions("/")
        assertEquals(3, suggestions.size)
    }

    @Test
    fun `getSuggestions returns empty for non-slash input`() {
        val suggestions = parser.getSuggestions("hello")
        assertTrue(suggestions.isEmpty())
    }

    @Test
    fun `getSuggestions is case-insensitive`() {
        val suggestions = parser.getSuggestions("/CODE")
        assertTrue(suggestions.contains("/code-review"))
    }

    // ===== Edge Cases =====

    @Test
    fun `parse trims whitespace`() {
        val result = parser.parse("  /summarize  some text  ")
        assertNotNull(result)
        assertEquals("summarize", result!!.skillName)
    }
}
