package com.chainlesschain.android.remote.registry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SkillMetadataTest {

    private fun fresh(
        namespace: String = "test",
        displayName: String = "Test",
        risk: SkillRiskTag = SkillRiskTag.Safe,
        requiresApproval: Boolean? = null,
        transport: String = "handler-rpc",
        methodCount: Int = 1,
    ): SkillMetadata = SkillMetadata(
        namespace = namespace,
        displayName = displayName,
        description = "desc",
        category = "test",
        risk = risk,
        requiresApproval = requiresApproval ?: (risk == SkillRiskTag.Privileged),
        transport = transport,
        androidSourceFile = "TestCommands.kt",
        methodCount = methodCount,
    )

    @Test
    fun `valid metadata accepted`() {
        val m = fresh()
        assertEquals("test", m.namespace)
        assertEquals(SkillRiskTag.Safe, m.risk)
    }

    @Test
    fun `blank namespace rejected`() {
        assertThrows(IllegalArgumentException::class.java) { fresh(namespace = "") }
        assertThrows(IllegalArgumentException::class.java) { fresh(namespace = "   ") }
    }

    @Test
    fun `blank displayName rejected`() {
        assertThrows(IllegalArgumentException::class.java) { fresh(displayName = "") }
    }

    @Test
    fun `non-positive methodCount rejected`() {
        assertThrows(IllegalArgumentException::class.java) { fresh(methodCount = 0) }
        assertThrows(IllegalArgumentException::class.java) { fresh(methodCount = -5) }
    }

    @Test
    fun `invalid transport rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            fresh(transport = "unknown-protocol")
        }
        // 合法两种：handler-rpc / extension-ws
        fresh(transport = "handler-rpc") // ok
        fresh(transport = "extension-ws") // ok
    }

    @Test
    fun `requiresApproval defaults to true for Privileged`() {
        val m = fresh(risk = SkillRiskTag.Privileged)
        assertTrue(m.requiresApproval)
    }

    @Test
    fun `requiresApproval defaults to false for Safe and Mutating`() {
        assertFalse(fresh(risk = SkillRiskTag.Safe).requiresApproval)
        assertFalse(fresh(risk = SkillRiskTag.Mutating).requiresApproval)
    }

    @Test
    fun `requiresApproval can be explicitly overridden`() {
        val m = fresh(risk = SkillRiskTag.Safe, requiresApproval = true)
        assertTrue(m.requiresApproval)
        val m2 = fresh(risk = SkillRiskTag.Privileged, requiresApproval = false)
        assertFalse(m2.requiresApproval)
    }

    @Test
    fun `SkillRiskTag rank ordering`() {
        assertTrue(SkillRiskTag.Privileged.rank() > SkillRiskTag.Mutating.rank())
        assertTrue(SkillRiskTag.Mutating.rank() > SkillRiskTag.Safe.rank())
    }
}
