package com.chainlesschain.android.feature.ai.cowork.skills

import android.content.Context
import android.content.res.AssetManager
import com.chainlesschain.android.feature.ai.cowork.skills.loader.SkillLoader
import com.chainlesschain.android.feature.ai.cowork.skills.loader.SkillMdParser
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillSource
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import io.mockk.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Unit tests for SkillLoader — 3-layer loading, install/uninstall.
 */
class SkillLoaderTest {

    private lateinit var context: Context
    private lateinit var parser: SkillMdParser
    private lateinit var registry: SkillRegistry
    private lateinit var loader: SkillLoader
    private lateinit var assetManager: AssetManager

    private val sampleSkillMd = """
        |---
        |name: test-skill
        |description: A test skill
        |category: general
        |version: 1.0.0
        |---
        |
        |# Test Skill
        |
        |This is a test skill.
    """.trimMargin()

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        assetManager = mockk(relaxed = true)
        every { context.assets } returns assetManager

        // Use real parser and registry
        parser = SkillMdParser()
        registry = SkillRegistry()
        loader = SkillLoader(context, parser, registry)
    }

    // ===== Bundled Loading =====

    @Test
    fun `loadBundled loads skills from assets directory`() {
        // Mock asset manager to return one skill file
        every { assetManager.list("skills") } returns arrayOf("test-skill.md")
        every { assetManager.open("skills/test-skill.md") } returns
                ByteArrayInputStream(sampleSkillMd.toByteArray())

        val count = loader.loadBundled()

        assertEquals(1, count)
        assertEquals(1, registry.size)
        assertNotNull(registry.findByName("test-skill"))
        assertEquals(SkillSource.BUNDLED, registry.findByName("test-skill")!!.source)
    }

    @Test
    fun `loadBundled skips non-md files`() {
        every { assetManager.list("skills") } returns arrayOf("readme.txt", "skill.md")
        every { assetManager.open("skills/skill.md") } returns
                ByteArrayInputStream(sampleSkillMd.toByteArray())

        val count = loader.loadBundled()
        assertEquals(1, count) // Only the .md file
    }

    @Test
    fun `loadBundled handles empty assets directory`() {
        every { assetManager.list("skills") } returns emptyArray()

        val count = loader.loadBundled()
        assertEquals(0, count)
    }

    @Test
    fun `loadBundled handles missing assets directory`() {
        every { assetManager.list("skills") } returns null

        val count = loader.loadBundled()
        assertEquals(0, count)
    }

    @Test
    fun `loadBundled handles invalid skill file gracefully`() {
        every { assetManager.list("skills") } returns arrayOf("bad.md")
        every { assetManager.open("skills/bad.md") } returns
                ByteArrayInputStream("not a valid skill file".toByteArray())

        val count = loader.loadBundled()
        assertEquals(0, count) // Invalid file skipped
    }

    // ===== Managed Loading =====

    @Test
    fun `loadManaged creates directory if missing`() {
        val filesDir = createTempDir()
        every { context.filesDir } returns filesDir

        val count = loader.loadManaged()
        assertEquals(0, count)
        assertTrue(File(filesDir, "skills/managed").exists())

        filesDir.deleteRecursively()
    }

    @Test
    fun `loadManaged loads skills from managed directory`() {
        val filesDir = createTempDir()
        val managedDir = File(filesDir, "skills/managed")
        managedDir.mkdirs()

        File(managedDir, "managed-skill.md").writeText(sampleSkillMd.replace("test-skill", "managed-skill"))
        every { context.filesDir } returns filesDir

        val count = loader.loadManaged()
        assertEquals(1, count)
        assertNotNull(registry.findByName("managed-skill"))
        assertEquals(SkillSource.MANAGED, registry.findByName("managed-skill")!!.source)

        filesDir.deleteRecursively()
    }

    // ===== Workspace Loading =====

    @Test
    fun `loadWorkspace returns 0 when no path set`() {
        val count = loader.loadWorkspace()
        assertEquals(0, count)
    }

    @Test
    fun `loadWorkspace loads from specified directory`() {
        val workspaceDir = createTempDir()
        File(workspaceDir, "workspace-skill.md").writeText(
            sampleSkillMd.replace("test-skill", "workspace-skill")
        )

        loader.setWorkspacePath(workspaceDir.absolutePath)
        val count = loader.loadWorkspace()

        assertEquals(1, count)
        assertNotNull(registry.findByName("workspace-skill"))
        assertEquals(SkillSource.WORKSPACE, registry.findByName("workspace-skill")!!.source)

        workspaceDir.deleteRecursively()
    }

    @Test
    fun `loadWorkspace returns 0 for nonexistent path`() {
        loader.setWorkspacePath("/nonexistent/path")
        val count = loader.loadWorkspace()
        assertEquals(0, count)
    }

    // ===== 3-Layer Override =====

    @Test
    fun `loadAll applies 3-layer priority correctly`() {
        // Set up bundled skill
        every { assetManager.list("skills") } returns arrayOf("shared.md")
        every { assetManager.open("skills/shared.md") } returns
                ByteArrayInputStream(sampleSkillMd.replace("test-skill", "shared").toByteArray())

        // Set up managed skill (same name, different version)
        val filesDir = createTempDir()
        val managedDir = File(filesDir, "skills/managed")
        managedDir.mkdirs()
        File(managedDir, "shared.md").writeText(
            sampleSkillMd.replace("test-skill", "shared").replace("1.0.0", "2.0.0")
        )
        every { context.filesDir } returns filesDir

        val total = loader.loadAll()

        // Managed version should override bundled
        assertEquals(1, total)
        val skill = registry.findByName("shared")
        assertNotNull(skill)
        assertEquals(SkillSource.MANAGED, skill!!.source)
        assertEquals("2.0.0", skill.metadata.version)

        filesDir.deleteRecursively()
    }

    // ===== Install/Uninstall =====

    @Test
    fun `installManaged writes file and registers skill`() {
        val filesDir = createTempDir()
        every { context.filesDir } returns filesDir

        val result = loader.installManaged("new-skill.md",
            sampleSkillMd.replace("test-skill", "new-skill")
        )

        assertTrue(result)
        assertNotNull(registry.findByName("new-skill"))
        assertTrue(File(filesDir, "skills/managed/new-skill.md").exists())

        filesDir.deleteRecursively()
    }

    @Test
    fun `installManaged rejects invalid skill content`() {
        val filesDir = createTempDir()
        every { context.filesDir } returns filesDir

        val result = loader.installManaged("bad.md", "not a valid skill")

        assertFalse(result)
        assertEquals(0, registry.size)

        filesDir.deleteRecursively()
    }

    @Test
    fun `uninstallManaged removes file and unregisters skill`() {
        val filesDir = createTempDir()
        val managedDir = File(filesDir, "skills/managed")
        managedDir.mkdirs()

        val content = sampleSkillMd.replace("test-skill", "removable")
        File(managedDir, "removable.md").writeText(content)
        every { context.filesDir } returns filesDir

        // First load to register
        loader.loadManaged()
        assertNotNull(registry.findByName("removable"))

        // Then uninstall
        val result = loader.uninstallManaged("removable")
        assertTrue(result)
        assertNull(registry.findByName("removable"))

        filesDir.deleteRecursively()
    }

    // ===== Reload =====

    @Test
    fun `reload clears and reloads all skills`() {
        every { assetManager.list("skills") } returns arrayOf("skill.md")
        every { assetManager.open("skills/skill.md") } returns
                ByteArrayInputStream(sampleSkillMd.toByteArray())

        val filesDir = createTempDir()
        every { context.filesDir } returns filesDir

        loader.loadAll()
        assertEquals(1, registry.size)

        // Reload should produce the same result
        // Need to re-mock the InputStream since it's consumed
        every { assetManager.open("skills/skill.md") } returns
                ByteArrayInputStream(sampleSkillMd.toByteArray())

        val count = loader.reload()
        assertEquals(1, count)

        filesDir.deleteRecursively()
    }

    private fun createTempDir(): File {
        val dir = File(System.getProperty("java.io.tmpdir"), "skill-test-${System.nanoTime()}")
        dir.mkdirs()
        return dir
    }
}
