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

    // ===== M4 D1 method-level metadata =====

    @Test
    fun `listMethods returns seeded methods for knowledge namespace`() {
        registry.initialize()
        val methods = registry.listMethods("knowledge")
        assertTrue("knowledge seed should have methods", methods.isNotEmpty())
        assertTrue("createNote should be seeded", methods.any { it.name == "createNote" })
    }

    @Test
    fun `listMethods returns empty for namespaces without method seed`() {
        registry.initialize()
        // SystemCommands not seeded with method-level data per current SeedRegistry
        val methods = registry.listMethods("system")
        assertTrue("namespace without seed should return empty", methods.isEmpty())
    }

    @Test
    fun `listMethods returns empty for unknown namespace`() {
        registry.initialize()
        assertTrue(registry.listMethods("nope").isEmpty())
    }

    @Test
    fun `getMethod returns exact match by name`() {
        registry.initialize()
        val m = registry.getMethod("ai", "chat")
        assertNotNull(m)
        assertEquals("chat", m!!.name)
        assertEquals(SkillRiskTag.Mutating, m.riskOverride)  // 显式降级 override
    }

    @Test
    fun `getMethod returns null for unseeded method name`() {
        registry.initialize()
        assertNull(registry.getMethod("ai", "ghostMethod"))
    }

    @Test
    fun `requiresApprovalForMethod uses requiresApprovalOverride when set`() {
        registry.initialize()
        // ai.deleteConversation has requiresApprovalOverride=true
        assertTrue(registry.requiresApprovalForMethod("ai", "deleteConversation"))
        // ai.controlAgent has requiresApprovalOverride=true
        assertTrue(registry.requiresApprovalForMethod("ai", "controlAgent"))
    }

    @Test
    fun `requiresApprovalForMethod derives from riskOverride when override is null`() {
        registry.initialize()
        // ai.chat: riskOverride=Mutating, requiresApprovalOverride=null → not approval-required
        assertFalse(registry.requiresApprovalForMethod("ai", "chat"))
        // ai.getModels: riskOverride=Safe → not approval-required
        assertFalse(registry.requiresApprovalForMethod("ai", "getModels"))
    }

    @Test
    fun `requiresApprovalForMethod falls back to namespace level for unseeded method`() {
        registry.initialize()
        // ai namespace is Privileged → unseeded method "nonExistent" should require approval
        assertTrue(registry.requiresApprovalForMethod("ai", "anyUnseededMethod"))
        // system.info namespace is Safe → unseeded method should NOT require approval
        assertFalse(registry.requiresApprovalForMethod("system.info", "anyMethod"))
    }

    @Test
    fun `requiresApprovalForMethod returns true for unknown namespace (conservative)`() {
        registry.initialize()
        assertTrue(registry.requiresApprovalForMethod("never-heard", "x"))
    }

    @Test
    fun `riskForMethod returns method override when set`() {
        registry.initialize()
        // knowledge.deleteNote has riskOverride=Privileged (overriding knowledge=Mutating)
        assertEquals(SkillRiskTag.Privileged, registry.riskForMethod("knowledge", "deleteNote"))
        // knowledge.searchNotes has riskOverride=Safe
        assertEquals(SkillRiskTag.Safe, registry.riskForMethod("knowledge", "searchNotes"))
    }

    @Test
    fun `riskForMethod falls back to namespace level`() {
        registry.initialize()
        // knowledge.createNote has no riskOverride → namespace = Mutating
        assertEquals(SkillRiskTag.Mutating, registry.riskForMethod("knowledge", "createNote"))
        // ai.unseededMethod → namespace = Privileged
        assertEquals(SkillRiskTag.Privileged, registry.riskForMethod("ai", "unseededMethod"))
    }

    @Test
    fun `riskForMethod returns Privileged for unknown namespace (conservative)`() {
        registry.initialize()
        assertEquals(SkillRiskTag.Privileged, registry.riskForMethod("never-heard", "x"))
    }

    @Test
    fun `MethodMetadata invariant rejects blank name`() {
        try {
            MethodMetadata(name = "  ", description = "x", paramCount = 0)
            assertTrue("should have thrown", false)
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    @Test
    fun `MethodMetadata invariant rejects negative paramCount`() {
        try {
            MethodMetadata(name = "x", description = "x", paramCount = -1)
            assertTrue("should have thrown", false)
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    @Test
    fun `SkillMetadata rejects duplicate method names`() {
        try {
            SkillMetadata(
                namespace = "ns",
                displayName = "n",
                description = "d",
                category = "c",
                risk = SkillRiskTag.Safe,
                androidSourceFile = "F.kt",
                methodCount = 3,
                methods = listOf(
                    MethodMetadata("dup", "x", 0),
                    MethodMetadata("dup", "y", 0),
                ),
            )
            assertTrue("should have thrown", false)
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    @Test
    fun `SkillMetadata rejects methods size exceeding methodCount`() {
        try {
            SkillMetadata(
                namespace = "ns",
                displayName = "n",
                description = "d",
                category = "c",
                risk = SkillRiskTag.Safe,
                androidSourceFile = "F.kt",
                methodCount = 1,
                methods = listOf(
                    MethodMetadata("a", "x", 0),
                    MethodMetadata("b", "y", 0),
                ),
            )
            assertTrue("should have thrown", false)
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    // ===== §8.3 alias 兼容窗口 =====

    @Test
    fun `alias resolves to canonical namespace via get`() {
        val skill = SkillMetadata(
            namespace = "extension",
            displayName = "Extension",
            description = "d",
            category = "browser",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "F.kt",
            methodCount = 1,
            aliases = listOf("browser.extension", "chrome-ext"),
        )
        store.save(listOf(skill))
        registry.initialize()

        assertNotNull(registry.get("extension"))
        assertNotNull(registry.get("browser.extension"))  // alias
        assertEquals("extension", registry.get("browser.extension")!!.namespace)
        assertNotNull(registry.get("chrome-ext"))  // 2nd alias
        assertNull(registry.get("unknown"))
    }

    @Test
    fun `resolveAlias returns canonical for alias and identity for canonical`() {
        val skill = SkillMetadata(
            namespace = "extension",
            displayName = "Extension",
            description = "d",
            category = "browser",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "F.kt",
            methodCount = 1,
            aliases = listOf("browser.extension"),
        )
        store.save(listOf(skill))
        registry.initialize()

        assertEquals("extension", registry.resolveAlias("browser.extension"))
        assertEquals("extension", registry.resolveAlias("extension"))
        assertEquals("not-a-known-name", registry.resolveAlias("not-a-known-name"))
    }

    @Test
    fun `requiresApproval honors alias`() {
        val skill = SkillMetadata(
            namespace = "marketplace",
            displayName = "MP",
            description = "d",
            category = "control",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "F.kt",
            methodCount = 1,
            aliases = listOf("payments"),
        )
        store.save(listOf(skill))
        registry.initialize()

        assertTrue(registry.requiresApproval("marketplace"))
        assertTrue(registry.requiresApproval("payments"))  // alias path
    }

    @Test
    fun `listMethods honors alias`() {
        val skill = SkillMetadata(
            namespace = "ai",
            displayName = "AI",
            description = "d",
            category = "ai",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "AICommands.kt",
            methodCount = 1,
            methods = listOf(MethodMetadata("chat", "x", 0)),
            aliases = listOf("llm"),
        )
        store.save(listOf(skill))
        registry.initialize()

        assertEquals(1, registry.listMethods("ai").size)
        assertEquals(1, registry.listMethods("llm").size)
    }

    @Test
    fun `alias rejects matching its own namespace via require`() {
        try {
            SkillMetadata(
                namespace = "self",
                displayName = "x",
                description = "d",
                category = "c",
                risk = SkillRiskTag.Safe,
                androidSourceFile = "F.kt",
                methodCount = 1,
                aliases = listOf("self"),
            )
            assertTrue("should have thrown", false)
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    @Test
    fun `alias rejects blank entries via require`() {
        try {
            SkillMetadata(
                namespace = "n",
                displayName = "x",
                description = "d",
                category = "c",
                risk = SkillRiskTag.Safe,
                androidSourceFile = "F.kt",
                methodCount = 1,
                aliases = listOf("ok", "   "),
            )
            assertTrue("should have thrown", false)
        } catch (_: IllegalArgumentException) { /* expected */ }
    }

    @Test
    fun `updateFromRemote rebuilds aliasIndex on merge`() {
        registry.initialize()
        val update = SkillMetadata(
            namespace = "newone",
            displayName = "new",
            description = "d",
            category = "c",
            risk = SkillRiskTag.Safe,
            androidSourceFile = "F.kt",
            methodCount = 1,
            aliases = listOf("legacy-name"),
        )
        registry.updateFromRemote(listOf(update))

        assertNotNull(registry.get("newone"))
        assertNotNull(registry.get("legacy-name"))
        assertEquals("newone", registry.get("legacy-name")!!.namespace)
    }

    @Test
    fun `updateFromRemote replaces methods alongside file-level metadata`() {
        registry.initialize()
        val before = registry.listMethods("ai")
        assertTrue(before.isNotEmpty())

        val updated = SkillMetadata(
            namespace = "ai",
            displayName = "ai",
            description = "d",
            category = "ai",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "AICommands.kt",
            methodCount = 53,
            methods = listOf(MethodMetadata("brandNewMethod", "from desktop", 1)),
        )
        registry.updateFromRemote(listOf(updated))

        val after = registry.listMethods("ai")
        assertEquals(1, after.size)
        assertEquals("brandNewMethod", after[0].name)
    }
}
