package com.chainlesschain.android.presentation.screens.cc

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.tools.CcChatEvent
import com.chainlesschain.android.feature.ai.tools.CcChatOrchestrator
import com.chainlesschain.android.feature.ai.tools.ChatStatus
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class CcChatViewModelTest {

    @get:Rule val instantTaskExecutorRule = InstantTaskExecutorRule()

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var orchestrator: CcChatOrchestrator
    private lateinit var adapterFactory: LLMAdapterFactory
    private lateinit var securePrefs: SecurePreferences
    private lateinit var vm: CcChatViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        orchestrator = mockk(relaxed = true)
        adapterFactory = mockk(relaxed = true)
        securePrefs = mockk(relaxed = true)
        every { securePrefs.getOpenAIApiKey() } returns "sk-test"
        every { securePrefs.getDeepSeekApiKey() } returns "dsk-test"
        every { securePrefs.getApiKeyForProvider(any()) } returns "fake-test"
        vm = CcChatViewModel(orchestrator, adapterFactory, securePrefs)
    }

    @After fun tearDown() = Dispatchers.resetMain()

    private fun stubAdapter(supportsTools: Boolean = true): LLMAdapter =
        mockk(relaxed = true) { every { supportsToolUse } returns supportsTools }

    // ---------- setProvider ----------

    @Test fun `setProvider succeeds and updates state with adapter info`() = runTest {
        val ad = stubAdapter(supportsTools = true)
        every { adapterFactory.createAdapter(LLMProvider.OPENAI, "sk-test") } returns ad

        vm.setProvider(LLMProvider.OPENAI)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(LLMProvider.OPENAI, state.provider)
        assertEquals("gpt-4o-mini", state.modelName)
        assertTrue(state.toolAvailable)
        assertNull(state.error)
    }

    @Test fun `setProvider with tool-unsupported adapter clears toolAvailable`() = runTest {
        val ad = stubAdapter(supportsTools = false)
        every { adapterFactory.createAdapter(LLMProvider.QWEN, "fake-test") } returns ad

        vm.setProvider(LLMProvider.QWEN)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.toolAvailable)
    }

    @Test fun `setProvider with empty api key surfaces error`() = runTest {
        every { securePrefs.getOpenAIApiKey() } returns ""

        vm.setProvider(LLMProvider.OPENAI)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertNotNull(state.error)
        assertTrue(state.error!!.contains("Adapter init failed"))
        assertFalse(state.toolAvailable)
    }

    @Test fun `setProvider Ollama works without API key`() = runTest {
        val ad = stubAdapter(supportsTools = false)
        every { adapterFactory.createAdapter(LLMProvider.OLLAMA, null) } returns ad

        vm.setProvider(LLMProvider.OLLAMA)
        advanceUntilIdle()

        assertEquals(LLMProvider.OLLAMA, vm.uiState.value.provider)
        assertNull(vm.uiState.value.error)
    }

    // ---------- sendMessage guard rails ----------

    @Test fun `sendMessage blank text — no-op`() = runTest {
        vm.sendMessage("   ")
        advanceUntilIdle()
        assertEquals(emptyList(), vm.uiState.value.messages)
    }

    @Test fun `sendMessage without provider surfaces error`() = runTest {
        vm.sendMessage("hi")
        advanceUntilIdle()
        val state = vm.uiState.value
        assertNotNull(state.error)
        assertTrue(state.error!!.contains("Provider not initialized"))
    }

    // ---------- sendMessage happy path ----------

    @Test fun `sendMessage runs orchestrator and applies events`() = runTest {
        val ad = stubAdapter(supportsTools = true)
        every { adapterFactory.createAdapter(LLMProvider.OPENAI, "sk-test") } returns ad

        every { orchestrator.run(any(), any(), any(), any(), any()) } returns flow {
            emit(CcChatEvent.StatusChanged(ChatStatus.THINKING))
            emit(CcChatEvent.AssistantTextDelta("你好"))
            emit(CcChatEvent.AssistantTextDelta("，世界"))
            emit(CcChatEvent.StatusChanged(ChatStatus.COMPLETE))
            emit(CcChatEvent.Completed("你好，世界"))
        }

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("hi"); advanceUntilIdle()

        val msgs = vm.uiState.value.messages
        assertEquals(2, msgs.size) // 1 user + 1 assistant (streaming merged)
        assertTrue(msgs[0] is CcChatMessage.User)
        assertEquals("hi", (msgs[0] as CcChatMessage.User).text)
        assertTrue(msgs[1] is CcChatMessage.Assistant)
        val asst = msgs[1] as CcChatMessage.Assistant
        assertEquals("你好，世界", asst.text)
        assertFalse(asst.isStreaming)  // finalized on Completed
        assertEquals(ChatStatus.COMPLETE, vm.uiState.value.status)
        assertTrue(vm.uiState.value.inputEnabled)
    }

    @Test fun `sendMessage applies ToolCall events as ToolCall message`() = runTest {
        val ad = stubAdapter(supportsTools = true)
        every { adapterFactory.createAdapter(LLMProvider.OPENAI, "sk-test") } returns ad
        every { orchestrator.run(any(), any(), any(), any(), any()) } returns flow {
            emit(CcChatEvent.ToolCallStarted("tc1", "note", listOf("list", "--limit", "10")))
            emit(CcChatEvent.StatusChanged(ChatStatus.TOOL_RUNNING))
            emit(CcChatEvent.ToolCallCompleted("tc1", "note", listOf("list", "--limit", "10"),
                "$ cc note list --limit 10\nexitCode=0\nduration=234ms\nstdout:\nfoo\n"))
            emit(CcChatEvent.Completed(""))
        }
        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("列下笔记"); advanceUntilIdle()

        val msgs = vm.uiState.value.messages
        // user + ToolCall card
        val tc = msgs.filterIsInstance<CcChatMessage.ToolCall>().single()
        assertEquals("tc1", tc.toolCallId)
        assertEquals("note", tc.command)
        assertEquals(CcChatMessage.ToolCall.State.DONE, tc.state)
        assertEquals(0, tc.exitCode)
        assertEquals(234L, tc.durationMs)
        assertEquals("cc note list --limit 10", tc.invocationLine)
    }

    @Test fun `sendMessage applies Failed event`() = runTest {
        val ad = stubAdapter(supportsTools = true)
        every { adapterFactory.createAdapter(LLMProvider.OPENAI, "sk-test") } returns ad
        every { orchestrator.run(any(), any(), any(), any(), any()) } returns flow {
            emit(CcChatEvent.StatusChanged(ChatStatus.FAILED))
            emit(CcChatEvent.Failed("boom"))
        }
        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("hi"); advanceUntilIdle()

        assertEquals(ChatStatus.FAILED, vm.uiState.value.status)
        assertEquals("boom", vm.uiState.value.error)
        assertTrue(vm.uiState.value.inputEnabled)
    }

    // ---------- E7 — cancel ----------

    @Test fun `cancel before in-flight job — no crash`() {
        vm.cancel()  // no current job — should be a no-op
        // No assertion: success = no exception
    }

    @Test fun `clear empties messages`() = runTest {
        val ad = stubAdapter(supportsTools = true)
        every { adapterFactory.createAdapter(LLMProvider.OPENAI, "sk-test") } returns ad
        every { orchestrator.run(any(), any(), any(), any(), any()) } returns flow {
            emit(CcChatEvent.Completed("done"))
        }
        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("hi"); advanceUntilIdle()
        assertTrue(vm.uiState.value.messages.isNotEmpty())

        vm.clear()
        assertEquals(emptyList(), vm.uiState.value.messages)
    }

    @Test fun `clearError nulls error`() = runTest {
        every { securePrefs.getOpenAIApiKey() } returns ""
        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        assertNotNull(vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    // ---------- expansion toggle ----------

    @Test fun `toggleToolResultExpansion flips expanded`() = runTest {
        val ad = stubAdapter(supportsTools = true)
        every { adapterFactory.createAdapter(LLMProvider.OPENAI, "sk-test") } returns ad
        every { orchestrator.run(any(), any(), any(), any(), any()) } returns flow {
            emit(CcChatEvent.ToolCallStarted("tc1", "search", listOf("foo")))
            emit(CcChatEvent.ToolCallCompleted("tc1", "search", listOf("foo"),
                "$ cc search foo\nexitCode=0\nduration=12ms\nstdout:\nresult\n"))
            emit(CcChatEvent.Completed(""))
        }
        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("hi"); advanceUntilIdle()

        val tc = vm.uiState.value.messages.filterIsInstance<CcChatMessage.ToolCall>().first()
        assertFalse(tc.expanded)

        vm.toggleToolResultExpansion("tc1")
        val tcAfter = vm.uiState.value.messages.filterIsInstance<CcChatMessage.ToolCall>().first()
        assertTrue(tcAfter.expanded)

        vm.toggleToolResultExpansion("tc1")
        val tcAfter2 = vm.uiState.value.messages.filterIsInstance<CcChatMessage.ToolCall>().first()
        assertFalse(tcAfter2.expanded)
    }

    // ---------- in-flight guard ----------

    @Test fun `sendMessage while turn in flight surfaces error`() = runTest {
        val ad = stubAdapter(supportsTools = true)
        every { adapterFactory.createAdapter(LLMProvider.OPENAI, "sk-test") } returns ad
        // Slow orchestrator flow that never completes
        every { orchestrator.run(any(), any(), any(), any(), any()) } returns flow {
            kotlinx.coroutines.delay(60_000)
            emit(CcChatEvent.Completed("never"))
        }
        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("first"); /* don't advance — keep in flight */
        // Try second send while first still running
        vm.sendMessage("second")
        // Error surfaces immediately (no need to advanceUntilIdle since check is sync)
        val state = vm.uiState.value
        assertNotNull(state.error)
        assertTrue(state.error!!.contains("already in flight"))
    }

    // ---------- extractExitAndDurationFromResult regex ----------

    @Test fun `extractExitAndDurationFromResult — happy 0`() {
        val (exit, dur) = vm.extractExitAndDurationFromResult(
            "$ cc note list\nexitCode=0\nduration=234ms\nstdout:\n..."
        )
        assertEquals(0, exit)
        assertEquals(234L, dur)
    }

    @Test fun `extractExitAndDurationFromResult — negative exit`() {
        val (exit, _) = vm.extractExitAndDurationFromResult("exitCode=-1\nduration=1ms\n")
        assertEquals(-1, exit)
    }

    @Test fun `extractExitAndDurationFromResult — allowlist deny 126`() {
        val (exit, dur) = vm.extractExitAndDurationFromResult(
            "$ cc <error>\nexitCode=126\nstderr:\n..."
        )
        assertEquals(126, exit)
        // No duration in synth error
        assertNull(dur)
    }

    @Test fun `extractExitAndDurationFromResult — duplicate 129`() {
        val (exit, _) = vm.extractExitAndDurationFromResult(
            "$ cc search foo\nexitCode=129\nstderr:\nduplicate tool call\n"
        )
        assertEquals(129, exit)
    }

    @Test fun `extractExitAndDurationFromResult — non-matching content`() {
        val (exit, dur) = vm.extractExitAndDurationFromResult("garbage no key=val")
        assertNull(exit)
        assertNull(dur)
    }

    // ---------- uiStateToHistory ----------

    @Test fun `uiStateToHistory drops ToolCall and System messages`() {
        val msgs = listOf(
            CcChatMessage.User(id = "u1", text = "hi", timestamp = 1L),
            CcChatMessage.Assistant(id = "a1", text = "hi back", isStreaming = false, timestamp = 2L),
            CcChatMessage.ToolCall(
                id = "tc1", toolCallId = "tc1", command = "note",
                subargs = listOf("list"), timestamp = 3L,
            ),
            CcChatMessage.System(id = "s1", text = "note", timestamp = 4L),
        )
        val history = vm.uiStateToHistory(msgs)
        assertEquals(2, history.size)
        assertEquals("hi", history[0].content)
        assertEquals("hi back", history[1].content)
    }
}
