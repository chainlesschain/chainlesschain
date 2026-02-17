package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.model.*
import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for data models — Skill, SkillMetadata, SkillCategory, SkillParameter.
 */
class SkillModelTest {

    // ===== SkillCategory =====

    @Test
    fun `SkillCategory fromString matches case-insensitively`() {
        assertEquals(SkillCategory.CODE, SkillCategory.fromString("code"))
        assertEquals(SkillCategory.CODE, SkillCategory.fromString("CODE"))
        assertEquals(SkillCategory.CODE, SkillCategory.fromString("Code"))
    }

    @Test
    fun `SkillCategory fromString returns GENERAL for unknown`() {
        assertEquals(SkillCategory.GENERAL, SkillCategory.fromString("unknown"))
        assertEquals(SkillCategory.GENERAL, SkillCategory.fromString(""))
    }

    @Test
    fun `SkillCategory has correct display names`() {
        assertEquals("Code", SkillCategory.CODE.displayName)
        assertEquals("Documentation", SkillCategory.DOCUMENTATION.displayName)
        assertEquals("DevOps", SkillCategory.DEVOPS.displayName)
    }

    // ===== SkillSource Ordering =====

    @Test
    fun `SkillSource ordinal matches priority`() {
        assertTrue(SkillSource.BUNDLED.ordinal < SkillSource.MANAGED.ordinal)
        assertTrue(SkillSource.MANAGED.ordinal < SkillSource.WORKSPACE.ordinal)
    }

    // ===== Skill Convenience Accessors =====

    @Test
    fun `Skill name accessor delegates to metadata`() {
        val skill = Skill(
            metadata = SkillMetadata(name = "test-skill"),
            instructions = "test",
            source = SkillSource.BUNDLED
        )
        assertEquals("test-skill", skill.name)
    }

    @Test
    fun `Skill category accessor delegates to metadata`() {
        val skill = Skill(
            metadata = SkillMetadata(name = "test", category = SkillCategory.TESTING),
            instructions = "test",
            source = SkillSource.BUNDLED
        )
        assertEquals(SkillCategory.TESTING, skill.category)
    }

    @Test
    fun `Skill hasHandler is true when handler is set`() {
        val withHandler = Skill(
            metadata = SkillMetadata(name = "test", handler = "TestHandler"),
            instructions = "test",
            source = SkillSource.BUNDLED
        )
        assertTrue(withHandler.hasHandler)

        val withoutHandler = Skill(
            metadata = SkillMetadata(name = "test"),
            instructions = "test",
            source = SkillSource.BUNDLED
        )
        assertFalse(withoutHandler.hasHandler)
    }

    @Test
    fun `Skill fileTypes accessor delegates to metadata`() {
        val skill = Skill(
            metadata = SkillMetadata(name = "test", fileTypes = listOf("kt", "java")),
            instructions = "test",
            source = SkillSource.BUNDLED
        )
        assertEquals(2, skill.fileTypes.size)
        assertTrue(skill.fileTypes.contains("kt"))
    }

    // ===== SkillResult =====

    @Test
    fun `SkillResult success state`() {
        val result = SkillResult(success = true, output = "Result text")
        assertTrue(result.success)
        assertEquals("Result text", result.output)
        assertNull(result.error)
    }

    @Test
    fun `SkillResult error state`() {
        val result = SkillResult(success = false, output = "", error = "Something failed")
        assertFalse(result.success)
        assertEquals("Something failed", result.error)
    }

    // ===== SkillParameter =====

    @Test
    fun `SkillParameter default values`() {
        val param = SkillParameter(name = "test")
        assertEquals("string", param.type)
        assertEquals("", param.description)
        assertFalse(param.required)
        assertNull(param.default)
        assertNull(param.enum)
    }

    @Test
    fun `SkillParameter with enum values`() {
        val param = SkillParameter(
            name = "level",
            type = "string",
            enum = listOf("brief", "normal", "detailed")
        )
        assertEquals(3, param.enum!!.size)
    }

    // ===== SkillGate =====

    @Test
    fun `SkillGate default is null when not set`() {
        val metadata = SkillMetadata(name = "test")
        assertNull(metadata.gate)
    }

    @Test
    fun `SkillGate with all fields`() {
        val gate = SkillGate(
            platform = listOf("android"),
            minSdk = 28,
            requiredPermissions = listOf("android.permission.CAMERA"),
            requiredBinaries = listOf("ffmpeg"),
            requiredEnv = listOf("API_KEY")
        )
        assertEquals(listOf("android"), gate.platform)
        assertEquals(28, gate.minSdk)
        assertEquals(1, gate.requiredPermissions!!.size)
    }

    // ===== SkillMetadata Defaults =====

    @Test
    fun `SkillMetadata has sensible defaults`() {
        val metadata = SkillMetadata(name = "test")
        assertEquals("1.0.0", metadata.version)
        assertEquals(SkillCategory.GENERAL, metadata.category)
        assertTrue(metadata.userInvocable)
        assertFalse(metadata.hidden)
        assertTrue(metadata.tags.isEmpty())
        assertTrue(metadata.fileTypes.isEmpty())
        assertTrue(metadata.inputSchema.isEmpty())
        assertTrue(metadata.outputSchema.isEmpty())
        assertTrue(metadata.os.contains("android"))
    }
}
