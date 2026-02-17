package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.model.*
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for SkillRegistry — registration, lookup, indexing, function definitions.
 */
class SkillRegistryTest {

    private lateinit var registry: SkillRegistry

    @Before
    fun setUp() {
        registry = SkillRegistry()
    }

    private fun createSkill(
        name: String,
        category: SkillCategory = SkillCategory.CODE,
        fileTypes: List<String> = emptyList(),
        tags: List<String> = emptyList(),
        source: SkillSource = SkillSource.BUNDLED,
        userInvocable: Boolean = true,
        hidden: Boolean = false,
        inputSchema: List<SkillParameter> = emptyList()
    ): Skill {
        return Skill(
            metadata = SkillMetadata(
                name = name,
                displayName = name.replaceFirstChar { it.uppercase() },
                description = "Test skill: $name",
                category = category,
                fileTypes = fileTypes,
                tags = tags,
                userInvocable = userInvocable,
                hidden = hidden,
                inputSchema = inputSchema
            ),
            instructions = "Instructions for $name",
            source = source
        )
    }

    // ===== Registration =====

    @Test
    fun `register and find by name`() {
        val skill = createSkill("code-review")
        registry.register(skill)

        val found = registry.findByName("code-review")
        assertNotNull(found)
        assertEquals("code-review", found!!.name)
    }

    @Test
    fun `register multiple skills`() {
        registry.register(createSkill("code-review"))
        registry.register(createSkill("explain-code"))
        registry.register(createSkill("summarize"))

        assertEquals(3, registry.size)
    }

    @Test
    fun `findByName returns null for unknown skill`() {
        assertNull(registry.findByName("nonexistent"))
    }

    @Test
    fun `unregister removes skill`() {
        registry.register(createSkill("code-review"))
        assertEquals(1, registry.size)

        registry.unregister("code-review")
        assertEquals(0, registry.size)
        assertNull(registry.findByName("code-review"))
    }

    // ===== 3-Layer Override =====

    @Test
    fun `higher priority source overrides lower`() {
        val bundled = createSkill("review", source = SkillSource.BUNDLED)
        val managed = createSkill("review", source = SkillSource.MANAGED)

        registry.register(bundled)
        registry.register(managed)

        val found = registry.findByName("review")
        assertEquals(SkillSource.MANAGED, found!!.source)
    }

    @Test
    fun `workspace overrides managed and bundled`() {
        registry.register(createSkill("review", source = SkillSource.BUNDLED))
        registry.register(createSkill("review", source = SkillSource.MANAGED))
        registry.register(createSkill("review", source = SkillSource.WORKSPACE))

        val found = registry.findByName("review")
        assertEquals(SkillSource.WORKSPACE, found!!.source)
        assertEquals(1, registry.size) // Still only one "review" skill
    }

    @Test
    fun `lower priority source does not override higher`() {
        registry.register(createSkill("review", source = SkillSource.WORKSPACE))
        registry.register(createSkill("review", source = SkillSource.BUNDLED))

        val found = registry.findByName("review")
        assertEquals(SkillSource.WORKSPACE, found!!.source)
    }

    // ===== Category Index =====

    @Test
    fun `findByCategory returns correct skills`() {
        registry.register(createSkill("code-review", category = SkillCategory.CODE))
        registry.register(createSkill("explain-code", category = SkillCategory.LEARNING))
        registry.register(createSkill("refactor", category = SkillCategory.CODE))

        val codeSkills = registry.findByCategory(SkillCategory.CODE)
        assertEquals(2, codeSkills.size)
        assertTrue(codeSkills.any { it.name == "code-review" })
        assertTrue(codeSkills.any { it.name == "refactor" })
    }

    @Test
    fun `findByCategory returns empty for unused category`() {
        registry.register(createSkill("test", category = SkillCategory.CODE))
        val result = registry.findByCategory(SkillCategory.DEVOPS)
        assertTrue(result.isEmpty())
    }

    // ===== FileType Index =====

    @Test
    fun `findByFileType returns matching skills`() {
        registry.register(createSkill("kotlin-review", fileTypes = listOf("kt", "java")))
        registry.register(createSkill("python-review", fileTypes = listOf("py")))
        registry.register(createSkill("all-review", fileTypes = listOf("kt", "py", "js")))

        val kotlinSkills = registry.findByFileType("kt")
        assertEquals(2, kotlinSkills.size)
        assertTrue(kotlinSkills.any { it.name == "kotlin-review" })
        assertTrue(kotlinSkills.any { it.name == "all-review" })
    }

    @Test
    fun `findByFileType is case-insensitive`() {
        registry.register(createSkill("test", fileTypes = listOf("KT")))
        val result = registry.findByFileType("kt")
        assertEquals(1, result.size)
    }

    // ===== Tag Index =====

    @Test
    fun `findByTag returns matching skills`() {
        registry.register(createSkill("code-review", tags = listOf("code", "quality")))
        registry.register(createSkill("summarize", tags = listOf("text", "summary")))

        val codeSkills = registry.findByTag("code")
        assertEquals(1, codeSkills.size)
        assertEquals("code-review", codeSkills[0].name)
    }

    // ===== Search =====

    @Test
    fun `search matches name`() {
        registry.register(createSkill("code-review"))
        registry.register(createSkill("summarize"))

        val results = registry.search("code")
        assertEquals(1, results.size)
        assertEquals("code-review", results[0].name)
    }

    @Test
    fun `search matches description`() {
        registry.register(createSkill("my-skill"))
        // Description is "Test skill: my-skill"
        val results = registry.search("test skill")
        assertEquals(1, results.size)
    }

    @Test
    fun `search matches tags`() {
        registry.register(createSkill("review", tags = listOf("quality", "analysis")))
        val results = registry.search("analysis")
        assertEquals(1, results.size)
    }

    @Test
    fun `search is case-insensitive`() {
        registry.register(createSkill("Code-Review"))
        val results = registry.search("code-review")
        assertEquals(1, results.size)
    }

    // ===== List Invocable =====

    @Test
    fun `listInvocable excludes hidden and non-invocable skills`() {
        registry.register(createSkill("visible", userInvocable = true, hidden = false))
        registry.register(createSkill("hidden-skill", userInvocable = true, hidden = true))
        registry.register(createSkill("non-invocable", userInvocable = false, hidden = false))

        val invocable = registry.listInvocable()
        assertEquals(1, invocable.size)
        assertEquals("visible", invocable[0].name)
    }

    @Test
    fun `listInvocable excludes disabled skills`() {
        val disabled = Skill(
            metadata = SkillMetadata(name = "disabled", description = "test"),
            instructions = "test",
            source = SkillSource.BUNDLED,
            enabled = false
        )
        registry.register(disabled)

        val invocable = registry.listInvocable()
        assertTrue(invocable.isEmpty())
    }

    // ===== Function Definitions =====

    @Test
    fun `toFunctionDefinitions generates correct format`() {
        registry.register(createSkill(
            "code-review",
            inputSchema = listOf(
                SkillParameter("code", "string", "The code to review", required = true),
                SkillParameter("language", "string", "Programming language", required = false)
            )
        ))

        val definitions = registry.toFunctionDefinitions()
        assertEquals(1, definitions.size)

        val def = definitions[0]
        assertEquals("function", def["type"])

        @Suppress("UNCHECKED_CAST")
        val function = def["function"] as Map<String, Any>
        assertEquals("code-review", function["name"])

        @Suppress("UNCHECKED_CAST")
        val params = function["parameters"] as Map<String, Any>
        assertEquals("object", params["type"])

        @Suppress("UNCHECKED_CAST")
        val props = params["properties"] as Map<String, Any>
        assertTrue(props.containsKey("code"))
        assertTrue(props.containsKey("language"))

        @Suppress("UNCHECKED_CAST")
        val required = params["required"] as List<String>
        assertTrue(required.contains("code"))
        assertFalse(required.contains("language"))
    }

    @Test
    fun `toFunctionDefinitions adds generic input for skills without schema`() {
        registry.register(createSkill("simple-skill"))

        val definitions = registry.toFunctionDefinitions()
        assertEquals(1, definitions.size)

        @Suppress("UNCHECKED_CAST")
        val function = definitions[0]["function"] as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        val params = function["parameters"] as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        val props = params["properties"] as Map<String, Any>
        assertTrue(props.containsKey("input"))
    }

    // ===== Clear =====

    @Test
    fun `clear removes all skills and indexes`() {
        registry.register(createSkill("a", category = SkillCategory.CODE, fileTypes = listOf("kt")))
        registry.register(createSkill("b", category = SkillCategory.TESTING))

        registry.clear()

        assertEquals(0, registry.size)
        assertTrue(registry.listAll().isEmpty())
        assertTrue(registry.findByCategory(SkillCategory.CODE).isEmpty())
        assertTrue(registry.findByFileType("kt").isEmpty())
    }
}
