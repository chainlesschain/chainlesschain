package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import com.chainlesschain.android.pdh.llm.LlmPreferences
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
import kotlinx.coroutines.flow.MutableStateFlow
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
    private lateinit var ccRunner: LocalCcRunner
    private lateinit var llmPreferences: LlmPreferences
    private lateinit var llmEngine: LlmInferenceEngine
    private val lanUrlFlow = MutableStateFlow<String?>(null)

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        hub = mockk(relaxed = false)
        androidLlm = mockk(relaxed = false)
        ccRunner = mockk(relaxed = true)
        llmPreferences = mockk(relaxed = false)
        llmEngine = mockk(relaxed = false)
        // Default: no Android-side cloud LLM configured. Path-Y tests override.
        every { androidLlm.detectProvider() } returns null
        // LAN URL default unset; LOCAL_DEVICE default not ready.
        every { llmPreferences.getLanLlmBaseUrl() } returns null
        lanUrlFlow.value = null
        every { llmPreferences.lanLlmBaseUrl } returns lanUrlFlow
        every { llmEngine.nativeReady } returns false
        every { llmEngine.name } returns "mediapipe-test"
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

    private fun newVm() = HubAskViewModel(hub, androidLlm, ccRunner, llmPreferences, llmEngine)

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
    fun `submit CLOUD_ANDROID known citations kept and hallucinated counted`() = runTest(testDispatcher) {
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.retrieveContext(any(), any(), any()) } returns Result.success(
            RetrieveContextResult(
                question = "Q",
                messages = listOf(PromptMessage("user", "Q")),
                factIds = listOf("evt-real"),
                factCount = 1
            )
        )
        // 引了 1 个真 id + 2 个 vault 里没有的 id → 1 citation + hallucinatedCount=2
        coEvery { androidLlm.chat(any(), any()) } returns
            "答案 [evt-real] 还引了 [evt-fake] 和 [evt-fake2]。"

        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals(1, s.citations.size)
        assertEquals("evt-real", s.citations.first().eventId)
        assertEquals(2, s.hallucinatedCount)
    }

    @Test
    fun `submit CLOUD_ANDROID no hallucination when all citations known`() = runTest(testDispatcher) {
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.retrieveContext(any(), any(), any()) } returns Result.success(
            RetrieveContextResult(
                question = "Q",
                messages = listOf(PromptMessage("user", "Q")),
                factIds = listOf("evt-1", "evt-2"),
                factCount = 2
            )
        )
        coEvery { androidLlm.chat(any(), any()) } returns "买了 [evt-1] 和 [evt-2]。"

        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        assertEquals(0, vm.uiState.value.hallucinatedCount)
    }

    @Test
    fun `submit CLOUD_ANDROID empty factIds never flags hallucination (no-facts)`() = runTest(testDispatcher) {
        // factIds 空 = 没召回任何事实，此时 token 谈不上"幻觉"，不该误报。
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.retrieveContext(any(), any(), any()) } returns Result.success(
            RetrieveContextResult(
                question = "Q",
                messages = listOf(PromptMessage("user", "Q")),
                factIds = emptyList(),
                factCount = 0
            )
        )
        coEvery { androidLlm.chat(any(), any()) } returns "瞎编 [evt-x][evt-y]。"

        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals(0, s.hallucinatedCount)
        assertTrue(s.citations.isEmpty())
    }

    // ─── splitCitations 纯逻辑边界：去重 + 正则最小长度 ──────────────────────
    // 这些走 CLOUD_ANDROID 路径（splitCitations 唯一客户端入口），补上上面 known/
    // hallucinated/no-facts 三例没覆盖的 toSet() 去重语义与 CITATION_RE 长度边界。

    @Test
    fun `submit CLOUD_ANDROID dedups repeated hallucinated id to count one`() = runTest(testDispatcher) {
        // 同一个编造 id 被引用 3 次 → splitCitations 用 toSet() 去重 → 只算 1 条幻觉
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.retrieveContext(any(), any(), any()) } returns Result.success(
            RetrieveContextResult(
                question = "Q",
                messages = listOf(PromptMessage("user", "Q")),
                factIds = listOf("evt-real"),
                factCount = 1
            )
        )
        coEvery { androidLlm.chat(any(), any()) } returns
            "瞎编 [evt-fake] 又 [evt-fake] 再 [evt-fake]。"

        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals(1, s.hallucinatedCount) // 去重后只算 1，而非引用次数 3
        assertTrue(s.citations.isEmpty())
    }

    @Test
    fun `submit CLOUD_ANDROID dedups repeated known id to single citation`() = runTest(testDispatcher) {
        // 真 id 被引两次 → citations 去重为 1 条（chip 不重复）
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.retrieveContext(any(), any(), any()) } returns Result.success(
            RetrieveContextResult(
                question = "Q",
                messages = listOf(PromptMessage("user", "Q")),
                factIds = listOf("evt-1"),
                factCount = 1
            )
        )
        coEvery { androidLlm.chat(any(), any()) } returns "买了 [evt-1]，详见 [evt-1]。"

        val vm = newVm()
        advanceUntilIdle()
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals(1, s.citations.size)
        assertEquals("evt-1", s.citations.first().eventId)
        assertEquals(0, s.hallucinatedCount)
    }

    @Test
    fun `submit CLOUD_ANDROID ignores single-char bracket tokens (regex min length 2)`() =
        runTest(testDispatcher) {
            // CITATION_RE = [A-Za-z0-9_-]{2,}：[ab] 命中（编造，不在 factIds），[c] 太短被忽略
            every { androidLlm.detectProvider() } returns doubaoProvider
            coEvery { hub.retrieveContext(any(), any(), any()) } returns Result.success(
                RetrieveContextResult(
                    question = "Q",
                    messages = listOf(PromptMessage("user", "Q")),
                    factIds = listOf("zz"),
                    factCount = 1
                )
            )
            coEvery { androidLlm.chat(any(), any()) } returns "脚注 [ab] 和单字 [c]。"

            val vm = newVm()
            advanceUntilIdle()
            vm.onQuestionChange("Q")
            vm.submit()
            advanceUntilIdle()

            val s = vm.uiState.value
            assertEquals(1, s.hallucinatedCount) // 仅 [ab]；[c] 单字符不算 token
            assertTrue(s.citations.isEmpty())
        }

    @Test
    fun `submit PC_LOCAL surfaces desktop hallucinatedCitations count`() = runTest(testDispatcher) {
        every { androidLlm.detectProvider() } returns doubaoProvider
        coEvery { hub.ask("Q", null, null, null) } returns Result.success(
            AskResult(
                answer = "桌面答 [evt-bad]",
                citations = emptyList(),
                llmName = "ollama:qwen2.5",
                isLocal = true,
                warning = "hallucinated-citations",
                hallucinatedCitations = listOf("evt-bad")
            )
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.setRoute(LlmRoute.PC_LOCAL)
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        assertEquals(1, vm.uiState.value.hallucinatedCount)
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

    // ─── 2026-05-24: LOCAL_DEVICE + LAN_OLLAMA route coverage ──────────────

    @Test
    fun `LOCAL_DEVICE route calls llmEngine chat directly without RAG`() = runTest(testDispatcher) {
        every { llmEngine.nativeReady } returns true
        coEvery { llmEngine.chat(any(), any()) } returns LlmInferenceEngine.ChatResponse(
            text = "端侧答",
            promptTokens = 5,
            completionTokens = 10,
        )
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.localDeviceAvailable)

        vm.setRoute(LlmRoute.LOCAL_DEVICE)
        vm.onQuestionChange("飞机模式 Q")
        vm.submit()
        advanceUntilIdle()

        val s = vm.uiState.value
        assertEquals("端侧答", s.answer)
        assertTrue(s.isLocal)
        assertTrue(s.llmName?.contains("端侧") == true)
        assertTrue(s.citations.isEmpty())  // 无 RAG
        coVerify(exactly = 0) { hub.ask(any(), any(), any(), any()) }
        coVerify(exactly = 0) { hub.retrieveContext(any(), any(), any()) }
    }

    @Test
    fun `LAN_OLLAMA route invokes ccRunner with custom ollamaUrl + acceptNonLocal=true`() =
        runTest(testDispatcher) {
            every { llmPreferences.getLanLlmBaseUrl() } returns "http://192.168.1.5:11434"
            lanUrlFlow.value = "http://192.168.1.5:11434"
            coEvery {
                ccRunner.askQuestion(
                    question = any(),
                    ollamaUrl = "http://192.168.1.5:11434",
                    acceptNonLocal = true,
                )
            } returns LocalCcRunner.AskResult.Ok(
                LocalCcRunner.AskReport(
                    answer = "LAN 答",
                    citations = emptyList(),
                    llmName = "llama3",
                    isLocal = false,
                    durationMs = 100L,
                ),
                rawJson = "{}",
            )
            val vm = newVm()
            advanceUntilIdle()
            assertTrue(vm.uiState.value.lanAvailable)

            vm.setRoute(LlmRoute.LAN_OLLAMA)
            vm.onQuestionChange("局域网 Q")
            vm.submit()
            advanceUntilIdle()

            val s = vm.uiState.value
            assertEquals("LAN 答", s.answer)
            assertFalse(s.isLocal)
            assertTrue(s.llmName?.contains("LAN") == true)
            coVerify(exactly = 1) {
                ccRunner.askQuestion(
                    question = "局域网 Q",
                    ollamaUrl = "http://192.168.1.5:11434",
                    acceptNonLocal = true,
                )
            }
        }

    @Test
    fun `LAN_OLLAMA route surfaces error when no URL configured`() = runTest(testDispatcher) {
        // lanLlmBaseUrl null by default → lanAvailable = false → effectiveRoute falls back
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
        assertFalse(vm.uiState.value.lanAvailable)

        // selectedRoute=LAN_OLLAMA but unavailable → falls through to anyRouteAvailable=false branch
        vm.setRoute(LlmRoute.LAN_OLLAMA)
        vm.onQuestionChange("Q")
        vm.submit()
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.errorMessage)
    }
}
