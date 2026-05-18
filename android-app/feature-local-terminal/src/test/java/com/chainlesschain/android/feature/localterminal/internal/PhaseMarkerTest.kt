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
    fun `current phase is 3`() {
        assertEquals("3", PhaseMarker.CURRENT)
    }

    @Test
    fun `description mentions xterm js WebView`() {
        assertTrue(
            "description should mention xterm.js WebView — the central Phase 3 design choice",
            PhaseMarker.DESCRIPTION.contains("xterm.js", ignoreCase = true)
        )
    }
}
