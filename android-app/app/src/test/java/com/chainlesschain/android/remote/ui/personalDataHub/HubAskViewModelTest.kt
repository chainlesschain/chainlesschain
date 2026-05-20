package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.remote.commands.AskResult
import com.chainlesschain.android.remote.commands.HealthLlm
import com.chainlesschain.android.remote.commands.HealthOk
import com.chainlesschain.android.remote.commands.HealthVault
import com.chainlesschain.android.remote.commands.HubHealth
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 14.1 — HubAskViewModel 单元测试。
 *
 * 重点覆盖隐私 gate 三态路径：
 *  - 本地 LLM 直接成功
 *  - 非本地 LLM 第一次提问 → 触发 dialog（不报错）
 *  - 用户确认后第二次提问携 acceptNonLocal=true → 成功
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HubAskViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var hub: PersonalDataHubCommands

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        hub = mockk(relaxed = false)
        // health() always succeeds with vault.ok = true; tests can override
        coEvery { hub.health() } returns Result.success(
            HubHealth(
                vault = HealthVault(ok = true, schemaVersion = 1),
                llm = HealthLlm(ok = true, isLocal = true, name = "ollama:qwen2.5"),
                kgSink = HealthOk(ok = true),
                ragSink = HealthOk(ok = true)
            )
        )
    }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `submit empty question is no-op`() = runTest(testDispatcher) {
        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        vm.submit()
        advanceUntilIdle()
        coVerify(exactly = 0) { hub.ask(any(), any(), any(), any()) }
        assertNull(vm.uiState.value.answer)
    }

    @Test
    fun `local LLM ask succeeds and renders answer`() = runTest(testDispatcher) {
        coEvery { hub.ask("天气", null, null, null) } returns Result.success(
            AskResult(answer = "上海多云", citations = emptyList(),
                llmName = "ollama:qwen2.5", isLocal = true)
        )
        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        vm.onQuestionChange("天气")
        vm.submit()
        advanceUntilIdle()

        assertEquals("上海多云", vm.uiState.value.answer)
        assertTrue(vm.uiState.value.isLocal)
        assertFalse(vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.errorMessage)
        assertFalse(vm.uiState.value.showAcceptNonLocalDialog)
    }

    @Test
    fun `non-local block surfaces accept dialog without error toast`() = runTest(testDispatcher) {
        coEvery { hub.ask("私密", null, null, null) } returns Result.failure(
            RuntimeException("Non-local LLM blocked — pass options.acceptNonLocal=true to override")
        )
        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        vm.onQuestionChange("私密")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertTrue(s.showAcceptNonLocalDialog)
        assertEquals("私密", s.pendingNonLocalQuestion)
        // errorMessage must remain null — dialog is the UX, toast would double-warn
        assertNull(s.errorMessage)
        assertNull(s.answer)
    }

    @Test
    fun `accept and retry resends with acceptNonLocal=true`() = runTest(testDispatcher) {
        coEvery { hub.ask("私密", null, null, null) } returns Result.failure(
            RuntimeException("Non-local LLM blocked — pass options.acceptNonLocal=true to override")
        )
        coEvery { hub.ask("私密", true, null, null) } returns Result.success(
            AskResult(answer = "私密回答", citations = emptyList(),
                llmName = "anthropic:opus", isLocal = false)
        )
        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        vm.onQuestionChange("私密")
        vm.submit()
        advanceUntilIdle()

        vm.acceptNonLocalAndRetry()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals("私密回答", s.answer)
        assertFalse(s.isLocal)
        assertFalse(s.showAcceptNonLocalDialog)
        coVerify { hub.ask("私密", true, null, null) }
    }

    @Test
    fun `non-block error surfaces errorMessage`() = runTest(testDispatcher) {
        coEvery { hub.ask("Q", null, null, null) } returns Result.failure(
            RuntimeException("Analysis engine unavailable — LLM manager not initialized")
        )
        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertFalse(s.showAcceptNonLocalDialog)
        assertNotNull(s.errorMessage)
        assertTrue(s.errorMessage!!.contains("Analysis engine"))
    }

    @Test
    fun `dismiss dialog clears pending and keeps unconfirmed`() = runTest(testDispatcher) {
        coEvery { hub.ask("私密", null, null, null) } returns Result.failure(
            RuntimeException("Non-local LLM blocked — pass options.acceptNonLocal=true to override")
        )
        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        vm.onQuestionChange("私密")
        vm.submit()
        advanceUntilIdle()
        vm.dismissAcceptNonLocalDialog()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertFalse(s.showAcceptNonLocalDialog)
        assertNull(s.pendingNonLocalQuestion)
        assertFalse(s.acceptNonLocalConfirmed) // user did NOT accept — flag stays false
    }

    @Test
    fun `health loads on init`() = runTest(testDispatcher) {
        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        val h = vm.uiState.value.health
        assertNotNull(h)
        assertTrue(h.vault.ok)
        assertTrue(h.llm.isLocal)
    }
}
