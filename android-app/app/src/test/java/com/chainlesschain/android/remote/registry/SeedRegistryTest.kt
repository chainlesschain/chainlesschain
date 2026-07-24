package com.chainlesschain.android.remote.registry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SeedRegistryTest {

    @Test
    fun `seed has 24 entries matching M1 inventory + Phase 14 hub`() {
        assertEquals(SeedRegistry.EXPECTED_FILE_COUNT, SeedRegistry.SKILLS.size)
    }

    @Test
    fun `seed total methodCount equals 818`() {
        val total = SeedRegistry.SKILLS.sumOf { it.methodCount }
        assertEquals(SeedRegistry.EXPECTED_METHOD_COUNT, total)
    }

    @Test
    fun `personal-data-hub entry is present with 23 methods`() {
        val hub = SeedRegistry.SKILLS.firstOrNull { it.namespace == "personal-data-hub" }
        assertNotNull("Phase 14 personal-data-hub seed entry must exist", hub)
        assertEquals("Hub method count must include account activation topics",
            23, hub!!.methodCount)
        assertEquals("Hub methods list must enumerate all 23 method names",
            23, hub.methods.size)
        assertTrue("ask method must be present",
            hub.methods.any { it.name == "ask" })
        assertTrue("syncAdapterStream method must be present",
            hub.methods.any { it.name == "syncAdapterStream" })
        assertTrue("activateEmail method must be present",
            hub.methods.any { it.name == "activateEmail" })
        assertTrue("activateAlipay method must be present",
            hub.methods.any { it.name == "activateAlipay" })
    }

    @Test
    fun `verifyCounts returns true`() {
        assertTrue(SeedRegistry.verifyCounts())
    }

    @Test
    fun `all namespaces are unique`() {
        val namespaces = SeedRegistry.SKILLS.map { it.namespace }
        val distinct = namespaces.distinct()
        assertEquals(
            "Duplicate namespaces in seed: ${namespaces - distinct.toSet()}",
            namespaces.size, distinct.size,
        )
    }

    @Test
    fun `extension uses extension-ws transport`() {
        val ext = SeedRegistry.SKILLS.first { it.namespace == "extension" }
        assertEquals("extension-ws", ext.transport)
    }

    @Test
    fun `all other entries use handler-rpc transport`() {
        SeedRegistry.SKILLS.filter { it.namespace != "extension" }.forEach {
            assertEquals("Wrong transport for ${it.namespace}: ${it.transport}",
                "handler-rpc", it.transport)
        }
    }

    @Test
    fun `expected privileged entries are tagged Privileged`() {
        val expectedPriv = setOf(
            "extension", "desktop", "ai", "system", "file", "power", "process",
            "workflow", "device", "security", "network",
        )
        expectedPriv.forEach { ns ->
            val skill = SeedRegistry.SKILLS.first { it.namespace == ns }
            assertEquals(
                "Expected $ns to be Privileged but was ${skill.risk}",
                SkillRiskTag.Privileged, skill.risk,
            )
        }
    }

    @Test
    fun `safe entries do not require approval by default`() {
        val safe = SeedRegistry.SKILLS.filter { it.risk == SkillRiskTag.Safe }
        assertTrue("seed must contain at least one Safe entry", safe.isNotEmpty())
        safe.forEach {
            assertEquals("Safe ${it.namespace} should not require approval",
                false, it.requiresApproval)
        }
    }

    @Test
    fun `privileged entries require approval by default`() {
        val priv = SeedRegistry.SKILLS.filter { it.risk == SkillRiskTag.Privileged }
        priv.forEach {
            assertTrue("Privileged ${it.namespace} should require approval",
                it.requiresApproval)
        }
    }

    @Test
    fun `every entry can be looked up by namespace`() {
        SeedRegistry.SKILLS.forEach {
            val found = SeedRegistry.SKILLS.firstOrNull { other -> other.namespace == it.namespace }
            assertNotNull(found)
        }
    }
}
