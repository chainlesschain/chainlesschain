package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.loader.SkillMdParser
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillCategory
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillExecutionMode
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillSource
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for SkillMdParser — YAML frontmatter + Markdown body parsing.
 */
class SkillMdParserTest {

    private lateinit var parser: SkillMdParser

    @Before
    fun setUp() {
        parser = SkillMdParser()
    }

    // ===== Frontmatter Splitting =====

    @Test
    fun `splitFrontmatter with valid frontmatter`() {
        val content = """
            |---
            |name: test-skill
            |version: 1.0.0
            |---
            |
            |# Test Skill Body
        """.trimMargin()

        val (frontmatter, body) = parser.splitFrontmatter(content)
        assertTrue(frontmatter.contains("name: test-skill"))
        assertTrue(body.contains("# Test Skill Body"))
    }

    @Test
    fun `splitFrontmatter with no frontmatter returns empty`() {
        val content = "# Just Markdown"
        val (frontmatter, body) = parser.splitFrontmatter(content)
        assertEquals("", frontmatter)
        assertEquals(content, body)
    }

    @Test
    fun `splitFrontmatter with unclosed frontmatter returns empty`() {
        val content = "---\nname: broken\nno closing delimiter"
        val (frontmatter, body) = parser.splitFrontmatter(content)
        assertEquals("", frontmatter)
        assertEquals(content, body)
    }

    // ===== YAML Parsing =====

    @Test
    fun `parseYaml handles basic key-value pairs`() {
        val yaml = """
            name: code-review
            version: 1.0.0
            description: Review code quality
        """.trimIndent()

        val data = parser.parseYaml(yaml)
        assertEquals("code-review", data["name"])
        assertEquals("1.0.0", data["version"])
        assertEquals("Review code quality", data["description"])
    }

    @Test
    fun `parseYaml handles inline arrays`() {
        val yaml = """
            name: test
            tags: [code, review, quality]
        """.trimIndent()

        val data = parser.parseYaml(yaml)
        @Suppress("UNCHECKED_CAST")
        val tags = data["tags"] as List<String>
        assertEquals(3, tags.size)
        assertTrue(tags.contains("code"))
        assertTrue(tags.contains("review"))
    }

    @Test
    fun `parseYaml handles boolean values`() {
        val yaml = """
            name: test
            user-invocable: true
            hidden: false
        """.trimIndent()

        val data = parser.parseYaml(yaml)
        assertEquals(true, data["user-invocable"])
        assertEquals(false, data["hidden"])
    }

    @Test
    fun `parseYaml handles integer values`() {
        val yaml = """
            name: test
            gate:
              minSdk: 26
        """.trimIndent()

        val data = parser.parseYaml(yaml)
        @Suppress("UNCHECKED_CAST")
        val gate = data["gate"] as Map<String, Any>
        assertEquals(26, gate["minSdk"])
    }

    // ===== Full Parsing =====

    @Test
    fun `parse complete SKILL md file`() {
        val content = """
            |---
            |name: code-review
            |display-name: Code Review
            |description: Review code for quality and bugs
            |version: 1.0.0
            |category: code
            |user-invocable: true
            |tags: [code, review, quality]
            |supported-file-types: [kt, java, py]
            |os: [android, win32, darwin, linux]
            |handler: CodeReviewHandler
            |---
            |
            |# Code Review Skill
            |
            |Performs comprehensive code review.
            |
            |## Usage
            |
            |```
            |/code-review [code snippet]
            |```
            |
            |## Examples
            |
            |```
            |/code-review fun foo() = 42
            |```
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED, "test.md")

        assertNotNull(skill)
        assertEquals("code-review", skill!!.name)
        assertEquals("Code Review", skill.metadata.displayName)
        assertEquals("Review code for quality and bugs", skill.metadata.description)
        assertEquals("1.0.0", skill.metadata.version)
        assertEquals(SkillCategory.CODE, skill.category)
        assertTrue(skill.metadata.userInvocable)
        assertEquals(3, skill.metadata.tags.size)
        assertEquals(3, skill.fileTypes.size)
        assertTrue(skill.fileTypes.contains("kt"))
        assertEquals("CodeReviewHandler", skill.metadata.handler)
        assertTrue(skill.hasHandler)
        assertEquals(SkillSource.BUNDLED, skill.source)
        assertTrue(skill.instructions.contains("Code Review Skill"))
    }

    @Test
    fun `parse skill without handler is documentation-only`() {
        val content = """
            |---
            |name: git-commit
            |description: Generate commit messages
            |category: development
            |---
            |
            |# Git Commit Skill
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertFalse(skill!!.hasHandler)
        assertNull(skill.metadata.handler)
    }

    @Test
    fun `parse returns null for empty content`() {
        val skill = parser.parse("", SkillSource.BUNDLED)
        assertNull(skill)
    }

    @Test
    fun `parse returns null for content without frontmatter`() {
        val skill = parser.parse("# Just markdown, no frontmatter", SkillSource.BUNDLED)
        assertNull(skill)
    }

    // ===== Metadata Building =====

    @Test
    fun `buildMetadata handles kebab-case fields`() {
        val data = mapOf(
            "name" to "test-skill",
            "display-name" to "Test Skill",
            "user-invocable" to true,
            "supported-file-types" to listOf("kt", "java"),
            "model-hints" to mapOf("temperature" to 0.5)
        )

        val metadata = parser.buildMetadata(data)
        assertEquals("Test Skill", metadata.displayName)
        assertTrue(metadata.userInvocable)
        assertEquals(2, metadata.fileTypes.size)
        assertEquals(0.5, metadata.modelHints["temperature"])
    }

    @Test
    fun `buildMetadata defaults category to GENERAL`() {
        val data = mapOf("name" to "test")
        val metadata = parser.buildMetadata(data)
        assertEquals(SkillCategory.GENERAL, metadata.category)
    }

    @Test
    fun `buildMetadata parses gate conditions`() {
        val data = mapOf(
            "name" to "test",
            "gate" to mapOf(
                "platform" to listOf("android"),
                "minSdk" to 28,
                "permissions" to listOf("android.permission.CAMERA")
            )
        )

        val metadata = parser.buildMetadata(data)
        assertNotNull(metadata.gate)
        assertEquals(listOf("android"), metadata.gate!!.platform)
        assertEquals(28, metadata.gate!!.minSdk)
        assertEquals(1, metadata.gate!!.requiredPermissions!!.size)
    }

    // ===== Example Extraction =====

    @Test
    fun `parse extracts code examples from Examples section`() {
        val content = """
            |---
            |name: test
            |description: Test skill
            |---
            |
            |# Test
            |
            |## Examples
            |
            |```
            |/test hello world
            |```
            |
            |```
            |/test --verbose
            |```
            |
            |## Other Section
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertEquals(2, skill!!.examples.size)
        assertTrue(skill.examples[0].contains("/test hello world"))
        assertTrue(skill.examples[1].contains("/test --verbose"))
    }

    // ===== Execution Mode =====

    @Test
    fun `parse handles execution-mode local`() {
        val content = """
            |---
            |name: summarize
            |description: Summarize text
            |execution-mode: local
            |---
            |
            |# Summarize Skill
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertEquals(SkillExecutionMode.LOCAL, skill!!.metadata.executionMode)
    }

    @Test
    fun `parse handles execution-mode remote`() {
        val content = """
            |---
            |name: browser-automation
            |description: Automate browser
            |execution-mode: remote
            |---
            |
            |# Browser Automation Skill
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertEquals(SkillExecutionMode.REMOTE, skill!!.metadata.executionMode)
    }

    @Test
    fun `parse handles execution-mode hybrid`() {
        val content = """
            |---
            |name: web-scraping
            |description: Scrape web
            |execution-mode: hybrid
            |---
            |
            |# Web Scraping Skill
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertEquals(SkillExecutionMode.HYBRID, skill!!.metadata.executionMode)
    }

    @Test
    fun `parse defaults execution-mode to LOCAL when not specified`() {
        val content = """
            |---
            |name: test-skill
            |description: No execution mode
            |---
            |
            |# Test
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertEquals(SkillExecutionMode.LOCAL, skill!!.metadata.executionMode)
    }

    @Test
    fun `buildMetadata parses executionMode camelCase variant`() {
        val data = mapOf(
            "name" to "test",
            "executionMode" to "remote"
        )
        val metadata = parser.buildMetadata(data)
        assertEquals(SkillExecutionMode.REMOTE, metadata.executionMode)
    }

    // ===== Remote Skill Name =====

    @Test
    fun `parse handles remote-skill-name kebab-case`() {
        val content = """
            |---
            |name: pc-screenshot
            |description: Take PC screenshot
            |execution-mode: remote
            |remote-skill-name: computer-use
            |category: remote
            |---
            |
            |# PC Screenshot Skill
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertEquals(SkillExecutionMode.REMOTE, skill!!.metadata.executionMode)
        assertEquals("computer-use", skill.metadata.remoteSkillName)
    }

    @Test
    fun `parse handles remoteSkillName camelCase`() {
        val data = mapOf(
            "name" to "pc-run-command",
            "executionMode" to "remote",
            "remoteSkillName" to "remote-control"
        )
        val metadata = parser.buildMetadata(data)
        assertEquals(SkillExecutionMode.REMOTE, metadata.executionMode)
        assertEquals("remote-control", metadata.remoteSkillName)
    }

    @Test
    fun `parse defaults remoteSkillName to null when not specified`() {
        val content = """
            |---
            |name: code-review
            |description: Review code
            |execution-mode: local
            |---
            |
            |# Code Review
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertNull(skill!!.metadata.remoteSkillName)
    }

    // ===== Input Schema =====

    @Test
    fun `parse handles input-schema with parameters`() {
        val content = """
            |---
            |name: test
            |description: Test
            |input-schema:
            |  - name: code
            |    type: string
            |    description: The code to review
            |    required: true
            |  - name: language
            |    type: string
            |    description: Programming language
            |    required: false
            |---
            |
            |# Test
        """.trimMargin()

        val skill = parser.parse(content, SkillSource.BUNDLED)
        assertNotNull(skill)
        assertEquals(2, skill!!.metadata.inputSchema.size)

        val firstParam = skill.metadata.inputSchema[0]
        assertEquals("code", firstParam.name)
        assertEquals("string", firstParam.type)
        assertTrue(firstParam.required)

        val secondParam = skill.metadata.inputSchema[1]
        assertEquals("language", secondParam.name)
        assertFalse(secondParam.required)
    }
}
