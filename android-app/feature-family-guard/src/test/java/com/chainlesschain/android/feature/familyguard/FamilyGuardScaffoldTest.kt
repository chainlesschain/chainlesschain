package com.chainlesschain.android.feature.familyguard

import org.junit.Test
import kotlin.test.assertEquals

/**
 * FAMILY-01 smoke test — proves the unit test classpath compiles + runs.
 * Real tests join in FAMILY-09 (fixture / mock framework) and per-ticket.
 */
class FamilyGuardScaffoldTest {

    @Test
    fun `module scaffold compiles and unit test runner executes`() {
        // Trivial assertion just to keep CI honest. If this file fails to
        // compile, FAMILY-01 acceptance has regressed.
        assertEquals(2, 1 + 1)
    }
}
