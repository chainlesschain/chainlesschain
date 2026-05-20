package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.chainlesschain.android.remote.commands.AdaptersResponse
import com.chainlesschain.android.remote.commands.AskResult
import com.chainlesschain.android.remote.commands.HealthLlm
import com.chainlesschain.android.remote.commands.HealthOk
import com.chainlesschain.android.remote.commands.HealthVault
import com.chainlesschain.android.remote.commands.HubHealth
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.remote.commands.SyncReport
import com.chainlesschain.android.remote.events.HubSyncEvent
import com.chainlesschain.android.remote.events.HubSyncEventDispatcher
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.flow.MutableSharedFlow
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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 14.1.6 — PersonalDataHub 集成测试。
 *
 * 与各 ViewModelTest 不同：此测试使用 **real** PersonalDataHubCommands 接到
 * **mock** RemoteCommandClient，验证 RemoteCommandClient ↔ PersonalDataHubCommands
 * ↔ ViewModel 三层串联：params 拍平 / Result 包装 / Optional 字段省略 /
 * acceptNonLocal gate 流（首发拒 → dialog → 二发携 acceptNonLocal=true）全链路正确。
 *
 * 设计稿验收 §8.2 要求 ≥3 集成场景：(1) ask happy → AskResult → VM state；
 * (2) acceptNonLocal gate flow；(3) syncAdapter 触发 → SyncReport → VM state。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PersonalDataHubIntegrationTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var mockClient: RemoteCommandClient
    private lateinit var hub: PersonalDataHubCommands

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        mockClient = mockk(relaxed = false)
        hub = PersonalDataHubCommands(mockClient)

        // health 在 HubAskViewModel.init 调；默认本地 LLM 路径
        coEvery {
            mockClient.invoke<HubHealth>("personal-data-hub.health", any(), any())
        } returns Result.success(
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
    fun `end-to-end ask happy path through real Commands wraps params and unwraps Result`() = runTest(testDispatcher) {
        val paramsSlot = slot<Map<String, Any>>()
        coEvery {
            mockClient.invoke<AskResult>("personal-data-hub.ask", capture(paramsSlot), any())
        } returns Result.success(
            AskResult(answer = "上海多云", citations = emptyList(),
                llmName = "ollama:qwen2.5", isLocal = true)
        )

        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        vm.onQuestionChange("天气")
        vm.submit()
        advanceUntilIdle()

        // VM 拿到 unwrap 后的 AskResult.answer
        assertEquals("上海多云", vm.uiState.value.answer)
        assertEquals(true, vm.uiState.value.isLocal)
        assertTrue(vm.uiState.value.errorMessage == null)

        // PersonalDataHubCommands.ask 把 question 放在顶层 params，options 不传
        assertEquals("天气", paramsSlot.captured["question"])
        assertTrue(!paramsSlot.captured.containsKey("options"))
    }

    @Test
    fun `acceptNonLocal gate flow — first ask fails, dialog shown, second ask carries acceptNonLocal=true`() = runTest(testDispatcher) {
        val paramsSlot = slot<Map<String, Any>>()
        // 第一次 hub.ask -> Non-local LLM blocked；第二次成功
        coEvery {
            mockClient.invoke<AskResult>("personal-data-hub.ask", capture(paramsSlot), any())
        } returnsMany listOf(
            Result.failure(RuntimeException("Non-local LLM blocked — pass options.acceptNonLocal=true to override")),
            Result.success(AskResult(answer = "已用 Claude 回答", citations = emptyList(),
                llmName = "claude", isLocal = false))
        )

        val vm = HubAskViewModel(hub)
        advanceUntilIdle()
        vm.onQuestionChange("解释一下相对论")
        vm.submit()
        advanceUntilIdle()

        // 第一次：dialog 应出，answer 仍 null，pendingNonLocalQuestion 保留
        assertTrue(vm.uiState.value.showAcceptNonLocalDialog)
        assertEquals("解释一下相对论", vm.uiState.value.pendingNonLocalQuestion)
        assertNull(vm.uiState.value.answer)

        // 用户接受 → 二次发送
        vm.acceptNonLocalAndRetry()
        advanceUntilIdle()

        // 第二次：answer 拿到，dialog 关掉
        assertEquals("已用 Claude 回答", vm.uiState.value.answer)
        assertTrue(!vm.uiState.value.showAcceptNonLocalDialog)
        assertEquals(false, vm.uiState.value.isLocal)

        // 二次 invoke 应带 options.acceptNonLocal=true（slot 留最后一次 capture）
        @Suppress("UNCHECKED_CAST")
        val opts = paramsSlot.captured["options"] as Map<String, Any>
        assertEquals(true, opts["acceptNonLocal"])

        coVerify(exactly = 2) {
            mockClient.invoke<AskResult>("personal-data-hub.ask", any(), any())
        }
    }

    @Test
    fun `syncAdapter end-to-end — RemoteCommandClient mock through to HubAdaptersViewModel state`() = runTest(testDispatcher) {
        coEvery {
            mockClient.invoke<AdaptersResponse>("personal-data-hub.list-adapters", any(), any())
        } returns Result.success(AdaptersResponse(adapters = emptyList()))

        val paramsSlot = slot<Map<String, Any>>()
        coEvery {
            mockClient.invoke<SyncReport>("personal-data-hub.sync-adapter", capture(paramsSlot), any())
        } returns Result.success(SyncReport(adapter = "email-imap", ingested = 17, durationMs = 800))

        // Phase 14.3 — VM 现在依赖 HubSyncEventDispatcher；本测试走非流式 sync 路径，
        // dispatcher.events 提供空 SharedFlow 即可（无 sync.progress 事件被 emit）。
        val syncDispatcher = mockk<HubSyncEventDispatcher>(relaxed = false)
        every { syncDispatcher.events } returns
            MutableSharedFlow<HubSyncEvent>(replay = 0, extraBufferCapacity = 32)

        val vm = HubAdaptersViewModel(hub, syncDispatcher)
        advanceUntilIdle()
        vm.sync("email-imap")
        advanceUntilIdle()

        // VM 拿到 unwrap 后的 SyncReport
        assertNotNull(vm.uiState.value.lastReport)
        assertEquals(17L, vm.uiState.value.lastReport?.ingested)
        assertEquals(800L, vm.uiState.value.lastReport?.durationMs)
        assertNull(vm.uiState.value.syncingAdapter)

        // PersonalDataHubCommands.syncAdapter 把 name 放在顶层 params，options 不传
        assertEquals("email-imap", paramsSlot.captured["name"])
        assertTrue(!paramsSlot.captured.containsKey("options"))
    }
}
