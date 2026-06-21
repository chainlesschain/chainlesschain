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

    @Test
    fun source_label_maps_known_keys_and_passes_through_unknown() {
        assertTrue(PdhOnboarding.sourceLabel("system_data").contains("系统数据"))
        assertTrue(PdhOnboarding.sourceLabel("local_files").contains("本地文件"))
        assertTrue(PdhOnboarding.sourceLabel("salvage").contains("root"))
        assertEquals("weird_src", PdhOnboarding.sourceLabel("weird_src"))
    }

    @Test
    fun collect_prompt_names_selected_sources_and_is_blank_when_empty() {
        assertEquals("", PdhOnboarding.collectPrompt(emptyList()))
        val p = PdhOnboarding.collectPrompt(listOf("system_data", "local_files"))
        assertTrue(p.contains("系统数据"))
        assertTrue(p.contains("本地文件"))
        assertTrue(p.contains("全貌"))
    }
}
