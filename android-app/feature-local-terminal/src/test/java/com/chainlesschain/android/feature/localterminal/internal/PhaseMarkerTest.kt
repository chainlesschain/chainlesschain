package com.chainlesschain.android.feature.localterminal.internal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 0.1 smoke unit test — proves Kotlin sources in feature-local-terminal
 * compile, run under the host JVM (no NDK / no Android runtime), and the test
 * pipeline (junit + Gradle test task) is wired correctly.
 *
 * Native-dependent tests live under src/androidTest and only run on emulator /
 * real device once Phase 0.5 lands the smoke integration test.
 */
class PhaseMarkerTest {
    @Test
    fun `current phase is 1_1`() {
        assertEquals("1.1", PhaseMarker.CURRENT)
    }

    @Test
    fun `description mentions posix_spawn`() {
        assertTrue(
            "description should mention posix_spawn — the central design choice of Phase 1.1 (vs raw fork+exec, see design doc §5 Trap 7)",
            PhaseMarker.DESCRIPTION.contains("posix_spawn", ignoreCase = true)
        )
    }
}
