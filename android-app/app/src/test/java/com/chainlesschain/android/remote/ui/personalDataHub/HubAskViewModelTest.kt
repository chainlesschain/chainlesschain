package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.remote.commands.AskResult
import com.chainlesschain.android.remote.commands.HealthLlm
import com.chainlesschain.android.remote.commands.HealthOk
import com.chainlesschain.android.remote.commands.HealthVault
import com.chainlesschain.android.remote.commands.HubHealth
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.remote.commands.PromptMessage
import com.chainlesschain.android.remote.commands.RetrieveContextResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
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
    private lateinit var androidLlm: AndroidLocalLlmExecutor

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        hub = mockk(relaxed = false)
        androidLlm = mockk(relaxed = false)
        // Default: no Android-side cloud LLM configured. Path-Y tests override.
        every { androidLlm.detectProvider() } returns null
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

    private fun newVm() = HubAskViewModel(hub, androidLlm)

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `submit empty question is no-op`() = runTest(testDispatcher) {
        val vm = newVm()
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
        val vm = newVm()
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
        val vm = newVm()
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
        val vm = newVm()
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
        val vm = newVm()
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
        val vm = newVm()
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
        val vm = newVm()
        advanceUntilIdle()
        val h = vm.uiState.value.health
        assertNotNull(h)
        assertTrue(h.vault.ok)
        assertTrue(h.llm.isLocal)
    }

    @Test
    fun `submit captures submittedQuestion for ChatBubble independent of input field`() = runTest(testDispatcher) {
        coEvery { hub.ask("生日礼物", null, null, null) } returns Result.success(
            AskResult(answer = "买了花", citations = emptyList(),
                llmName = "ollama:qwen2.5", isLocal = true)
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("生日礼物")
        vm.submit()
        advanceUntilIdle()

        // submittedQuestion 应保留 "生日礼物" 即使用户继续编辑 question 输入框
        val s = vm.uiState.value
        assertEquals("生日礼物", s.submittedQuestion)
        assertEquals("买了花", s.answer)

        // 模拟用户开始打下一题 — input 字段更新但 submittedQuestion 不应受影响
        vm.onQuestionChange("下一个问题")
        val s2 = vm.uiState.value
        assertEquals("下一个问题", s2.question)
        assertEquals("生日礼物", s2.submittedQuestion) // bubble 仍显示历史问
    }

    @Test
    fun `clear resets submittedQuestion to null`() = runTest(testDispatcher) {
        coEvery { hub.ask("Q", null, null, null) } returns Result.success(
            AskResult(answer = "A", citations = emptyList(),
                llmName = "ollama:qwen2.5", isLocal = true)
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()
        assertEquals("Q", vm.uiState.value.submittedQuestion)

        vm.clear()
        val s = vm.uiState.value
        assertNull(s.submittedQuestion)
        assertNull(s.answer)
        assertEquals("", s.question)
    }

    @Test
    fun `openCitation fetches detail and closeCitation clears it`() = runTest(testDispatcher) {
        coEvery { hub.eventDetail("evt-42") } returns Result.success(
            com.chainlesschain.android.remote.commands.EventDetailResponse(
                event = com.chainlesschain.android.remote.commands.HubEvent(
                    id = "evt-42", subtype = "order", source = "taobao", ingestedAt = 1000L
                )
            )
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.openCitation("evt-42")
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNotNull(s.activeCitationDetail)
        assertEquals("evt-42", s.activeCitationDetail?.event?.id)
        assertFalse(s.activeCitationLoading)

        vm.closeCitation()
        assertNull(vm.uiState.value.activeCitationDetail)
    }

    // ==================== Path Y — 安卓本机 LLM 推理 ====================

    private val doubaoProvider = AndroidLocalLlmExecutor.ConfiguredProvider(
        provider = LLMProvider.DOUBAO,
        model = "doubao-seed-1-8-251228",
        displayLabel = "豆包 (火山引擎)"
    )

    @Test
    fun `androidLlm null on init when no provider configured`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        assertNull(vm.uiState.value.androidLlm)
        assertFalse(vm.uiState.value.cloudAvailable)
        // 默认路由始终 CLOUD_ANDROID (user-visible) — 但 effectiveRoute 会 fallback 到 PC_LOCAL
        // 因为云未配 + setUp() 让 PC 有本机 LLM (HealthLlm isLocal=true)。
        assertEquals(LlmRoute.CLOUD_ANDROID, vm.uiState.value.selectedRoute)
        assertEquals(LlmRoute.PC_LOCAL, vm.uiState.value.effectiveRoute)
    }

    @Test
    fun `refreshAndroidLlm picks up newly configured provider`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        assertNull(vm.uiState.value.androidLlm)

        every { androidLlm.detectProvider() } returns doubaoProvider
        vm.refreshAndroidLlm()
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.androidLlm)
        assertEquals(LLMProvider.DOUBAO, vm.uiState.value.androidLlm?.provider)
    }

    @Test
    fun `setRoute switches selectedRoute but effectiveRoute respects availability`() = runTest(testDispatcher) {
        every { androidLlm.detectProvider() } returns doubaoProvider
        val vm = newVm()
        advanceUntilIdle()
        // 默认 CLOUD_ANDROID + cloud 配齐 → effective = CLOUD_ANDROID
        assertEquals(LlmRoute.CLOUD_ANDROID, vm.uiState.value.effectiveRoute)

        vm.setRoute(LlmRoute.PC_LOCAL)
        // setUp() PC 本机 LLM 也可用 → effective 切到 PC_LOCAL
        assertEquals(LlmRoute.PC_LOCAL, vm.uiState.value.selectedRoute)
        assertEquals(LlmRoute.PC_LOCAL, vm.uiState.value.effectiveRoute)

        vm.setRoute(LlmRoute.CLOUD_ANDROID)
        assertEquals(LlmRoute.CLOUD_ANDROID, vm.uiState.value.effectiveRoute)
    }

    @Test
    fun `effectiveRoute falls back to PC_LOCAL when selected CLOUD_ANDROID but no cloud key`() = runTest(testDispatcher) {
        // androidLlm.detectProvider returns null (setUp default) — 云不可用，PC 本机可用
        val vm = newVm()
        advanceUntilIdle()
        vm.setRoute(LlmRoute.CLOUD_ANDROID)
        assertEquals(LlmRoute.CLOUD_ANDROID, vm.uiState.value.selectedRoute)
        // 兜底到 PC_LOCAL
        assertEquals(LlmRoute.PC_LOCAL, vm.uiState.value.effectiveRoute)
    }

    @Test
    fun `pcLocalAvailable false when health llm isLocal=false`() = runTest(testDispatcher) {
        // 桌面 LLM 是云路由（非本地）— PC_LOCAL 不该被暴露
        coEvery { hub.health() } returns Result.success(
            HubHealth(
                vault = HealthVault(ok = true, schemaVersion = 1),
                llm = HealthLlm(ok = true, isLocal = false, name = "anthropic:opus"),
                kgSink = HealthOk(ok = true),
                ragSink = HealthOk(ok = true),
            )
        )
        every { androidLlm.detectProvider() } returns doubaoProvider
        val vm = newVm()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.pcLocalAvailable)
        assertTrue(vm.uiState.value.cloudAvailable)
        // selectedRoute 默认 CLOUD_ANDROID + cloud OK → effective CLOUD_ANDROID
        assertEquals(LlmRoute.CLOUD_ANDROID, vm.uiState.value.effectiveRoute)

        // 用户强切 PC_LOCAL（UI 不该让选；但 ViewModel 兜底）
        vm.setRoute(LlmRoute.PC_LOCAL)
        // PC_LOCAL 不可用 → 自动 fallback 到 CLOUD_ANDROID
        assertEquals(LlmRoute.CLOUD_ANDROID, vm.uiState.value.effectiveRoute)
    }

    @Test
    fun `submit CLOUD_ANDROID default routes via retrieveContext + executor`() = runTest(testDispatcher) {
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.retrieveContext("生日礼物", null, null) } returns Result.success(
            RetrieveContextResult(
                question = "生日礼物",
                messages = listOf(
                    PromptMessage("system", "你是助手"),
                    PromptMessage("user", "生日礼物\n[evt-1] 鲜花"),
                ),
                factIds = listOf("evt-1", "evt-2"),
                factCount = 2
            )
        )
        coEvery { androidLlm.chat(any(), doubaoProvider) } returns "买了鲜花 [evt-1] 和按摩仪 [evt-2]。"

        val vm = newVm()
        advanceUntilIdle()
        // 不显式 setRoute — 默认就是 CLOUD_ANDROID + cloud key 已配
        vm.onQuestionChange("生日礼物")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals("买了鲜花 [evt-1] 和按摩仪 [evt-2]。", s.answer)
        assertEquals(2, s.citations.size)
        assertTrue(s.citations.any { it.eventId == "evt-1" })
        assertTrue(s.citations.any { it.eventId == "evt-2" })
        assertFalse(s.isLocal)
        assertTrue(s.llmName!!.contains("豆包"))
        coVerify(exactly = 0) { hub.ask(any(), any(), any(), any()) }
    }

    @Test
    fun `submit CLOUD_ANDROID hallucinated citations are dropped silently`() = runTest(testDispatcher) {
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.retrieveContext(any(), any(), any()) } returns Result.success(
            RetrieveContextResult(
                question = "Q",
                messages = listOf(PromptMessage("user", "Q")),
                factIds = listOf("evt-real"),
                factCount = 1
            )
        )
        coEvery { androidLlm.chat(any(), any()) } returns "答案 [evt-real] 还引了 [evt-fake]。"

        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals(1, s.citations.size)
        assertEquals("evt-real", s.citations.first().eventId)
    }

    @Test
    fun `submit CLOUD_ANDROID adapter chat failure surfaces errorMessage`() = runTest(testDispatcher) {
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.retrieveContext(any(), any(), any()) } returns Result.success(
            RetrieveContextResult(
                question = "Q",
                messages = listOf(PromptMessage("user", "Q")),
                factCount = 0
            )
        )
        coEvery { androidLlm.chat(any(), any()) } throws RuntimeException("HTTP 401 — API key invalid")

        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNotNull(s.errorMessage)
        assertTrue(s.errorMessage!!.contains("401"))
        assertNull(s.answer)
        assertFalse(s.showAcceptNonLocalDialog)
    }

    @Test
    fun `submit PC_LOCAL routes via desktop hub_ask`() = runTest(testDispatcher) {
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.ask("Q", null, null, null) } returns Result.success(
            AskResult(answer = "桌面答", citations = emptyList(),
                llmName = "ollama:qwen2.5", isLocal = true)
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.setRoute(LlmRoute.PC_LOCAL)
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        assertEquals("桌面答", vm.uiState.value.answer)
        coVerify(exactly = 1) { hub.ask("Q", null, null, null) }
        coVerify(exactly = 0) { hub.retrieveContext(any(), any(), any()) }
    }

    @Test
    fun `submit fails fast with banner message when neither route available`() = runTest(testDispatcher) {
        // 云未配 + 桌面 LLM 也未启动（health.llm.ok=false → pcLocalAvailable=false）
        coEvery { hub.health() } returns Result.success(
            HubHealth(
                vault = HealthVault(ok = true, schemaVersion = 1),
                llm = HealthLlm(ok = false, isLocal = false, name = null),
                kgSink = HealthOk(ok = true),
                ragSink = HealthOk(ok = true),
            )
        )
        val vm = newVm()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.cloudAvailable)
        assertFalse(vm.uiState.value.pcLocalAvailable)

        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertNotNull(s.errorMessage)
        assertTrue(s.errorMessage!!.contains("配置"))
        coVerify(exactly = 0) { hub.ask(any(), any(), any(), any()) }
        coVerify(exactly = 0) { hub.retrieveContext(any(), any(), any()) }
    }
}
