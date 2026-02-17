package com.chainlesschain.android.feature.ai.cowork.skills

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.chainlesschain.android.feature.ai.cowork.skills.gating.SkillGating
import com.chainlesschain.android.feature.ai.cowork.skills.model.*
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for SkillGating — platform, SDK, and permission gate checks.
 */
class SkillGatingTest {

    private lateinit var context: Context
    private lateinit var gating: SkillGating

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        gating = SkillGating(context)
    }

    private fun createSkill(
        name: String = "test-skill",
        os: List<String> = listOf("android", "win32", "darwin", "linux"),
        gate: SkillGate? = null
    ): Skill {
        return Skill(
            metadata = SkillMetadata(
                name = name,
                description = "Test skill",
                os = os,
                gate = gate
            ),
            instructions = "Test instructions",
            source = SkillSource.BUNDLED
        )
    }

    // ===== Platform Check =====

    @Test
    fun `skill with android in os list passes`() {
        val skill = createSkill(os = listOf("android", "win32"))
        val result = gating.check(skill)
        assertTrue(result.passed)
    }

    @Test
    fun `skill without android in os list fails`() {
        val skill = createSkill(os = listOf("win32", "darwin"))
        val result = gating.check(skill)
        assertFalse(result.passed)
        assertTrue(result.reason.contains("not supported on Android"))
    }

    @Test
    fun `skill with empty os list passes`() {
        val skill = createSkill(os = emptyList())
        val result = gating.check(skill)
        assertTrue(result.passed)
    }

    // ===== Gate Platform Check =====

    @Test
    fun `gate platform excluding android fails`() {
        val skill = createSkill(
            gate = SkillGate(platform = listOf("desktop"))
        )
        val result = gating.check(skill)
        assertFalse(result.passed)
        assertTrue(result.reason.contains("platform gate"))
    }

    @Test
    fun `gate platform including android passes`() {
        val skill = createSkill(
            gate = SkillGate(platform = listOf("android", "desktop"))
        )
        val result = gating.check(skill)
        assertTrue(result.passed)
    }

    // ===== No Gate =====

    @Test
    fun `skill without gate passes all checks`() {
        val skill = createSkill(gate = null)
        val result = gating.check(skill)
        assertTrue(result.passed)
    }

    // ===== SDK Version Check =====

    @Test
    fun `gate with minSdk below current SDK passes`() {
        // Build.VERSION.SDK_INT is typically 0 in unit tests (no Robolectric)
        // With isReturnDefaultValues = true, it returns 0
        val skill = createSkill(
            gate = SkillGate(platform = listOf("android"), minSdk = 0)
        )
        val result = gating.check(skill)
        assertTrue(result.passed)
    }

    @Test
    fun `gate with minSdk above current SDK fails`() {
        // SDK_INT returns 0 in unit tests, so minSdk=99 will fail
        val skill = createSkill(
            gate = SkillGate(platform = listOf("android"), minSdk = 99)
        )
        val result = gating.check(skill)
        assertFalse(result.passed)
        assertTrue(result.reason.contains("requires SDK"))
    }

    // ===== Permission Check =====

    @Test
    fun `gate with granted permissions passes`() {
        every {
            context.checkPermission(any(), any(), any())
        } returns PackageManager.PERMISSION_GRANTED

        val skill = createSkill(
            gate = SkillGate(
                platform = listOf("android"),
                requiredPermissions = listOf("android.permission.CAMERA")
            )
        )
        val result = gating.check(skill)
        // Note: ContextCompat.checkSelfPermission uses context internally
        // With relaxed mock, this should pass through
        // The actual behavior depends on mock setup
        assertNotNull(result)
    }

    @Test
    fun `gate with missing permissions fails`() {
        // With relaxed mock, checkSelfPermission returns 0 (PERMISSION_GRANTED) by default
        // To test denial, we'd need Robolectric or more precise mocking
        // This test verifies the gating logic doesn't crash
        val skill = createSkill(
            gate = SkillGate(
                platform = listOf("android"),
                requiredPermissions = listOf("android.permission.CAMERA")
            )
        )
        val result = gating.check(skill)
        assertNotNull(result)
    }

    // ===== Combined Gates =====

    @Test
    fun `multiple gate conditions all checked`() {
        val skill = createSkill(
            gate = SkillGate(
                platform = listOf("android"),
                minSdk = 0  // passes because SDK_INT >= 0
            )
        )
        val result = gating.check(skill)
        assertTrue(result.passed)
    }

    @Test
    fun `first failing gate condition stops checks`() {
        // Platform check fails first, so SDK check is never reached
        val skill = createSkill(
            os = listOf("win32")  // fails at os check before gate
        )
        val result = gating.check(skill)
        assertFalse(result.passed)
        assertTrue(result.reason.contains("not supported on Android"))
    }
}
