package com.chainlesschain.android.remote.registry

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

class RemoteSkillRegistryTest {

    private lateinit var tempDir: File
    private lateinit var mockContext: Context
    private lateinit var store: RegistryStore
    private lateinit var registry: RemoteSkillRegistry

    @Before
    fun setup() {
        tempDir = File.createTempFile("reg_test", "").apply {
            delete()
            mkdir()
            deleteOnExit()
        }
        mockContext = mockk(relaxed = true)
        every { mockContext.filesDir } returns tempDir
        store = RegistryStore(mockContext)
        registry = RemoteSkillRegistry(store)
    }

    private fun sample(
        ns: String,
        risk: SkillRiskTag = SkillRiskTag.Mutating,
        category: String = "test",
        count: Int = 5,
    ) = SkillMetadata(
        namespace = ns,
        displayName = "$ns display",
        description = "desc",
        category = category,
        risk = risk,
        androidSourceFile = "${ns}Commands.kt",
        methodCount = count,
    )

    @Test
    fun `initialize with empty store loads seed`() {
        val source = registry.initialize()

        assertEquals(RemoteSkillRegistry.Source.Seed, source)
        assertEquals(SeedRegistry.EXPECTED_FILE_COUNT, registry.listAll().size)
        assertTrue(registry.initialized.value)
    }

    @Test
    fun `initialize with non-empty store loads from disk`() {
        store.save(listOf(sample("custom-a"), sample("custom-b")))

        val source = registry.initialize()

        assertEquals(RemoteSkillRegistry.Source.Disk, source)
        assertEquals(2, registry.listAll().size)
        assertNotNull(registry.get("custom-a"))
    }

    @Test
    fun `get returns null for unknown namespace`() {
        registry.initialize()

        assertNull(registry.get("never-registered-namespace"))
    }

    @Test
    fun `listByCategory filters correctly`() {
        registry.initialize() // seed has multiple categories

        val ai = registry.listByCategory("ai")
        val system = registry.listByCategory("system")

        assertTrue("ai category should be non-empty", ai.isNotEmpty())
        assertTrue(ai.all { it.category == "ai" })
        assertTrue("system category should be non-empty", system.isNotEmpty())
    }

    @Test
    fun `listByRisk filters correctly`() {
        registry.initialize()

        val safe = registry.listByRisk(SkillRiskTag.Safe)
        val privileged = registry.listByRisk(SkillRiskTag.Privileged)

        assertTrue("Should have at least one safe entry", safe.isNotEmpty())
        assertTrue("Should have multiple privileged entries", privileged.size >= 5)
        assertTrue(safe.all { it.risk == SkillRiskTag.Safe })
        assertTrue(privileged.all { it.risk == SkillRiskTag.Privileged })
    }

    @Test
    fun `requiresApproval returns true for Privileged seeded entries`() {
        registry.initialize()

        // Per M1: extension/desktop/ai/system/file/power/process/workflow/device/security/network 都是 Privileged
        assertTrue(registry.requiresApproval("extension"))
        assertTrue(registry.requiresApproval("ai"))
        assertTrue(registry.requiresApproval("system"))
    }

    @Test
    fun `requiresApproval returns false for Safe and Mutating entries`() {
        registry.initialize()

        assertFalse(registry.requiresApproval("system.info"))
        assertFalse(registry.requiresApproval("history"))
        assertFalse(registry.requiresApproval("clipboard"))
    }

    @Test
    fun `requiresApproval returns true for unknown namespace (conservative)`() {
        registry.initialize()

        assertTrue(registry.requiresApproval("never-heard-of"))
    }

    @Test
    fun `updateFromRemote merges new entries and persists`() {
        registry.initialize()
        val before = registry.listAll().size

        val newEntries = listOf(
            sample("newone", risk = SkillRiskTag.Safe),
            sample("anothernew", risk = SkillRiskTag.Privileged),
        )
        val merged = registry.updateFromRemote(newEntries)

        assertEquals(before + 2, merged)
        assertNotNull(registry.get("newone"))
        // 持久化：clear in-memory & reload via store
        val freshStore = RegistryStore(mockContext)
        val onDisk = freshStore.load()
        assertEquals(merged, onDisk.size)
    }

    @Test
    fun `updateFromRemote replaces same namespace entry`() {
        registry.initialize()
        val originalAi = registry.get("ai")!!
        assertEquals(53, originalAi.methodCount)

        val replaced = sample("ai", risk = SkillRiskTag.Mutating, count = 100)
        registry.updateFromRemote(listOf(replaced))

        val updated = registry.get("ai")!!
        assertEquals(100, updated.methodCount)
        assertEquals(SkillRiskTag.Mutating, updated.risk)
    }

    @Test
    fun `updateFromRemote with empty list is a no-op`() {
        registry.initialize()
        val before = registry.listAll().size

        val after = registry.updateFromRemote(emptyList())

        assertEquals(before, after)
        assertEquals(before, registry.listAll().size)
    }

    @Test
    fun `updateFromRemote preserves entries not in new list`() {
        registry.initialize()
        // ai is in seed, knowledge is in seed
        val knowledgeBefore = registry.get("knowledge")
        assertNotNull(knowledgeBefore)

        // Update only ai → knowledge should be preserved
        registry.updateFromRemote(listOf(sample("ai", count = 999)))

        assertNotNull(registry.get("knowledge"))
        assertEquals(999, registry.get("ai")!!.methodCount)
    }

    @Test
    fun `resetToSeed clears disk and restores from SeedRegistry`() {
        registry.initialize()
        registry.updateFromRemote(listOf(sample("custom-x")))
        assertNotNull(registry.get("custom-x"))

        registry.resetToSeed()

        assertNull(registry.get("custom-x"))
        assertEquals(SeedRegistry.EXPECTED_FILE_COUNT, registry.listAll().size)
        // Disk should be cleared
        assertFalse(File(tempDir, RegistryStore.FILE_NAME).exists())
    }

    @Test
    fun `skills StateFlow emits updated value on updateFromRemote`() {
        registry.initialize()
        val first = registry.skills.value
        val firstSize = first.size

        registry.updateFromRemote(listOf(sample("flow-test")))

        val second = registry.skills.value
        assertEquals(firstSize + 1, second.size)
    }
}
