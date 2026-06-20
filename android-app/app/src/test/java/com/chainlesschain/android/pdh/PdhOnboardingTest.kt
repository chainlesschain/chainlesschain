package com.chainlesschain.android.pdh

import com.chainlesschain.android.pdh.PdhOnboarding.StartMode
import com.chainlesschain.android.pdh.PdhOnboarding.Step
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §3.5.19 首跑 onboarding 纯逻辑测试:首跑检测三态 / 三步状态机 / 免 root 默认源。
 */
class PdhOnboardingTest {

    @Test
    fun fresh_when_no_did() {
        assertEquals(StartMode.FRESH, PdhOnboarding.decideStart(hasDid = false, vaultNonEmpty = false))
        assertEquals(StartMode.FRESH, PdhOnboarding.decideStart(hasDid = false, vaultNonEmpty = true))
    }

    @Test
    fun skip_when_did_and_nonempty_vault() {
        assertEquals(StartMode.SKIP, PdhOnboarding.decideStart(hasDid = true, vaultNonEmpty = true))
    }

    @Test
    fun recover_when_did_but_empty_vault() {
        assertEquals(StartMode.RECOVER, PdhOnboarding.decideStart(hasDid = true, vaultNonEmpty = false))
    }

    @Test
    fun step_sequence() {
        assertEquals(Step.SOURCES, PdhOnboarding.nextStep(Step.IDENTITY))
        assertEquals(Step.COLLECT, PdhOnboarding.nextStep(Step.SOURCES))
        assertNull(PdhOnboarding.nextStep(Step.COLLECT))
    }

    @Test
    fun default_sources_are_no_root() {
        assertEquals(listOf("system_data", "local_files"), PdhOnboarding.DEFAULT_SOURCES)
        // 默认源都不是高级源
        for (s in PdhOnboarding.DEFAULT_SOURCES) {
            assertFalse(PdhOnboarding.isAdvanced(s), "default should not be advanced: $s")
        }
    }

    @Test
    fun advanced_sources_flagged() {
        assertTrue(PdhOnboarding.isAdvanced("app_data"))
        assertTrue(PdhOnboarding.isAdvanced("salvage"))
        assertFalse(PdhOnboarding.isAdvanced("system_data"))
    }
}
